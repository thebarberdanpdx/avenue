/* done-durable.test.mjs — "a completed appointment can never silently revert on reload".
 *
 * ROOT (dry run, owner): 2 appts were marked done, a production deploy forced a reload, and they
 * came back as "confirmed". Proven from code: a "done" write persists only via flushApptsNow/debounce,
 * both gated on loadedRef+session — so in cache-degraded mode (or a dropped write) the "done" lives only
 * in memory, and the reload's authoritative pull replaces it with the server's stale "confirmed".
 * reconcileCheckinOutbox protects only in-service visits (it treats "done" as already-landed).
 *
 * The fix mirrors checkin-durable for the terminal "done" state:
 *   - a durable localStorage record of any locally-"done" appt the server hasn't stored as done,
 *   - an OVERLAY on every server snapshot so a stale read can't revert a completion,
 *   - a drain that re-saves until the server confirms it,
 *   - a time cap so a GENUINE cross-device reversal (refund on another device) still reconverges,
 *   - self-cleaning: a local refund/undo (no longer "done" locally) drops the record.
 *
 * These reference implementations mirror the pure logic in src/App.jsx (reconcileDoneOutbox + the
 * derived done-outbox effect). The final block asserts the real markers still ship.
 *
 * Run:  node --test tests/           (wired into `npm run ship-check`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CAP = 24 * 60 * 60 * 1000; // DONE_PROTECT_MS

// --- reference implementations (mirror src/App.jsx) ------------------------------------------
function reconcileDone(serverList, box, localList = null, now = 0) {
  if (!box.length) return serverList;
  const byId = new Map((serverList || []).map((a) => [String(a && a.id), a]));
  const localById = new Map((localList || []).map((a) => [String(a && a.id), a]));
  let overlaid = false;
  for (const e of box) {
    const sv = byId.get(String(e && e.id));
    if (!sv) continue;
    if (sv.status === "done") continue;                    // landed
    if (e.at && (now - e.at) > CAP) continue;              // past the protect window → server wins
    const loc = localById.get(String(e.id));
    if (loc && loc.status !== "done") continue;            // deliberate local downgrade (refund/undo)
    byId.set(String(e.id), { ...sv, status: "done",
      serviceEndedAt: sv.serviceEndedAt != null ? sv.serviceEndedAt : e.serviceEndedAt,
      visitCountedAt: sv.visitCountedAt || e.visitCountedAt });
    overlaid = true;
  }
  if (!overlaid) return serverList;
  return (serverList || []).map((a) => byId.get(String(a && a.id)) || a);
}
// ADDITIVE with PROOF-BASED removal + age cap (mirrors the derived effect). `loaded` = loadedRef && staffApptsLoaded.
function deriveDone(localAppts, baseAppts, box = [], loaded = true, now = 0) {
  const local = localAppts || [];
  const base = new Map((baseAppts || []).map((a) => [String(a && a.id), a]));
  const localById = new Map(local.map((a) => [String(a && a.id), a]));
  const prevAt = new Map((box || []).map((e) => [String(e && e.id), e && e.at]));
  const next = [];
  const added = new Set();
  for (const a of local) {
    if (a && a.status === "done") {
      const sv = base.get(String(a.id));
      if (!sv || sv.status !== "done") {
        const at = prevAt.get(String(a.id)) || now;
        if ((now - at) <= CAP) { next.push({ id: String(a.id), serviceEndedAt: a.serviceEndedAt, visitCountedAt: a.visitCountedAt, at }); added.add(String(a.id)); }
      }
    }
  }
  for (const e of (box || [])) {
    const id = String(e && e.id);
    if (added.has(id)) continue;
    const sv = base.get(id);
    if (sv && sv.status === "done") continue;              // landed
    if (localById.has(id)) continue;                       // present locally but not "done" → deliberate downgrade
    if (loaded && !sv) continue;                           // deleted from both sides
    if (e.at && (now - e.at) > CAP) continue;              // aged out
    next.push(e);
  }
  return next;
}
const T = 1_752_800_000_000; // fixed timestamp — tests never call Date.now()

// --- reconcile: protect a completion from a stale server copy ---------------------------------
test("reconcileDone overlays a stale 'confirmed' server appt back to done", () => {
  const server = [{ id: "a1", status: "confirmed" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  const out = reconcileDone(server, box, [{ id: "a1", status: "done" }], T + 5000);
  assert.equal(out[0].status, "done");
  assert.equal(out[0].serviceEndedAt, T + 1);
});

test("reconcileDone restores serviceEndedAt/visitCountedAt only when the server lacks them", () => {
  const server = [{ id: "a1", status: "confirmed", serviceEndedAt: 999, visitCountedAt: "srv" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, visitCountedAt: "box", at: T }];
  const out = reconcileDone(server, box, [{ id: "a1", status: "done" }], T);
  assert.equal(out[0].serviceEndedAt, 999);   // server value kept
  assert.equal(out[0].visitCountedAt, "srv"); // server value kept
});

test("reconcileDone does NOT touch paid — money has its own durable outbox", () => {
  const server = [{ id: "a1", status: "confirmed", paid: null }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  const out = reconcileDone(server, box, [{ id: "a1", status: "done" }], T);
  assert.equal(out[0].status, "done");
  assert.equal(out[0].paid, null); // untouched
});

test("reconcileDone does NOT resurrect once the server stored it done (landed)", () => {
  const server = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  assert.equal(reconcileDone(server, box, [], T), server); // same ref
});

test("reconcileDone respects a deliberate LOCAL downgrade (refund/undo → confirmed) — no resurrect", () => {
  const server = [{ id: "a1", status: "confirmed" }];
  const localAfterRefund = [{ id: "a1", status: "confirmed" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  const out = reconcileDone(server, box, localAfterRefund, T);
  assert.equal(out[0].status, "confirmed"); // refund respected
});

test("reconcileDone STOPS protecting past the 24h window (a real cross-device reversal wins)", () => {
  const server = [{ id: "a1", status: "confirmed" }];
  // local still thinks done, but the record is older than the cap → let the server win
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  const out = reconcileDone(server, box, [{ id: "a1", status: "done" }], T + CAP + 1);
  assert.equal(out[0].status, "confirmed");
});

test("reconcileDone overlays on a cold-boot where there's no local row yet", () => {
  const cached = [{ id: "a1", status: "confirmed" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  const out = reconcileDone(cached, box, [], T + 1000);
  assert.equal(out[0].status, "done");
});

test("reconcileDone with an empty outbox returns the same reference (fast path)", () => {
  const server = [{ id: "a1", status: "confirmed" }];
  assert.equal(reconcileDone(server, [], [], T), server);
});

// --- derive: the outbox is a pure function of (local, server-baseline, age) -------------------
test("deriveDone ADDS a completion the server baseline hasn't stored as done", () => {
  const local = [{ id: "a1", status: "done", serviceEndedAt: T + 1, visitCountedAt: "v" }];
  const base = [{ id: "a1", status: "confirmed" }];
  assert.deepEqual(deriveDone(local, base, [], true, T), [{ id: "a1", serviceEndedAt: T + 1, visitCountedAt: "v", at: T }]);
});

test("deriveDone preserves the original `at` across re-derives (age measured from first completion)", () => {
  const local = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  const base = [{ id: "a1", status: "confirmed" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  const out = deriveDone(local, base, box, true, T + 60000); // 1 min later
  assert.equal(out[0].at, T); // NOT refreshed to now
});

test("deriveDone DROPS once the server baseline stores it done (landed)", () => {
  const local = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  const base = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  assert.deepEqual(deriveDone(local, base, [], true, T), []);
});

test("deriveDone DROPS on a local refund/undo (no longer done locally) — self-cleaning", () => {
  const local = [{ id: "a1", status: "confirmed" }];
  const base = [{ id: "a1", status: "confirmed" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  assert.deepEqual(deriveDone(local, base, box, true, T), []);
});

test("deriveDone PRESERVES a pending entry on a cold boot — empty local, not loaded yet", () => {
  const out = deriveDone([], [], [{ id: "a1", serviceEndedAt: T + 1, at: T }], /*loaded*/ false, T + 1000);
  assert.deepEqual(out, [{ id: "a1", serviceEndedAt: T + 1, at: T }]); // NOT wiped
});

test("deriveDone DROPS a deleted appt once fully loaded (gone from both sides)", () => {
  const out = deriveDone([], [], [{ id: "a1", serviceEndedAt: T + 1, at: T }], /*loaded*/ true, T);
  assert.deepEqual(out, []);
});

test("deriveDone DROPS an entry aged past the protect window", () => {
  const local = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  const base = [{ id: "a1", status: "confirmed" }];
  const box = [{ id: "a1", serviceEndedAt: T + 1, at: T }];
  assert.deepEqual(deriveDone(local, base, box, true, T + CAP + 1), []); // stops re-saving forever
});

// --- end-to-end: the exact bug can no longer happen -------------------------------------------
test("round-trip: a done appt survives a stale reload, then drops after the server confirms it", () => {
  // 1. Owner marks done in degraded mode. Local is 'done'; the server baseline is still 'confirmed'.
  let local = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  let base = [{ id: "a1", status: "confirmed" }];
  let box = deriveDone(local, base, [], true, T);
  assert.equal(box.length, 1); // durable record captured

  // 2. Deploy forces a reload; the server pull is still 'confirmed'. WITHOUT the fix this reverts;
  //    WITH it, reconcile overlays the completion so it stays done.
  const staleServer = [{ id: "a1", status: "confirmed" }];
  local = reconcileDone(staleServer, box, local, T + 2000);
  assert.equal(local[0].status, "done");

  // 3. The drain re-saves; the server finally stores it done and echoes it back as the new baseline.
  base = [{ id: "a1", status: "done", serviceEndedAt: T + 1 }];
  box = deriveDone(local, base, box, true, T + 3000);
  assert.deepEqual(box, []); // landed → outbox empties, no perpetual re-save
});

// --- source guard: the fix must stay in the shipped file --------------------------------------
test("[done-durable] markers are present in src/App.jsx", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  assert.ok(src.includes("reconcileDoneOutbox"), "reconcileDoneOutbox helper is gone");
  assert.ok(src.includes("DONE_OUTBOX_KEY"), "durable done-outbox key is gone");
  assert.ok(src.includes("reconcileDoneOutbox(reconcileCheckinOutbox(serverAp))"), "done overlay removed from applyServerAuthoritative");
  assert.ok(/\[done-durable\] SOLE WRITER of the done-outbox/.test(src), "derived done-outbox effect removed");
  assert.ok(/Keep re-saving a pending completion until the server confirms/.test(src), "done drain effect removed");
});

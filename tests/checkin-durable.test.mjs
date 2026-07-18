/* checkin-durable.test.mjs — the "a live visit can never be silently lost" safety net.
 *
 * ROOT (Dan, 2026-07-18): a client was checked in, the timer ran ~40 min, then the appt
 * silently reverted to "confirmed" and the elapsed time was gone. Proven live: the check-in
 * never reached the server (fire-and-forget save, blocked in cache mode or dropped on flaky
 * wifi), and the next server-authoritative mirror overwrote the in-memory in-service appt.
 *
 * The fix gives check-ins the SAME durability the payment outbox gives a sale:
 *   - a durable localStorage record of any in-service visit the server hasn't stored yet,
 *   - an OVERLAY applied to every server snapshot so a stale read can't downgrade a live visit,
 *   - a drain that re-saves until the server confirms it.
 *
 * These reference implementations mirror the pure logic in src/App.jsx (reconcileCheckinOutbox
 * + the derived-outbox effect). The final block also asserts the real code still carries the
 * markers, so a removal fails loudly instead of silently regressing.
 *
 * Run:  node --test tests/           (wired into `npm run ship-check`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- reference implementations (mirror src/App.jsx) ------------------------------------------
function reconcile(serverList, box, localList = null) {
  if (!box.length) return serverList;
  const byId = new Map((serverList || []).map((a) => [String(a && a.id), a]));
  const localById = new Map((localList || []).map((a) => [String(a && a.id), a]));
  let overlaid = false;
  for (const e of box) {
    const sv = byId.get(String(e && e.id));
    if (!sv) continue;
    const landed = sv.serviceStartedAt != null || sv.status === "done" || sv.status === "cancelled" || (sv.paid && Number(sv.paid.total) > 0);
    if (landed) continue;
    const loc = localById.get(String(e.id));
    if (loc && !(loc.status === "in-service" && loc.serviceStartedAt != null)) continue; // respect a deliberate local downgrade
    byId.set(String(e.id), { ...sv, status: "in-service", serviceStartedAt: e.serviceStartedAt });
    overlaid = true;
  }
  if (!overlaid) return serverList;
  return (serverList || []).map((a) => byId.get(String(a && a.id)) || a);
}
function derive(localAppts, baseAppts) {
  const base = new Map((baseAppts || []).map((a) => [String(a && a.id), a]));
  const want = [];
  for (const a of (localAppts || [])) {
    if (a && a.status === "in-service" && a.serviceStartedAt != null) {
      const sv = base.get(String(a.id));
      if (!sv || sv.serviceStartedAt == null) want.push({ id: String(a.id), serviceStartedAt: a.serviceStartedAt });
    }
  }
  return want;
}
const START = 1_752_800_000_000; // fixed timestamp — tests must never call Date.now()

// --- reconcile: protect a live visit from a stale server copy ---------------------------------
test("reconcile overlays a stale 'confirmed' server appt back to in-service", () => {
  const server = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box);
  assert.equal(out[0].status, "in-service");
  assert.equal(out[0].serviceStartedAt, START);
});

test("reconcile leaves other appts untouched and preserves order", () => {
  const server = [
    { id: "a0", status: "confirmed" },
    { id: "a1", status: "confirmed", serviceStartedAt: null },
    { id: "a2", status: "done", serviceStartedAt: START, paid: { total: 40 } },
  ];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box);
  assert.deepEqual(out.map((a) => a.id), ["a0", "a1", "a2"]);
  assert.equal(out[0].status, "confirmed");
  assert.equal(out[1].status, "in-service");
  assert.equal(out[2].status, "done"); // untouched
});

// --- reconcile: never resurrect a legitimately-advanced visit (money safety) ------------------
test("reconcile does NOT resurrect an appt the server already stored (serviceStartedAt present)", () => {
  const server = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box);
  assert.equal(out, server); // no overlay → same reference
});

test("reconcile does NOT resurrect a PAID / done ticket (checkout must win)", () => {
  const server = [{ id: "a1", status: "done", serviceStartedAt: START, serviceEndedAt: START + 1, paid: { total: 45, tip: 5 } }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box);
  assert.equal(out[0].status, "done");
  assert.deepEqual(out[0].paid, { total: 45, tip: 5 }); // paid data is never mutated
});

test("reconcile does NOT resurrect a deliberately-cancelled appt", () => {
  const server = [{ id: "a1", status: "cancelled", serviceStartedAt: null }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box);
  assert.equal(out[0].status, "cancelled");
});

test("reconcile drops an entry whose appt is gone from the server (no crash)", () => {
  const server = [{ id: "b9", status: "confirmed" }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box);
  assert.equal(out, server); // nothing to overlay
});

test("reconcile with an empty outbox returns the same reference (fast path)", () => {
  const server = [{ id: "a1", status: "confirmed" }];
  assert.equal(reconcile(server, []), server);
});

test("reconcile respects a deliberate LOCAL reset even before the outbox is pruned (race guard)", () => {
  // Owner reset an unlanded check-in: local is 'confirmed', server is 'confirmed', outbox still has
  // the entry for one render tick. Overlaying would resurrect the visit — it must not.
  const server = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  const localAfterReset = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box, localAfterReset);
  assert.equal(out[0].status, "confirmed"); // reset respected, not resurrected
});

test("reconcile still overlays when the visit is genuinely still in progress locally", () => {
  const server = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  const localStillInService = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(server, box, localStillInService);
  assert.equal(out[0].status, "in-service");
});

test("reconcile overlays on a cold-boot where there is no local row yet", () => {
  // hydrateFromCache overlays the outbox before any live load — local is empty; still protect.
  const cached = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  const box = [{ id: "a1", serviceStartedAt: START }];
  const out = reconcile(cached, box, []);
  assert.equal(out[0].status, "in-service");
});

// --- derive: the outbox is a pure function of (local, server-baseline) ------------------------
test("derive ADDS an in-service visit the server baseline hasn't acknowledged", () => {
  const local = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  const base = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  assert.deepEqual(derive(local, base), [{ id: "a1", serviceStartedAt: START }]);
});

test("derive DROPS once the server baseline stores the start time (landed)", () => {
  const local = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  const base = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  assert.deepEqual(derive(local, base), []);
});

test("derive DROPS when the visit is reset to confirmed locally (self-cleaning)", () => {
  const local = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  const base = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  assert.deepEqual(derive(local, base), []);
});

test("derive DROPS when the visit is checked out (done) locally", () => {
  const local = [{ id: "a1", status: "done", serviceStartedAt: START, serviceEndedAt: START + 1 }];
  const base = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  assert.deepEqual(derive(local, base), []);
});

test("derive ignores an in-service appt with no start time (nothing to protect)", () => {
  const local = [{ id: "a1", status: "in-service", serviceStartedAt: null }];
  const base = [{ id: "a1", status: "confirmed" }];
  assert.deepEqual(derive(local, base), []);
});

// --- end-to-end: the exact bug can no longer happen -------------------------------------------
test("round-trip: check-in survives a stale mirror, then drops after the server confirms it", () => {
  // 1. Barber checks in. Local goes in-service; the server baseline is still 'confirmed'.
  let local = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  let base = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  let box = derive(local, base);
  assert.equal(box.length, 1); // durable record captured

  // 2. A stale server mirror arrives (server still 'confirmed'). WITHOUT the fix this reverts the
  //    timer; WITH it, reconcile overlays the check-in so the visit stays live.
  const staleServer = [{ id: "a1", status: "confirmed", serviceStartedAt: null }];
  local = reconcile(staleServer, box);
  assert.equal(local[0].status, "in-service");
  assert.equal(local[0].serviceStartedAt, START);

  // 3. The drain re-saves; the server finally stores it and echoes it back as the new baseline.
  base = [{ id: "a1", status: "in-service", serviceStartedAt: START }];
  box = derive(local, base);
  assert.deepEqual(box, []); // landed → outbox empties, no perpetual re-save
});

// --- source guard: the fix must stay in the shipped file --------------------------------------
test("[checkin-durable] markers are present in src/App.jsx", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  assert.ok(src.includes("reconcileCheckinOutbox"), "reconcileCheckinOutbox helper is gone");
  assert.ok(src.includes("CHECKIN_OUTBOX_KEY"), "durable outbox key is gone");
  assert.ok(src.includes("const localAp = reconcileCheckinOutbox(serverAp);"), "mirror overlay removed from applyServerAuthoritative");
  assert.ok(/\[checkin-durable\] SOLE WRITER of the check-in outbox/.test(src), "derived-outbox effect removed");
  assert.ok(/Keep re-saving a pending check-in until the server confirms/.test(src), "drain effect removed");
});

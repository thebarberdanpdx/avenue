/* synced-appt-preserve.test.mjs — an imported (iCal) appointment you've WORKED can never be
 * silently reverted or deleted by a re-import.
 *
 * ROOT (owner dry-run, 2026): marking an imported appt "done" reverted it to "confirmed" after a
 * re-import. Cause: reconcileFeed (src/App.jsx) and reconcileFeedServer (api/calendar-run.js) rebuilt
 * every existing synced appt from scratch — clientId:null, status:"confirmed" — so the daily cron (or a
 * manual Sync) wiped a locally-set done/checkout/check-in/client on the very next import. It hit REAL
 * synced appts too (a client who booked via the imported calendar, then got checked out).
 *
 * Fix: once a synced appt is "worked" (client attached / non-confirmed status / checked in-out / paid /
 * line items) it is a REAL appointment — preserved verbatim on re-import and never auto-cancelled.
 *
 * These reference implementations mirror the pure logic in both copies. The final block asserts the real
 * code still carries the markers so a removal fails loudly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- reference implementation (mirrors reconcileFeed / reconcileFeedServer) -------------------------
const worked = (a) => !!(a && (a.clientId || (a.status && a.status !== "confirmed") || a.serviceStartedAt != null || a.serviceEndedAt != null || (a.paid && Number(a.paid.total) > 0) || (Array.isArray(a.lineItems) && a.lineItems.length > 0) || a.hasNote || a.note || a.hasPhotos || Number(a.photos) > 0 || Number(a.price) > 0));

function toAppt(ev, existing, { feedId, providerId }) {
  if (ev.start == null) return existing || null;
  let end = ev.end != null ? ev.end : null;
  if (end == null || end <= ev.start) end = ev.start + 30;
  if (existing && worked(existing)) return { ...existing, source: "sync", _synced: true, syncUid: ev.uid, syncFeed: feedId };
  return {
    id: existing ? existing.id : ("sync_" + feedId + "_" + ev.uid),
    source: "sync", _synced: true, syncUid: ev.uid, syncFeed: feedId,
    providerId, clientId: null, serviceId: existing ? existing.serviceId : null,
    start: ev.start, end, bookedFor: ev.bookedFor,
    status: "confirmed", name: ev.summary || "", title: ev.summary || "Appointment", serviceName: ev.summary || "",
    price: 0, phone: "", hasPhotos: false, photos: 0, hasNote: false, vip: false,
  };
}

function reconcile(currentAppts, events, opts) {
  const incoming = (events || []).filter((e) => e && e.uid);
  const incomingByUid = new Map(incoming.map((e) => [e.uid, e]));
  const allSynced = (currentAppts || []).filter((a) => a && (a.source === "sync" || a._synced));
  const mine = allSynced.filter((a) => a.syncFeed === opts.feedId || (a.syncFeed == null && a.syncUid && incomingByUid.has(a.syncUid)));
  const mineSet = new Set(mine);
  const rest = (currentAppts || []).filter((a) => !mineSet.has(a));
  const byUid = new Map(); for (const a of mine) if (a.syncUid) byUid.set(a.syncUid, a);
  const kept = [];
  for (const e of incoming) { const ex = byUid.get(e.uid); const appt = toAppt(e, ex, opts); if (appt) kept.push(appt); }
  const vanished = mine.filter((a) => a.syncUid && !incomingByUid.has(a.syncUid));
  const keptWorkedOrphans = vanished.filter(worked);
  const toCancel = vanished.filter((a) => !worked(a));
  return { next: [...rest, ...kept, ...keptWorkedOrphans], cancelled: toCancel.length };
}

const OPTS = { feedId: "f1", providerId: "dan" };
const EV = { uid: "u1", start: 540, end: 590, bookedFor: "2026-07-06T16:00:00.000Z", summary: "Client · Haircut" };
const syncedBase = { id: "sync_f1_u1", source: "sync", _synced: true, syncUid: "u1", syncFeed: "f1", providerId: "dan", start: 540, end: 590, bookedFor: EV.bookedFor, status: "confirmed", clientId: null };

// --- worked() predicate ------------------------------------------------------------------------------
test("worked(): true for done / in-service / checked-in / paid / client / lineItems", () => {
  assert.equal(worked({ status: "done" }), true);
  assert.equal(worked({ status: "in-service" }), true);
  assert.equal(worked({ status: "checked-in" }), true);
  assert.equal(worked({ status: "no-show" }), true);
  assert.equal(worked({ status: "confirmed", clientId: "c1" }), true);
  assert.equal(worked({ status: "confirmed", serviceStartedAt: 123 }), true);
  assert.equal(worked({ status: "confirmed", serviceEndedAt: 123 }), true);
  assert.equal(worked({ status: "confirmed", paid: { total: 40 } }), true);
  assert.equal(worked({ status: "confirmed", lineItems: [{ x: 1 }] }), true);
});
test("worked(): false for a bare confirmed mirror block", () => {
  assert.equal(worked({ status: "confirmed", clientId: null }), false);
  assert.equal(worked({ status: "confirmed", paid: { total: 0 } }), false);
  assert.equal(worked({ status: "confirmed", lineItems: [] }), false);
});
test("worked(): true for a note / photo / price edit on a client-less synced block", () => {
  assert.equal(worked({ status: "confirmed", clientId: null, hasNote: true }), true);
  assert.equal(worked({ status: "confirmed", clientId: null, note: "brought his son" }), true);
  assert.equal(worked({ status: "confirmed", clientId: null, hasPhotos: true }), true);
  assert.equal(worked({ status: "confirmed", clientId: null, photos: 2 }), true);
  assert.equal(worked({ status: "confirmed", clientId: null, price: 35 }), true);
});
test("worked(): false for a freshly-built bare mirror (so normal sync still tracks/cancels it)", () => {
  const bare = toAppt(EV, undefined, OPTS); // price:0, photos:0, hasNote:false, no note
  assert.equal(worked(bare), false);
});

// --- toAppt preservation -----------------------------------------------------------------------------
test("THE BUG: a synced 'done' appt is NOT reverted to 'confirmed' on re-import", () => {
  const existing = { ...syncedBase, status: "done", serviceStartedAt: 111, serviceEndedAt: 222, paid: { total: 42, tip: 2 }, clientId: "c9", visitCountedAt: "2026-07-06T16:20:00Z" };
  const out = toAppt(EV, existing, OPTS);
  assert.equal(out.status, "done");           // <-- was "confirmed" before the fix
  assert.equal(out.serviceEndedAt, 222);
  assert.equal(out.clientId, "c9");
  assert.deepEqual(out.paid, { total: 42, tip: 2 }); // money summary intact
  assert.equal(out._synced, true);            // still attributed to the feed
  assert.equal(out.syncFeed, "f1");
});

test("a bare confirmed block still mirrors the outside event (time tracked)", () => {
  const existing = { ...syncedBase, status: "confirmed", start: 500, end: 550 };
  const moved = { ...EV, start: 600, end: 650 };
  const out = toAppt(moved, existing, OPTS);
  assert.equal(out.status, "confirmed");
  assert.equal(out.start, 600);               // outside calendar owns the time for a bare block
  assert.equal(out.end, 650);
});

test("a client-attached but still-confirmed synced appt keeps its client on re-import", () => {
  const existing = { ...syncedBase, status: "confirmed", clientId: "c5", name: "Walk-in Joe" };
  const out = toAppt(EV, existing, OPTS);
  assert.equal(out.clientId, "c5");
  assert.equal(out.name, "Walk-in Joe");
});

test("an unparseable event time keeps a worked appt untouched instead of dropping it", () => {
  const existing = { ...syncedBase, status: "done", paid: { total: 30 } };
  const out = toAppt({ uid: "u1", start: null }, existing, OPTS);
  assert.equal(out.status, "done");
});

// --- reconcile: keep vs cancel on a vanished event ---------------------------------------------------
test("a WORKED appt whose outside event vanished is KEPT (never auto-deleted)", () => {
  const existing = { ...syncedBase, status: "done", paid: { total: 42 } };
  const { next, cancelled } = reconcile([existing], [/* feed now empty of this uid */], OPTS);
  assert.equal(cancelled, 0);
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "done");
});

test("a BARE mirror block whose event vanished IS cancelled (removed)", () => {
  const existing = { ...syncedBase, status: "confirmed" };
  const { next, cancelled } = reconcile([existing], [], OPTS);
  assert.equal(cancelled, 1);
  assert.equal(next.length, 0);
});

test("reconcile end-to-end: done survives a re-import that still contains the event", () => {
  const existing = { ...syncedBase, status: "done", paid: { total: 42 }, serviceEndedAt: 222 };
  const { next } = reconcile([existing], [EV], OPTS);
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "done");
  assert.deepEqual(next[0].paid, { total: 42 });
});

test("reconcile never touches native (non-synced) appointments", () => {
  const native = { id: "a1", status: "done", paid: { total: 50 } };            // no source/_synced
  const bare = { ...syncedBase, status: "confirmed" };
  const { next } = reconcile([native, bare], [EV], OPTS);
  const kept = next.find((a) => a.id === "a1");
  assert.ok(kept && kept.status === "done" && kept.paid.total === 50);
});

// --- source guard: the fix must stay in BOTH copies --------------------------------------------------
test("[synced-appt-preserve] markers present in both reconcile copies", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const app = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  const cron = readFileSync(join(ROOT, "api", "calendar-run.js"), "utf8");
  for (const [name, src] of [["src/App.jsx", app], ["api/calendar-run.js", cron]]) {
    assert.ok(src.includes("synced-appt-preserve"), `${name}: marker removed`);
    assert.ok(/const worked = \(a\) =>/.test(src), `${name}: worked() predicate removed`);
    assert.ok(src.includes("worked(existing)") || src.includes("worked(ex)"), `${name}: verbatim-preserve branch removed`);
    assert.ok(src.includes("keptWorkedOrphans"), `${name}: orphan-preserve removed`);
  }
});

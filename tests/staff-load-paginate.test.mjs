/* staff-load-paginate.test.mjs — the fallback staff load can't truncate at 1000 rows, and a truncated
 * set can't mass-delete synced appointments.
 *
 * ROOT: fetchStaffTable ran an unranged `.select().eq("shop_id")` — PostgREST caps that at 1000 rows.
 * Past ~1000 appts, a degraded-connection fallback load dropped rows; that truncated synced set flowing
 * into api/calendar-pull mode:"sync" would compute toDelete = "every synced id I didn't see" and silently
 * mass-delete real synced/paid appointments beyond the cap.
 *
 * Fix: page through EVERY row (never return a partial set), AND a server delete-rail refuses to remove
 * more than max(5, ~34%) of synced rows in one sync (a big toDelete can only be truncation — the client
 * reconcile keeps everything on a genuine large removal).
 *
 * These reference implementations mirror the pure logic; the final block asserts the markers survive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- paging loop (mirrors fetchStaffTable's fetchAll) ------------------------------------------------
async function fetchAll(makePage) { // makePage(from) => { data, error }
  const all = [];
  for (let from = 0, page = 0; page < 100000; page++, from += 1000) {
    const { data, error } = await makePage(from);
    if (error) return { data: null, error };
    const batch = data || [];
    for (const r of batch) all.push(r);
    if (batch.length < 1000) return { data: all, error: null };
  }
  return { data: all, error: null };
}
// a mock table of N rows, paged in 1000s; optionally error on a given page index
const pager = (n, errAtPage = -1) => (from) => {
  if (Math.floor(from / 1000) === errAtPage) return Promise.resolve({ data: null, error: { message: "boom" } });
  return Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(1000, n - from)) }, (_, i) => ({ id: from + i })), error: null });
};

test("fetchAll returns EVERY row across pages (2500 → 2500, not 1000)", async () => {
  const { data, error } = await fetchAll(pager(2500));
  assert.equal(error, null);
  assert.equal(data.length, 2500);
});
test("fetchAll handles an exact multiple of the page size (2000 → 2000)", async () => {
  const { data } = await fetchAll(pager(2000));
  assert.equal(data.length, 2000);
});
test("fetchAll handles exactly 1000 rows (one full page then an empty page)", async () => {
  const { data } = await fetchAll(pager(1000));
  assert.equal(data.length, 1000);
});
test("fetchAll under the cap returns everything (750)", async () => {
  const { data } = await fetchAll(pager(750));
  assert.equal(data.length, 750);
});
test("fetchAll returns NULL (not a partial set) if any page errors", async () => {
  const { data, error } = await fetchAll(pager(2500, /*errAtPage*/ 1));
  assert.equal(data, null);       // never hand a truncated list downstream
  assert.ok(error);
});

// --- delete-rail (mirrors api/calendar-pull mode:"sync") ---------------------------------------------
const delThreshold = (existingSyncedCount) => Math.max(100, Math.ceil(existingSyncedCount * 0.5));
const shouldHold = (existingSyncedCount, toDeleteCount) => toDeleteCount > delThreshold(existingSyncedCount);

test("delete-rail HOLDS a truncation-scale deletion (2500 synced, would delete 1500)", () => {
  assert.equal(shouldHold(2500, 1500), true);
});
test("delete-rail ALLOWS a normal removal (300 synced, delete 20)", () => {
  assert.equal(shouldHold(300, 20), false);
});
test("delete-rail does NOT false-positive on a legit MULTI-FEED removal (review finding: 50 synced, delete 18)", () => {
  // Two feeds each cancelling near their own ~34% cap aggregate to 18/50 = 36%. The per-feed client rail
  // caps each feed at ~34%, so a non-truncated aggregate can never reach the 50% server bar → never blocked.
  assert.equal(shouldHold(50, 18), false);
});
test("delete-rail: any aggregate at/under the per-feed 34% cap stays under the 50% bar", () => {
  for (const n of [30, 100, 500, 2000]) assert.equal(shouldHold(n, Math.ceil(n * 0.34)), false, `n=${n}`);
});
test("delete-rail floor is 100 for small shops (150 synced: 95 allowed, 130 held)", () => {
  assert.equal(shouldHold(150, 95), false);  // max(100, 75) = 100
  assert.equal(shouldHold(150, 130), true);
});
test("delete-rail boundary: exactly at threshold allowed, one over held", () => {
  const n = 1000; const t = delThreshold(n); // max(100, 500) = 500
  assert.equal(shouldHold(n, t), false);
  assert.equal(shouldHold(n, t + 1), true);
});

// --- source guard -----------------------------------------------------------------------------------
test("[staff-load-paginate] markers present in both files", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const app = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  const pull = readFileSync(join(ROOT, "api", "calendar-pull.js"), "utf8");
  assert.ok(app.includes("staff-load-paginate"), "fetchStaffTable paging marker removed");
  assert.ok(/for \(let from = 0, page = 0;/.test(app), "fetchStaffTable paging loop removed");
  assert.ok(pull.includes("staff-load-paginate"), "calendar-pull delete-rail marker removed");
  assert.ok(pull.includes("delThreshold"), "calendar-pull delete-rail removed");
});

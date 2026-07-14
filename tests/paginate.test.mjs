// Pagination safety net — locks in the fix for the "only 1000 rows" truncation.
//
// PostgREST caps an unranged .select() at 1000 rows. selectAllRows() pages past that.
// Part 1 exercises the helper's paging/aggregation/error behavior directly.
// Part 2 is a REGRESSION LOCK: every endpoint that loads a full table must keep using
// selectAllRows, so a future refactor can't silently drop pagination and re-truncate at
// 1000 (ship-check's GUARDS list only scans src/App.jsx, so the api/ side is locked here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAllRows, PGREST_PAGE } from "../lib/paginate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A fake PostgREST table: makeQuery() returns a fresh builder each call (as the real one is
// single-use). .range(from,to) returns that slice. Records every (from,to) it was asked for.
function fakeTable(totalRows, { errorOnPage = null, pageSize = PGREST_PAGE } = {}) {
  const rows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  const calls = [];
  const make = () => ({
    range(from, to) {
      const page = calls.length;
      calls.push([from, to]);
      if (errorOnPage != null && page === errorOnPage) return Promise.resolve({ data: null, error: { message: "boom" } });
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  });
  make.calls = calls;
  return make;
}

test("returns every row across multiple pages (2500 → 1000+1000+500)", async () => {
  const t = fakeTable(2500);
  const { data, error } = await selectAllRows(t);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("does not stop at the 1000-row cap (regression: the reported bug)", async () => {
  const { data } = await selectAllRows(fakeTable(1001));
  assert.equal(data.length, 1001);
});

test("exact multiple of page size fetches one more (empty) page then stops", async () => {
  const t = fakeTable(2000);
  const { data } = await selectAllRows(t);
  assert.equal(data.length, 2000);
  assert.equal(t.calls.length, 3); // 1000, 1000, then 0-row page terminates
});

test("single short page returns immediately (one call)", async () => {
  const t = fakeTable(42);
  const { data } = await selectAllRows(t);
  assert.equal(data.length, 42);
  assert.equal(t.calls.length, 1);
});

test("empty table returns []", async () => {
  const { data, error } = await selectAllRows(fakeTable(0));
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test("custom page size pages correctly (5 rows, size 2 → 2+2+1)", async () => {
  const t = fakeTable(5, { pageSize: 2 });
  const { data } = await selectAllRows(t, 2);
  assert.equal(data.length, 5);
  assert.deepEqual(t.calls, [[0, 1], [2, 3], [4, 5]]);
});

test("error mid-paging returns the pages gathered so far plus the error", async () => {
  const { data, error } = await selectAllRows(fakeTable(2500, { errorOnPage: 1 }));
  assert.ok(error, "error propagated");
  assert.equal(data.length, 1000); // page 0 succeeded before page 1 failed
});

// ── Regression lock: full-table loaders must keep paginating ──────────────────
// minimum count of selectAllRows( occurrences per file (one per full-table read).
const MUST_PAGINATE = [
  ["api/sync-pull.js", 4],       // clients + appointments, in both pull and save modes
  ["api/send-reminders.js", 2],  // appointments + clients
  ["api/stripe.js", 1],          // global appointment scan for refund/webhook match
  ["api/client-code.js", 1],     // client recognition/login lookup
  ["api/notify.js", 1],          // SMS opt-out safety scan
  ["api/send-birthdays.js", 1],  // birthday recipients
  ["api/ical/[shop]/[file].js", 1], // exported calendar feed
  ["api/calendar-run.js", 1],    // iCal reconcile — existing appts
  ["api/calendar-pull.js", 1],   // iCal reconcile — existing appts
];

for (const [rel, min] of MUST_PAGINATE) {
  test(`${rel} still paginates full-table reads (≥${min}× selectAllRows)`, () => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const count = src.split("selectAllRows(").length - 1;
    assert.ok(count >= min, `${rel}: expected ≥${min} selectAllRows( calls, found ${count} — a full-table read reverted to an unranged .select() and will re-truncate at 1000 rows`);
    assert.ok(/paginate\.js"/.test(src), `${rel}: must import the paginate helper`);
  });
}

test("MasterCalendar (src/App.jsx) paginates its cross-shop appt load", () => {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  assert.ok(app.includes("PGREST_PAGINATE_ALL"), "MasterCalendar paginate marker present");
});

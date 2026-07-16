/* visit-stamp.test.mjs — locks the checkout visit-stamp logic.
 *
 * stampVisitOnClient(client, appt) advances the client's lastVisit to the visit date and bumps visits
 * by one, so the rebook / overdue radar builds from real checkouts. Extracted live from src/App.jsx
 * (like the other tests) so it always tracks the shipped code. Idempotency (count each appt once) lives
 * at the call site via the appt's visitCountedAt flag; this test covers the pure advance/bump rules.
 *
 * Run:  node --test tests/           (also wired into `npm run ship-check`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

const START = "function stampVisitOnClient(c, appt) {";
const s = src.indexOf(START);
if (s === -1) throw new Error("visit-stamp.test: stampVisitOnClient not found in src/App.jsx (renamed?) — refusing to pass");
const end = src.indexOf("\n}", s);
if (end === -1) throw new Error("visit-stamp.test: end of stampVisitOnClient not found — refusing to pass");
// eslint-disable-next-line no-new-func
const stampVisitOnClient = new Function(src.slice(s, end + 2) + "\nreturn stampVisitOnClient;")();

const CS = "function deriveCadenceForClient(appts, clientId, thisAppt) {";
const cs = src.indexOf(CS);
if (cs === -1) throw new Error("visit-stamp.test: deriveCadenceForClient not found in src/App.jsx (renamed?) — refusing to pass");
const ce = src.indexOf("\n}", cs);
if (ce === -1) throw new Error("visit-stamp.test: end of deriveCadenceForClient not found — refusing to pass");
// eslint-disable-next-line no-new-func
const deriveCadenceForClient = new Function(src.slice(cs, ce + 2) + "\nreturn deriveCadenceForClient;")();

// done appts bypass the `< now` date filter (status === "done"), so these are time-independent.
const done = (clientId, ...isoDates) => isoDates.map((d, i) => ({ id: `a${i}`, clientId, status: "done", bookedFor: d }));

const APPT = (bookedFor) => ({ id: "a1", clientId: "c1", bookedFor });

test("bumps visits by one", () => {
  assert.equal(stampVisitOnClient({ visits: 3, lastVisit: "2026-01-01T00:00:00.000Z" }, APPT("2026-07-16T18:00:00.000Z")).visits, 4);
});

test("advances lastVisit to a newer visit date", () => {
  assert.equal(stampVisitOnClient({ visits: 1, lastVisit: "2026-01-01T00:00:00.000Z" }, APPT("2026-07-16T18:00:00.000Z")).lastVisit, "2026-07-16T18:00:00.000Z");
});

test("never rewinds lastVisit when checking out an OLDER (backfilled) ticket", () => {
  const out = stampVisitOnClient({ visits: 2, lastVisit: "2026-07-10T00:00:00.000Z" }, APPT("2026-01-01T00:00:00.000Z"));
  assert.equal(out.lastVisit, "2026-07-10T00:00:00.000Z"); // keeps the newer visit
  assert.equal(out.visits, 3);                              // still counts the visit
});

test("first-ever visit: no prior lastVisit → sets it, visits 0 → 1", () => {
  const out = stampVisitOnClient({ visits: 0 }, APPT("2026-07-16T18:00:00.000Z"));
  assert.equal(out.lastVisit, "2026-07-16T18:00:00.000Z");
  assert.equal(out.visits, 1);
});

test("tolerates a missing visits field (undefined → 1)", () => {
  assert.equal(stampVisitOnClient({ id: "c1" }, APPT("2026-07-16T18:00:00.000Z")).visits, 1);
});

test("preserves the client's other fields", () => {
  const out = stampVisitOnClient({ id: "c1", name: "Sam", phone: "5035551234", visits: 5, lastVisit: "2026-01-01T00:00:00.000Z", notes: "keep me" }, APPT("2026-07-16T18:00:00.000Z"));
  assert.equal(out.id, "c1");
  assert.equal(out.name, "Sam");
  assert.equal(out.phone, "5035551234");
  assert.equal(out.notes, "keep me");
});

test("falls back to 'now' when the appt has no bookedFor (still bumps, sets a valid ISO)", () => {
  const out = stampVisitOnClient({ visits: 0 }, { id: "a1", clientId: "c1" });
  assert.equal(out.visits, 1);
  assert.ok(typeof out.lastVisit === "string" && !Number.isNaN(new Date(out.lastVisit).getTime()));
});

// ─── deriveCadenceForClient: avg gap between visits ──────────────────────────
test("cadence: two visits 14 days apart → 14", () => {
  assert.equal(deriveCadenceForClient(done("c1", "2026-06-01T12:00:00.000Z", "2026-06-15T12:00:00.000Z"), "c1"), 14);
});

test("cadence: averages multiple gaps (7 then 21 → 14)", () => {
  assert.equal(deriveCadenceForClient(done("c1", "2026-05-01T12:00:00.000Z", "2026-05-08T12:00:00.000Z", "2026-05-29T12:00:00.000Z"), "c1"), 14);
});

test("cadence: fewer than 2 visits → null (can't form a gap)", () => {
  assert.equal(deriveCadenceForClient(done("c1", "2026-06-01T12:00:00.000Z"), "c1"), null);
  assert.equal(deriveCadenceForClient([], "c1"), null);
});

test("cadence: only counts the given client's visits", () => {
  const appts = [...done("c1", "2026-06-01T12:00:00.000Z", "2026-06-15T12:00:00.000Z"), ...done("c2", "2026-01-01T12:00:00.000Z")];
  assert.equal(deriveCadenceForClient(appts, "c1"), 14);
});

test("cadence: ignores cancelled/block appts", () => {
  const appts = [
    { id: "a1", clientId: "c1", status: "done", bookedFor: "2026-06-01T12:00:00.000Z" },
    { id: "a2", clientId: "c1", status: "cancelled", bookedFor: "2026-06-02T12:00:00.000Z" },
    { id: "a3", clientId: "c1", status: "done", bookedFor: "2026-06-15T12:00:00.000Z" },
  ];
  assert.equal(deriveCadenceForClient(appts, "c1"), 14);
});

test("cadence: folds in the just-completed appt (dedupes if already present)", () => {
  // one prior visit + this checkout's appt = two dates → a real gap
  const prior = done("c1", "2026-06-01T12:00:00.000Z");
  const thisAppt = { id: "a9", clientId: "c1", status: "in-service", bookedFor: "2026-06-15T12:00:00.000Z" };
  assert.equal(deriveCadenceForClient(prior, "c1", thisAppt), 14);
  // idempotent: passing an appt already in the list doesn't create a phantom 0-gap
  assert.equal(deriveCadenceForClient(done("c1", "2026-06-01T12:00:00.000Z", "2026-06-15T12:00:00.000Z"), "c1", { clientId: "c1", status: "done", bookedFor: "2026-06-15T12:00:00.000Z" }), 14);
});

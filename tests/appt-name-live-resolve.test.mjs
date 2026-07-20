/* appt-name-live-resolve.test.mjs — an appointment's displayed name must follow the LIVE client.
 *
 * ROOT (proven against prod): client c178…236 was renamed "Test Golden" → "Dan Golden", but all 9 of
 * their appointments still stored name:"Test Golden". apptDisplayName early-returned that stale copy
 * (`if (!placeholder && !a.familyMemberId) return a.name`) instead of resolving the live client by
 * clientId — so the calendar kept showing the old name after a rename.
 *
 * Fix: resolve through the linked client / family member FIRST (live name wins); fall back to the
 * stored name only for walk-ins / unlinked appts / before clients have loaded.
 *
 * This mirrors the pure resolver; the last block asserts the guard marker survives in both files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// mirror of apptDisplayName (src/App.jsx)
const apptDisplayName = (a, clients = []) => {
  if (!a) return "";
  const c = (clients || []).find((x) => x.id === a.clientId);
  if (a.familyMemberId && c) {
    const m = (c.family || []).find((f) => f.id === a.familyMemberId);
    if (m && m.name) return m.name;
  }
  if (!a.familyMemberId && c && c.name) return c.name;
  if (a.name && a.name !== "Me") return a.name;
  return (c && c.name) || "Client";
};

const CLIENTS = [
  { id: "c1", name: "Dan Golden", family: [{ id: "f1", name: "Kid Golden" }] }, // renamed from "Test Golden"
  { id: "c2", name: "Walk-in Wanda", family: [] },
];

test("REPORTED BUG: a renamed client shows the LIVE name, not the stored copy", () => {
  const appt = { clientId: "c1", name: "Test Golden" }; // stale stored name
  assert.equal(apptDisplayName(appt, CLIENTS), "Dan Golden");
});

test("family member: their current name wins over the appt's stored name", () => {
  const appt = { clientId: "c1", familyMemberId: "f1", name: "Test Golden Jr" };
  assert.equal(apptDisplayName(appt, CLIENTS), "Kid Golden");
});

test("family member renamed: live member name wins", () => {
  const clients = [{ id: "c1", name: "Dan Golden", family: [{ id: "f1", name: "Renamed Kid" }] }];
  const appt = { clientId: "c1", familyMemberId: "f1", name: "Old Kid" };
  assert.equal(apptDisplayName(appt, clients), "Renamed Kid");
});

test("self-booking placeholder 'Me' resolves to the linked client's name", () => {
  const appt = { clientId: "c2", name: "Me" };
  assert.equal(apptDisplayName(appt, CLIENTS), "Walk-in Wanda");
});

test("walk-in / unlinked appt (no matching client) keeps its stored name", () => {
  const appt = { clientId: "ghost", name: "Cash Customer" };
  assert.equal(apptDisplayName(appt, CLIENTS), "Cash Customer");
});

test("clients not yet loaded (empty array) falls back to the stored name — never blank", () => {
  const appt = { clientId: "c1", name: "Test Golden" };
  assert.equal(apptDisplayName(appt, []), "Test Golden");
});

test("no name and no client resolves to 'Client', never a bare 'Me'", () => {
  assert.equal(apptDisplayName({ clientId: "ghost", name: "Me" }, CLIENTS), "Client");
  assert.equal(apptDisplayName({ clientId: "ghost" }, CLIENTS), "Client");
});

test("null appt is safe", () => {
  assert.equal(apptDisplayName(null, CLIENTS), "");
});

test("[appt-name-live-resolve] guard markers present in App.jsx and ship-check", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const app = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  const ship = readFileSync(join(ROOT, "scripts", "ship-check.mjs"), "utf8");
  assert.ok(app.includes("appt-name-live-resolve"), "resolver marker removed from App.jsx");
  // the early-return of the stale stored name must NOT come back
  assert.ok(!/if \(!placeholder && !a\.familyMemberId\) return a\.name;/.test(app), "stale-name early return reintroduced");
  assert.ok(ship.includes("appt-name-live-resolve"), "GUARD entry removed from ship-check");
});

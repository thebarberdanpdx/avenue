/* resolvers.test.mjs — the money/logic safety net.
 *
 * Locks the pure pricing / duration / order resolvers that live inside src/App.jsx.
 * Instead of importing App.jsx (which pulls in React/Supabase/`window`), it EXTRACTS the
 * live resolver source from the file at run time and executes it in isolation — so the
 * test always tracks the real code, needs zero dependencies, and never touches the app.
 *
 * Run:  node --test tests/           (also wired into `npm run ship-check`)
 * A missing/renamed resolver block FAILS loudly (never a silent pass).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");

// Extract the contiguous pure-resolver block: `function cancelWindowMinutes` … end of `answerPriceFor`.
const START = "function cancelWindowMinutes(business) {";
const END_ANCHOR = "return Number(opt && opt.price) || 0;";
const s = src.indexOf(START);
const eA = src.indexOf(END_ANCHOR);
if (s === -1 || eA === -1 || eA < s) {
  throw new Error("resolvers.test: could not locate the resolver block in src/App.jsx (markers moved?) — refusing to pass");
}
const end = src.indexOf("};", eA);
if (end === -1) throw new Error("resolvers.test: could not find end of answerPriceFor — refusing to pass");
const block = src.slice(s, end + 2);

// Sanity: the block must actually contain the functions we test, or a rename slipped past us.
// Second block: the time-of-day price resolver + the booking-locked price (both depend on getPrice,
// which the first block already defines, so this block is appended AFTER it in the module).
const P_START = "const priceWithTimeRules = (service, providerId, dateObj, startMin) => {";
const P_END_ANCHOR = "const lockedApptPrice = (appt, service) =>";
const ps = src.indexOf(P_START);
const pe = src.indexOf(P_END_ANCHOR);
if (ps === -1 || pe === -1 || pe < ps) {
  throw new Error("resolvers.test: could not locate the price-time-rules block in src/App.jsx — refusing to pass");
}
const pEnd = src.indexOf("\n", pe); // lockedApptPrice is a one-liner
if (pEnd === -1) throw new Error("resolvers.test: could not find end of lockedApptPrice — refusing to pass");
const block2 = src.slice(ps, pEnd);

const NAMES = ["cancelWindowMinutes","getStaffEntry","getDuration","overdueBufferMin","getPrice",
  "byServiceOrder","cutStylePrice","cutStyleDuration","addonDuration","addonPriceFor",
  "cleanServiceLabel","answerDuration","answerPriceFor","priceWithTimeRules","lockedApptPrice"];
for (const n of NAMES) {
  const inBlock1 = new RegExp(`(const|function)\\s+${n}\\b`).test(block);
  const inBlock2 = new RegExp(`(const|function)\\s+${n}\\b`).test(block2);
  if (!inBlock1 && !inBlock2) {
    throw new Error(`resolvers.test: resolver '${n}' not found in the extracted source — refusing to pass`);
  }
}
const moduleSrc = block + "\n" + block2 + `\nexport { ${NAMES.join(", ")} };`;
const R = await import("data:text/javascript," + encodeURIComponent(moduleSrc));

// ─── getPrice: per-staff price → service default ───────────────────────────
test("getPrice: staff override beats service default", () => {
  const svc = { id: "cut", price: 42, staff: { dan: { price: 50 }, jr: {} } };
  assert.equal(R.getPrice(svc, "dan"), 50);          // staff override
  assert.equal(R.getPrice(svc, "jr"), 42);            // staff entry with no price → service default
  assert.equal(R.getPrice(svc, "unknown"), 42);       // no staff entry → service default
});
test("getPrice: a staff price of 0 is honored (free service), not treated as unset", () => {
  const svc = { id: "x", price: 42, staff: { dan: { price: 0 } } };
  assert.equal(R.getPrice(svc, "dan"), 0);
});

// ─── getDuration: client override → staff → service ────────────────────────
test("getDuration: client customDuration wins, incl. a deliberate 0", () => {
  const svc = { id: "cut", duration: 45, staff: { dan: { duration: 35 } } };
  assert.equal(R.getDuration({ customDurations: { cut: 20 } }, svc, "dan"), 20); // client override
  assert.equal(R.getDuration({ customDurations: { cut: 0 } }, svc, "dan"), 0);   // 0 respected (audit #61)
  assert.equal(R.getDuration(null, svc, "dan"), 35);                             // staff default
  assert.equal(R.getDuration(null, svc, "jr"), 45);                              // service default
});

// ─── byServiceOrder: deterministic, id-tiebroken ───────────────────────────
test("byServiceOrder: sorts by order then stable id tiebreak", () => {
  const list = [{ id: "b", order: 1 }, { id: "a", order: 0 }, { id: "c", order: 2 }];
  assert.deepEqual([...list].sort(R.byServiceOrder).map(x => x.id), ["a", "b", "c"]);
});
test("byServiceOrder: missing orders never reshuffle (input order is irrelevant)", () => {
  const a = [{ id: "shave" }, { id: "cut" }, { id: "beard" }, { id: "z", order: 4 }];
  const forward = [...a].sort(R.byServiceOrder).map(x => x.id);
  const reversed = [...a].reverse().sort(R.byServiceOrder).map(x => x.id);
  assert.deepEqual(forward, reversed);                 // deterministic regardless of DB return order
  assert.deepEqual(forward, ["z", "beard", "cut", "shave"]); // z(order 4) first (4<1e9), rest id-sorted
});

// ─── cut-style + add-on + answer cascades ──────────────────────────────────
test("cutStylePrice: staff cutPrice → style price → service/staff price", () => {
  const svc = { id: "cut", price: 40, cutTypes: [{ id: "fade", price: 55 }], staff: { dan: { price: 45, cutPrice: { fade: 60 } }, jr: { price: 45 } } };
  assert.equal(R.cutStylePrice(svc, "dan", "fade"), 60); // staff cutPrice override
  assert.equal(R.cutStylePrice(svc, "jr", "fade"), 55);  // style's own price
  assert.equal(R.cutStylePrice(svc, "jr", "none"), 45);  // falls to staff/service price
});
test("cutStyleDuration: base duration + style extra minutes", () => {
  const svc = { id: "cut", duration: 30, cutTypes: [{ id: "fade", min: 10 }], staff: { dan: { duration: 30 } } };
  assert.equal(R.cutStyleDuration(null, svc, "dan", "fade"), 40); // 30 + 10
});
test("addonPriceFor / addonDuration: per-barber override → item default", () => {
  const svc = { id: "cut", staff: { dan: { addonPrice: { g1: 12 }, addonDur: { g1: 8 } } } };
  const group = { id: "g1", item: { price: 10, min: 5 } };
  assert.equal(R.addonPriceFor(svc, "dan", group), 12);
  assert.equal(R.addonDuration(svc, "dan", group), 8);
  assert.equal(R.addonPriceFor(svc, "jr", group), 10);  // no override → item default
  assert.equal(R.addonDuration(svc, "jr", group), 5);
});
test("answerPriceFor / answerDuration: per-barber answer override → option default", () => {
  const svc = { id: "cut", staff: { dan: { answerPrice: { g1: { fade: 7 } }, answerDur: { g1: { fade: 6 } } } } };
  const group = { id: "g1" }, opt = { id: "fade", price: 5, min: 4 };
  assert.equal(R.answerPriceFor(svc, "dan", group, opt), 7);
  assert.equal(R.answerDuration(svc, "dan", group, opt), 6);
  assert.equal(R.answerPriceFor(svc, "jr", group, opt), 5); // option default
  assert.equal(R.answerDuration(svc, "jr", group, opt), 4);
});

// ─── cancelWindowMinutes: the leadTimeMin:0 bug guard ──────────────────────
test("cancelWindowMinutes: explicit cancelWindowMin wins (incl. 0)", () => {
  assert.equal(R.cancelWindowMinutes({ booking: { cancelWindowMin: 180 } }), 180);
  assert.equal(R.cancelWindowMinutes({ booking: { cancelWindowMin: 0 } }), 0);
});
test("cancelWindowMinutes: leadTimeMin:0 must NOT become a 0-hour window (the reschedule bug)", () => {
  // leadTimeMin is a booking floor, not a cancel window; a 0 there must fall through to the 12h default.
  assert.equal(R.cancelWindowMinutes({ booking: { leadTimeMin: 0 } }), 720);
  assert.equal(R.cancelWindowMinutes({ booking: { leadTimeMin: 120 } }), 120); // a real positive lead is honored
  assert.equal(R.cancelWindowMinutes({}), 720);                                // nothing set → 12h
});

// ─── overdueBufferMin ──────────────────────────────────────────────────────
test("overdueBufferMin: adds minutes only once past threshold, 0 otherwise", () => {
  const biz = { overdueBuffer: { enabled: true, thresholdWeeks: 10, addMinutes: 15 } };
  const long = new Date(Date.now() - 20 * 7 * 86400000).toISOString();
  const recent = new Date(Date.now() - 2 * 7 * 86400000).toISOString();
  assert.equal(R.overdueBufferMin({ lastVisit: long }, biz), 15);
  assert.equal(R.overdueBufferMin({ lastVisit: recent }, biz), 0);
  assert.equal(R.overdueBufferMin({ lastVisit: long }, { overdueBuffer: { enabled: false } }), 0);
  assert.equal(R.overdueBufferMin(null, biz), 0);
});

// ─── priceWithTimeRules: time-of-day pricing ───────────────────────────────
test("priceWithTimeRules: no rules → base price", () => {
  const svc = { id: "cut", price: 40, staff: {} };
  assert.equal(R.priceWithTimeRules(svc, "dan", new Date("2026-07-13T10:00:00"), 600), 40);
});
test("priceWithTimeRules: a matching 'more' rule raises the price; outside the window it doesn't", () => {
  // Monday 10:00 (minute 600). Rule: +$10 flat, all staff, minutes 540–660.
  const svc = { id: "cut", price: 40, staff: {}, timeRules: [{ priceMode: "more", amountType: "flat", amount: 10, start: 540, end: 660 }] };
  const mon = new Date("2026-07-13T10:00:00"); // a Monday
  assert.equal(R.priceWithTimeRules(svc, "dan", mon, 600), 50); // inside window → +10
  assert.equal(R.priceWithTimeRules(svc, "dan", mon, 700), 40); // outside window → base
});
test("priceWithTimeRules: a 'less' percent rule discounts and never goes negative", () => {
  const svc = { id: "cut", price: 40, staff: {}, timeRules: [{ priceMode: "less", amountType: "percent", amount: 25, start: 0, end: 1440 }] };
  assert.equal(R.priceWithTimeRules(svc, "dan", new Date("2026-07-13T10:00:00"), 600), 30); // 40 - 25%
});

// ─── lockedApptPrice: the price frozen at booking ──────────────────────────
test("lockedApptPrice: uses the appt's locked price, else falls back to current service price", () => {
  const svc = { id: "cut", price: 40, staff: { dan: { price: 55 } } };
  assert.equal(R.lockedApptPrice({ price: 33, providerId: "dan" }, svc), 33); // frozen price wins
  assert.equal(R.lockedApptPrice({ price: 0, providerId: "dan" }, svc), 0);   // a locked 0 is honored
  assert.equal(R.lockedApptPrice({ providerId: "dan" }, svc), 55);            // no locked price → current
  assert.equal(R.lockedApptPrice({}, null), 0);                               // nothing → 0
});

// ─── cleanServiceLabel ─────────────────────────────────────────────────────
test("cleanServiceLabel: prompt→thing, drop article, first two words", () => {
  assert.equal(R.cleanServiceLabel("Want a facial?"), "Facial");
  assert.equal(R.cleanServiceLabel("The Gentleman's Facial"), "Gentleman's Facial");
  assert.equal(R.cleanServiceLabel("Hot Towel & Straight Razor"), "Hot Towel");
  assert.equal(R.cleanServiceLabel("Skin fade or specialty style"), "Skin fade");
});

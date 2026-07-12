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
// Per-function extractor (brace-matched) for standalone pure helpers elsewhere in the file.
function grab(name) {
  const m = src.match(new RegExp(`(?:const|function)\\s+${name}\\b`));
  if (!m) throw new Error(`resolvers.test: '${name}' not found in src/App.jsx — refusing to pass`);
  let i = src.indexOf("{", m.index);
  if (i === -1) throw new Error(`resolvers.test: no body found for '${name}' — refusing to pass`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  if (src[i] === ";") i++;
  return src.slice(m.index, i);
}
// The consolidation migration references one string constant — pull it in first (no braces → line grab).
const CUT_DESC_LINE = (src.match(/const CONSOLIDATE_CUT_DESC = "[^"]*";/) || [])[0];
if (!CUT_DESC_LINE) throw new Error("resolvers.test: CONSOLIDATE_CUT_DESC not found in src/App.jsx — refusing to pass");
const SHOP_TZ_LINE = (src.match(/const SHOP_TZ = "[^"]*";/) || [])[0];
if (!SHOP_TZ_LINE) throw new Error("resolvers.test: SHOP_TZ not found in src/App.jsx — refusing to pass");
const EXTRA = ["resolveDiscount", "apptHoldsSlot", "apptDisplayName", "splitCutStyleServices", "consolidateHaircutMenu", "hoursForDate", "computeCheckoutMoney", "shopWallToInstant"];
const extraSrc = CUT_DESC_LINE + "\n" + SHOP_TZ_LINE + "\n" + EXTRA.map(grab).join("\n");
// computeFreeSlots has a destructuring parameter ({...}), which grab()'s brace-matcher
// mistakes for the body — extract it by anchors instead. It depends on hoursForDate +
// apptHoldsSlot, both already pulled in above.
const CFS_START = "function computeFreeSlots(";
const CFS_END_ANCHOR = "return out.sort((a, b) => a.start - b.start);";
const cfsS = src.indexOf(CFS_START), cfsE = src.indexOf(CFS_END_ANCHOR);
if (cfsS === -1 || cfsE === -1 || cfsE < cfsS) throw new Error("resolvers.test: could not locate computeFreeSlots in src/App.jsx — refusing to pass");
const cfsEnd = src.indexOf("}", cfsE);
if (cfsEnd === -1) throw new Error("resolvers.test: could not find end of computeFreeSlots — refusing to pass");
const cfsSrc = src.slice(cfsS, cfsEnd + 1);
const ALL = [...NAMES, ...EXTRA, "computeFreeSlots"];
const moduleSrc = block + "\n" + block2 + "\n" + extraSrc + "\n" + cfsSrc + `\nexport { ${ALL.join(", ")} };`;
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

// ─── resolveDiscount: what actually comes off the bill at checkout ─────────
test("resolveDiscount: percent and flat, clamped to [0, gross]", () => {
  assert.equal(R.resolveDiscount({ type: "percent", value: 25 }, 80), 20);   // 25% of 80
  assert.equal(R.resolveDiscount({ type: "amount", value: 15 }, 80), 15);     // flat $15
  assert.equal(R.resolveDiscount({ type: "amount", value: 500 }, 80), 80);    // never more than the gross
  assert.equal(R.resolveDiscount({ type: "percent", value: -10 }, 80), 0);    // negative → 0, never adds money
  assert.equal(R.resolveDiscount(null, 80), 0);                               // no discount → 0
  assert.equal(R.resolveDiscount({ type: "percent", value: 10 }, 0), 0);      // nothing to discount
});

// ─── apptHoldsSlot: which appts occupy the chair (double-book rule) ────────
test("apptHoldsSlot: cancelled/done free the slot; everything else holds it", () => {
  assert.equal(R.apptHoldsSlot({ status: "confirmed" }), true);
  assert.equal(R.apptHoldsSlot({ status: "in-service" }), true);
  assert.equal(R.apptHoldsSlot({ status: "block" }), true);
  assert.equal(R.apptHoldsSlot({ status: "cancelled" }), false);
  assert.equal(R.apptHoldsSlot({ status: "done" }), false);
  assert.equal(R.apptHoldsSlot(null), false);
});

// ─── apptDisplayName: always resolve the real person, never a placeholder ──
test("apptDisplayName: resolves 'Me'/blank + family member through the client", () => {
  const clients = [{ id: "c1", name: "Dan Smith", family: [{ id: "f1", name: "Junior Smith" }] }];
  assert.equal(R.apptDisplayName({ name: "Alex", clientId: "c1" }, clients), "Alex");      // real name kept
  assert.equal(R.apptDisplayName({ name: "Me", clientId: "c1" }, clients), "Dan Smith");   // placeholder → client
  assert.equal(R.apptDisplayName({ name: "", clientId: "c1" }, clients), "Dan Smith");     // blank → client
  assert.equal(R.apptDisplayName({ name: "Me", clientId: "c1", familyMemberId: "f1" }, clients), "Junior Smith"); // family member
  assert.equal(R.apptDisplayName({ name: "Walk-in", clientId: "x" }, clients), "Walk-in"); // unknown client, real name
});

// ─── splitCutStyleServices: the retired cut-styles → standalone-services migration ─────────
test("splitCutStyleServices: one service per style + the original kept (archived)", () => {
  const svc = { id: "cut", name: "Haircut", price: 40, duration: 30, usesCutStyles: true, staff: { dan: { on: true } },
    cutTypes: [{ id: "std", label: "Standard", price: 40, min: 0 }, { id: "fade", label: "Skin fade", price: 45, min: 10 }] };
  const out = R.splitCutStyleServices([svc]);
  const active = out.filter((s) => !s.archived);
  const archived = out.filter((s) => s.archived);
  assert.equal(active.length, 2);                 // one standalone service per style
  assert.equal(archived.length, 1);               // original retained, archived (old bookings still resolve)
  assert.equal(archived[0].id, "cut");
  assert.deepEqual(active.map((s) => s.name).sort(), ["Skin fade", "Standard"]);
  assert.ok(active.every((s) => s.usesCutStyles === false && !s.cutTypes)); // new ones are flat services
});
test("splitCutStyleServices: nothing to split → returns the SAME array (idempotent, no churn)", () => {
  const list = [{ id: "shave", name: "Shave", cutTypes: [] }, { id: "beard", name: "Beard" }];
  assert.equal(R.splitCutStyleServices(list), list); // same reference
});

// ─── consolidateHaircutMenu: the "Choose your cut" question model ───────────────────────────
test("consolidateHaircutMenu: already on the new model → unchanged (idempotent)", () => {
  const list = [{ id: "cut", name: "Haircut" }, { id: "shave", name: "Shave" }]; // no cutTypes, no split children
  assert.equal(R.consolidateHaircutMenu(list), list); // same reference — never touches a hand-edited menu
});
test("consolidateHaircutMenu: a cut with cutTypes → rebuilt clean Haircut + Haircut+Beard, cutTypes gone", () => {
  const list = [{ id: "cut", name: "Haircut", price: 42, cutTypes: [{ id: "std", label: "Standard" }] }, { id: "beard", name: "Beard Trim" }];
  const out = R.consolidateHaircutMenu(list);
  const cut = out.find((s) => s.id === "cut");
  assert.ok(cut && !cut.cutTypes && cut.usesCutStyles === false); // rebuilt, cut styles removed
  assert.ok(out.find((s) => s.id === "cutbeard"));                // Haircut + Beard created
  assert.ok(out.find((s) => s.id === "beard"));                  // unrelated service preserved
});
test("consolidateHaircutMenu: drops the leftover split-child junk services", () => {
  const list = [{ id: "cut", name: "Haircut", cutTypes: [{ id: "std", label: "Standard" }] }, { id: "cut_skinfade_ab12", name: "junk" }];
  const out = R.consolidateHaircutMenu(list);
  assert.ok(!out.find((s) => s.id === "cut_skinfade_ab12")); // split-created child removed
});

// ─── computeFreeSlots: the booking availability engine ─────────────────────
// The money-critical booking rules: never offer a taken slot (double-book),
// never offer a closed day, honor the notice window, and honor daily caps.
const allDaysOn = (start = 540, end = 1020) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { on: true, start, end }]));
const daysOut = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; };      // a future date (no lead-time noise)
const onDay = (date, min = 600) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(min / 60), min % 60).toISOString();
const gridBiz = (extra = {}) => ({ booking: { timeMode: "grid", gridMin: 30, leadTimeMin: 0, ...extra } });

test("computeFreeSlots: a closed / no-hours day offers nothing", () => {
  const prov = { id: "dan", hours: {} };
  assert.deepEqual(R.computeFreeSlots({ prov, date: daysOut(30), durMin: 30, providers: [prov] }), []);
});

test("computeFreeSlots: a taken slot is never offered (double-book prevention)", () => {
  const prov = { id: "dan", hours: allDaysOn() };
  const date = daysOut(30);
  const busy = { providerId: "dan", status: "confirmed", bookedFor: onDay(date, 600), start: 600, end: 630 }; // 10:00–10:30
  const starts = R.computeFreeSlots({ prov, date, durMin: 30, providers: [prov], appts: [busy], business: gridBiz() }).map((s) => s.start);
  assert.ok(!starts.includes(600), "the taken 10:00 slot must not be offered");
  assert.ok(starts.includes(570), "9:30 (ends as the appt starts) is still bookable");
  assert.ok(starts.includes(630), "10:30 (right after the appt) is bookable");
});

test("computeFreeSlots: a cancelled appt frees its slot again", () => {
  const prov = { id: "dan", hours: allDaysOn() };
  const date = daysOut(30);
  const cancelled = { providerId: "dan", status: "cancelled", bookedFor: onDay(date, 600), start: 600, end: 630 };
  const starts = R.computeFreeSlots({ prov, date, durMin: 30, providers: [prov], appts: [cancelled], business: gridBiz() }).map((s) => s.start);
  assert.ok(starts.includes(600), "a cancelled appt does not hold the chair");
});

test("computeFreeSlots: the notice window (leadTimeMin) can push all of today out", () => {
  const prov = { id: "dan", hours: allDaysOn() };
  // 100000 minutes of required notice → today's earliest is far past close → nothing today.
  assert.deepEqual(R.computeFreeSlots({ prov, date: new Date(), durMin: 30, providers: [prov], business: gridBiz({ leadTimeMin: 100000 }) }), []);
});

test("computeFreeSlots: a full provider (maxPerDay) offers nothing", () => {
  const prov = { id: "dan", hours: allDaysOn(), maxPerDay: 1 };
  const date = daysOut(30);
  const one = { providerId: "dan", status: "confirmed", bookedFor: onDay(date, 600), start: 600, end: 630 };
  assert.deepEqual(R.computeFreeSlots({ prov, date, durMin: 30, providers: [prov], appts: [one], business: gridBiz() }), []);
});

test("computeFreeSlots: the shop daily cap limits ONLINE bookings only (#24)", () => {
  const prov = { id: "dan", hours: allDaysOn() };
  const date = daysOut(30);
  const online = { providerId: "dan", status: "confirmed", bookedOnline: true, bookedFor: onDay(date, 600), start: 600, end: 630 };
  const manual = { providerId: "dan", status: "confirmed", bookedFor: onDay(date, 600), start: 600, end: 630 }; // phone/walk-in
  // one ONLINE booking hits the cap of 1 → closed for online
  assert.deepEqual(R.computeFreeSlots({ prov, date, durMin: 30, providers: [prov], appts: [online], business: gridBiz({ dailyCap: 1 }) }), []);
  // one MANUAL booking must NOT count toward the online cap → still bookable
  const starts = R.computeFreeSlots({ prov, date, durMin: 30, providers: [prov], appts: [manual], business: gridBiz({ dailyCap: 1 }) }).map((s) => s.start);
  assert.ok(starts.length > 0, "manual appts don't consume the online daily cap");
});

test("computeFreeSlots: 'anyone' resolves to a real provider's availability", () => {
  const dan = { id: "dan", hours: allDaysOn() };
  const starts = R.computeFreeSlots({ prov: { id: "anyone" }, date: daysOut(30), durMin: 30, providers: [{ id: "anyone" }, dan], business: gridBiz() }).map((s) => s.start);
  assert.ok(starts.length > 0, "'anyone' books against a concrete provider, not an empty set");
});

// ─── computeCheckoutMoney: the checkout money math (what actually gets charged) ─────
test("computeCheckoutMoney: a plain sale — subtotal, no tip, nothing left over", () => {
  const r = R.computeCheckoutMoney({ lines: [{ price: 42 }] });
  assert.equal(r.subtotal, 42);
  assert.equal(r.tipAmt, 0);
  assert.equal(r.total, 42);
  assert.equal(r.chargeBase, 42);
  assert.equal(r.canCloseOut, false); // there's a real balance to collect
});

test("computeCheckoutMoney: a percent tip is added on top; a custom tip overrides it", () => {
  const pct = R.computeCheckoutMoney({ lines: [{ price: 40 }], tipPct: 20 });
  assert.equal(pct.tipAmt, 8);   // 20% of 40
  assert.equal(pct.total, 48);
  assert.equal(pct.chargeBase, 48);
  const custom = R.computeCheckoutMoney({ lines: [{ price: 40 }], tipPct: 20, customTip: 5 });
  assert.equal(custom.tipAmt, 5); // custom wins over the percent
  assert.equal(custom.total, 45);
});

test("computeCheckoutMoney: the tip is calculated on the DISCOUNTED total, not the gross", () => {
  const r = R.computeCheckoutMoney({ lines: [{ price: 80 }], checkoutDiscount: { type: "percent", value: 25 }, tipPct: 10 });
  assert.equal(r.discountAmt, 20); // 25% of 80
  assert.equal(r.subtotal, 60);    // 80 − 20
  assert.equal(r.tipAmt, 6);       // 10% of 60, NOT of 80
  assert.equal(r.total, 66);
});

test("computeCheckoutMoney: a deposit is credited and the tip is taken on the balance", () => {
  const r = R.computeCheckoutMoney({ lines: [{ price: 50 }], appt: { deposit: 20 }, tipPct: 10 });
  assert.equal(r.bookingCredit, 20);
  assert.equal(r.netDue, 30);       // 50 − 20 deposit
  assert.equal(r.tipAmt, 3);        // 10% of the 30 balance
  assert.equal(r.chargeBase, 33);   // balance + tip
  assert.equal(r.total, 53);        // whole ticket incl. deposit
  assert.equal(r.fullyPaidAtBooking, false);
});

test("computeCheckoutMoney: paid-in-full at booking → nothing to charge, no second tip", () => {
  const r = R.computeCheckoutMoney({ lines: [{ price: 42 }], appt: { prepaid: true, prepaidTotal: 50, prepaidTip: 8 }, tipPct: 20 });
  assert.equal(r.noNewTip, true);          // they already tipped at booking
  assert.equal(r.netDue, 0);
  assert.equal(r.tipAmt, 0);
  assert.equal(r.chargeBase, 0);
  assert.equal(r.fullyPaidAtBooking, true);
  assert.equal(r.canCloseOut, true);
});

test("computeCheckoutMoney: a reopened ticket charges only the unpaid balance, at the locked discount", () => {
  const r = R.computeCheckoutMoney({ lines: [{ price: 50 }], reopen: true, alreadyPaid: 30, appt: { paid: { discount: 5 } } });
  assert.equal(r.discountAmt, 5);   // re-applies the discount locked at first checkout
  assert.equal(r.subtotal, 45);     // 50 − 5
  assert.equal(r.balance, 15);      // 45 − 30 already paid
  assert.equal(r.chargeBase, 15);   // only the balance is charged
  assert.equal(r.noNewTip, true);   // reopen never re-tips
});

test("computeCheckoutMoney: the card-on-file surcharge is added to the charge (default 1.5%)", () => {
  const three = R.computeCheckoutMoney({ lines: [{ price: 100 }], business: { checkout: { cofSurcharge: { on: true, pct: 3 } } } });
  assert.equal(three.scOn, true);
  assert.equal(three.cofTotal, 103);       // 100 + 3%
  const dflt = R.computeCheckoutMoney({ lines: [{ price: 100 }], business: { checkout: { cofSurcharge: { on: true } } } });
  assert.equal(dflt.scPct, 1.5);
  assert.equal(dflt.cofTotal, 101.5);      // default 1.5% when no pct set
});

// ─── shopWallToInstant: bookings land at the SHOP's clock, not the booker's device ──
test("shopWallToInstant: a picked time anchors to Oregon/Pacific, correct across DST", () => {
  // 9:00 AM (540 min) on a summer day → PDT (UTC−7) → 16:00 UTC, regardless of the booker's tz
  assert.equal(R.shopWallToInstant(new Date(2026, 6, 13), 540).toISOString(), "2026-07-13T16:00:00.000Z");
  // 9:00 AM on a winter day → PST (UTC−8) → 17:00 UTC
  assert.equal(R.shopWallToInstant(new Date(2026, 0, 13), 540).toISOString(), "2026-01-13T17:00:00.000Z");
  // 2:30 PM (870 min) summer → 21:30 UTC
  assert.equal(R.shopWallToInstant(new Date(2026, 6, 13), 870).toISOString(), "2026-07-13T21:30:00.000Z");
  // midnight (0 min) summer → 07:00 UTC (the day starts at 00:00 Pacific)
  assert.equal(R.shopWallToInstant(new Date(2026, 6, 13), 0).toISOString(), "2026-07-13T07:00:00.000Z");
});

import { test } from "node:test";
// Money-safety proof for the per-barber cut-styles migration.
// The migration flips a service's cut styles to per-barber ABSOLUTE price/time (staff.choicePrice /
// staff.choiceDur, setsPrice:true). The ONLY acceptable outcome is: every barber's effective price and
// time for every style is byte-identical before and after. This test replicates the exact live resolvers
// (copied verbatim from src/App.jsx) and the new migration, then asserts no number moves — run in node.

// ---- resolvers copied verbatim from src/App.jsx ----
const getStaffEntry = (service, providerId) => (service && service.staff && providerId && service.staff[providerId]) || null;
const getDuration = (client, service, providerId) => {
  if (!service) return 0;
  if (client && client.customDurations && client.customDurations[service.id] != null) return client.customDurations[service.id];
  const se = getStaffEntry(service, providerId);
  if (se && se.duration != null) return se.duration;
  return service.duration;
};
const getPrice = (service, providerId) => {
  if (!service) return 0;
  const se = getStaffEntry(service, providerId);
  if (se && se.price != null) return se.price;
  return service.price;
};
const answerDuration = (service, providerId, group, opt) => {
  const se = getStaffEntry(service, providerId);
  const g = se && se.answerDur && group && se.answerDur[group.id];
  if (g && opt && g[opt.id] != null) return Number(g[opt.id]) || 0;
  return Number(opt && opt.min) || 0;
};
const answerPriceFor = (service, providerId, group, opt) => {
  const se = getStaffEntry(service, providerId);
  const g = se && se.answerPrice && group && se.answerPrice[group.id];
  if (g && opt && g[opt.id] != null) return Number(g[opt.id]) || 0;
  return Number(opt && opt.price) || 0;
};
const choiceStylePrice = (service, providerId, group, opt) => {
  const se = getStaffEntry(service, providerId);
  const g = se && se.choicePrice && group && se.choicePrice[group.id];
  if (g && opt && g[opt.id] != null && g[opt.id] !== "") return Number(g[opt.id]) || 0;
  if (opt && opt.price != null) return Number(opt.price) || 0;
  return getPrice(service, providerId);
};
const choiceStyleDuration = (client, service, providerId, group, opt) => {
  const se = getStaffEntry(service, providerId);
  const g = se && se.choiceDur && group && se.choiceDur[group.id];
  if (g && opt && g[opt.id] != null && g[opt.id] !== "") return Number(g[opt.id]) || 0;
  if (opt && opt.min != null && group && group.setsPrice) return Number(opt.min) || 0;
  return getDuration(client, service, providerId) + (opt && opt.min ? Number(opt.min) : 0);
};

const addonDuration = (service, providerId, group) => {
  const se = getStaffEntry(service, providerId);
  if (se && se.addonDur && group && se.addonDur[group.id] != null) return Number(se.addonDur[group.id]) || 0;
  return Number(group && group.item && group.item.min) || 0;
};
const addonPriceFor = (service, providerId, group) => {
  const se = getStaffEntry(service, providerId);
  if (se && se.addonPrice && group && se.addonPrice[group.id] != null) return Number(se.addonPrice[group.id]) || 0;
  return Number(group && group.item && group.item.price) || 0;
};
// flagCutStyleSetsPrice copied verbatim from src/App.jsx (the save-path transform).
const flagCutStyleSetsPrice = (form) => {
  if (!form || !Array.isArray(form.addonGroups)) return form;
  const gi = form.addonGroups.findIndex((g) => g && g.type === "choice" && String(g.id) === "cutchoice");
  if (gi < 0) return form;
  return { ...form, addonGroups: form.addonGroups.map((g, k) => (k === gi ? { ...g, setsPrice: true } : g)) };
};

// The single source of truth for a barber's effective price/time for a cut option, matching how the
// live booking/checkout engine resolves it TODAY (setsPrice → absolute; else base + increment).
const effPrice = (service, pid, group, opt) =>
  group.setsPrice ? choiceStylePrice(service, pid, group, opt) : (getPrice(service, pid) + answerPriceFor(service, pid, group, opt));
const effDur = (service, pid, group, opt) =>
  group.setsPrice ? choiceStyleDuration(null, service, pid, group, opt) : (getDuration(null, service, pid) + answerDuration(service, pid, group, opt));

// ---- THE MIGRATION under test (candidate for src/App.jsx) ----
// For every (barber, cut option) write the barber's CURRENT effective price+time as an absolute into
// staff[pid].choicePrice/choiceDur, then flag the group setsPrice. Idempotent. Never touches a service
// without a cutchoice group. Preserves everything else.
const CUT_ID = "cutchoice";
function migrateCutServiceToPerBarber(service, staffIds) {
  if (!service || !Array.isArray(service.addonGroups)) return service;
  const gi = service.addonGroups.findIndex((g) => g && g.type === "choice" && String(g.id) === CUT_ID);
  if (gi < 0) return service;
  const group = service.addonGroups[gi];
  const opts = group.options || [];
  if (!opts.length) return service;
  const ids = (Array.isArray(staffIds) && staffIds.length) ? staffIds : Object.keys(service.staff || {});
  const staff = { ...(service.staff || {}) };
  for (const pid of ids) {
    const se = { ...(staff[pid] || { on: true, duration: null, price: null }) };
    const cp = { ...(se.choicePrice || {}) };
    const cd = { ...(se.choiceDur || {}) };
    const cpg = {}, cdg = {};
    for (const o of opts) {
      cpg[o.id] = Math.max(0, Number(effPrice(service, pid, group, o)) || 0);
      cdg[o.id] = Math.max(0, Number(effDur(service, pid, group, o)) || 0);
    }
    cp[group.id] = cpg; cd[group.id] = cdg;
    staff[pid] = { ...se, choicePrice: cp, choiceDur: cd };
  }
  const addonGroups = service.addonGroups.map((g, k) => (k === gi ? { ...g, setsPrice: true } : g));
  return { ...service, addonGroups, staff };
}

// ---- Dan's REAL live services (from prod backup) ----
const HAIRCUT = {
  id: "cut", name: "Haircut", price: 42, duration: 45,
  staff: { dan: { on: true, price: null, duration: 35 }, heather: { on: true, price: null, duration: 45 } },
  addonGroups: [
    { id: "cutchoice", type: "choice", label: "Choose your cut", required: true, options: [
      { id: "standard", min: 0, price: 0, label: "Standard cut" },
      { id: "skinfade", min: 10, price: 5, label: "Skin fade or specialty style" },
    ] },
    { id: "facial", type: "addon", label: "Want a facial?", item: { min: 20, price: 30, name: "The Gentleman's Facial" } },
  ],
};
const CUTBEARD = {
  id: "cutbeard", name: "Haircut + Beard", price: 58, duration: 60,
  staff: { dan: { on: true, price: null, duration: 50 }, heather: { on: true, price: null, duration: 60 } },
  addonGroups: [
    { id: "cutchoice", type: "choice", label: "Choose your cut", required: true, options: [
      { id: "standard", min: 0, price: 0, label: "Standard cut" },
      { id: "skinfade", min: 10, price: 5, label: "Skin fade or specialty style" },
    ] },
    { id: "hottowel", type: "addon", label: "Hot towel finish?", item: { min: 10, price: 10, name: "Hot Towel & Straight Razor" } },
  ],
};
const STAFF = ["dan", "heather"];

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } };

function proveNoReprice(label, svc) {
  const grpBefore = svc.addonGroups.find((g) => g.id === CUT_ID);
  // snapshot every barber×option effective price+time BEFORE
  const before = {};
  for (const pid of STAFF) for (const o of grpBefore.options) before[pid + "/" + o.id] = { p: effPrice(svc, pid, grpBefore, o), d: effDur(svc, pid, grpBefore, o) };
  const migrated = migrateCutServiceToPerBarber(svc, STAFF);
  const grpAfter = migrated.addonGroups.find((g) => g.id === CUT_ID);
  eq(`${label}: setsPrice flagged`, grpAfter.setsPrice, true);
  for (const pid of STAFF) for (const o of grpAfter.options) {
    const b = before[pid + "/" + o.id];
    eq(`${label}: ${pid}/${o.id} price unchanged`, effPrice(migrated, pid, grpAfter, o), b.p);
    eq(`${label}: ${pid}/${o.id} time unchanged`, effDur(migrated, pid, grpAfter, o), b.d);
    // and the stored absolute equals the old effective (the number the owner will now SEE + edit)
    eq(`${label}: ${pid}/${o.id} stored price == effective`, migrated.staff[pid].choicePrice[CUT_ID][o.id], b.p);
    eq(`${label}: ${pid}/${o.id} stored time == effective`, migrated.staff[pid].choiceDur[CUT_ID][o.id], b.d);
  }
  // idempotency: migrating the migrated copy changes nothing
  const twice = migrateCutServiceToPerBarber(migrated, STAFF);
  eq(`${label}: idempotent`, JSON.stringify(twice.staff), JSON.stringify(migrated.staff));
  return migrated;
}

// Expected concrete numbers (hand-computed from the live data)
const m = proveNoReprice("Haircut", HAIRCUT);
eq("Haircut dan standard price", m.staff.dan.choicePrice.cutchoice.standard, 42);
eq("Haircut dan skinfade price", m.staff.dan.choicePrice.cutchoice.skinfade, 47);
eq("Haircut heather skinfade price", m.staff.heather.choicePrice.cutchoice.skinfade, 47);
eq("Haircut dan standard time", m.staff.dan.choiceDur.cutchoice.standard, 35);
eq("Haircut dan skinfade time", m.staff.dan.choiceDur.cutchoice.skinfade, 45);
eq("Haircut heather skinfade time", m.staff.heather.choiceDur.cutchoice.skinfade, 55);

const m2 = proveNoReprice("Haircut+Beard", CUTBEARD);
eq("Cutbeard dan skinfade price", m2.staff.dan.choicePrice.cutchoice.skinfade, 63);   // 58 + 5
eq("Cutbeard heather skinfade time", m2.staff.heather.choiceDur.cutchoice.skinfade, 70); // 60 + 10

// Now the owner sets Heather's skin fade to a DIFFERENT price ($55) — the whole point of the feature.
// It must NOT bleed into Dan's, and Dan's stays $47.
const m3 = JSON.parse(JSON.stringify(m));
m3.staff.heather.choicePrice.cutchoice.skinfade = 55;
const g3 = m3.addonGroups.find((g) => g.id === CUT_ID);
eq("per-barber divergence: heather skinfade", effPrice(m3, "heather", g3, g3.options[1]), 55);
eq("per-barber divergence: dan skinfade untouched", effPrice(m3, "dan", g3, g3.options[1]), 47);

// A service with NO cut styles is returned untouched (the shave).
const SHAVE = { id: "shave", name: "Shave", price: 30, duration: 30, staff: { dan: { on: true } }, addonGroups: [] };
eq("no-cutstyle service untouched", JSON.stringify(migrateCutServiceToPerBarber(SHAVE, STAFF)), JSON.stringify(SHAVE));

// ---- FULL round-trip: open(migrate) → owner edits a per-barber price → save(flag) → what checkout reads ----
// This is the money contract: an edited per-barber price must reach the booking/checkout engine intact.
{
  let svc = migrateCutServiceToPerBarber(HAIRCUT, STAFF);              // openEdit
  // owner sets Heather's Skin fade to $60 (setStaffChoicePrice writes staff.heather.choicePrice)
  svc = { ...svc, staff: { ...svc.staff, heather: { ...svc.staff.heather, choicePrice: { ...svc.staff.heather.choicePrice, cutchoice: { ...svc.staff.heather.choicePrice.cutchoice, skinfade: 60 } } } } };
  const saved = flagCutStyleSetsPrice(svc);                            // save
  const g = saved.addonGroups.find((x) => x.id === CUT_ID);
  const skin = g.options[1];
  eq("round-trip: engine reads Heather's edited $60", choiceStylePrice(saved, "heather", g, skin), 60);
  eq("round-trip: Dan's Skin fade still $47", choiceStylePrice(saved, "dan", g, skin), 47);
  eq("round-trip: Dan's Standard still $42", choiceStylePrice(saved, "dan", g, g.options[0]), 42);
  eq("round-trip: setsPrice persisted", g.setsPrice, true);
}

// ---- no-edit round-trip is a price no-op (open then save, touching nothing) ----
{
  const opened = migrateCutServiceToPerBarber(CUTBEARD, STAFF);
  const saved = flagCutStyleSetsPrice(opened);
  const g = saved.addonGroups.find((x) => x.id === CUT_ID);
  for (const pid of STAFF) for (const o of g.options) {
    // compare against the ORIGINAL live service's effective price/time
    const og = CUTBEARD.addonGroups.find((x) => x.id === CUT_ID);
    eq(`no-edit ${pid}/${o.id} price`, choiceStylePrice(saved, pid, g, o), effPrice(CUTBEARD, pid, og, o));
    eq(`no-edit ${pid}/${o.id} time`, choiceStyleDuration(null, saved, pid, g, o), effDur(CUTBEARD, pid, og, o));
  }
}

// ---- add-on per-barber: Heather charges more for the Facial; Dan keeps the default ----
{
  const facial = HAIRCUT.addonGroups.find((g) => g.id === "facial");
  eq("addon default: Dan facial $30", addonPriceFor(HAIRCUT, "dan", facial), 30);
  const withOverride = { ...HAIRCUT, staff: { ...HAIRCUT.staff, heather: { ...HAIRCUT.staff.heather, addonPrice: { facial: 40 }, addonDur: { facial: 25 } } } };
  eq("addon per-barber: Heather facial $40", addonPriceFor(withOverride, "heather", facial), 40);
  eq("addon per-barber: Heather facial 25 min", addonDuration(withOverride, "heather", facial), 25);
  eq("addon per-barber: Dan facial still $30", addonPriceFor(withOverride, "dan", facial), 30);
  eq("addon per-barber: Dan facial still 20 min", addonDuration(withOverride, "dan", facial), 20);
}

// Integrate with `node --test` (ship-check runs tests/*.test.mjs): the assertions above tally into
// pass/fail at import time; this single test fails the suite if any money-safety assertion failed.
test(`per-barber pricing money-safety (${pass + fail} assertions)`, () => {
  if (fail) throw new Error(`${fail} of ${pass + fail} per-barber money-safety assertions FAILED`);
});

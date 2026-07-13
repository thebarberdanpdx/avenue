#!/usr/bin/env node
// Pre-flight check — run BEFORE every production deploy.
//   npm run ship-check
//
// Catches the three things that can break a deploy or compliance, in one shot:
//   1) The production build compiles (vite build exits clean).
//   2) The SMS-consent phrase appears EXACTLY 4 times in src/App.jsx
//      (10DLC / toll-free carrier vetting requires this — drift can jeopardize
//      the SMS verification).
//   3) The api/ folder has AT MOST 12 serverless functions (Vercel Hobby plan
//      limit — exceeding it makes the production deploy FAIL, as happened
//      2026-06-23 when a 13th function was briefly added).
//   4) No secret keys are hardcoded in src/ or api/ (Stripe secret/restricted/
//      webhook keys, Supabase secret key). These must live ONLY in Vercel env —
//      shipping one in source would expose it to anyone who views the bundle.
//      (Public keys like pk_live_ / sb_publishable_ are fine and NOT flagged.)
//
// Exits 0 only if all pass, non-zero otherwise — so it's safe to chain:
//   npm run ship-check && npx vercel --prod --force
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONSENT_PHRASE = "reminders from Sanctuary Barber Co";
const CONSENT_REQUIRED = 4;
const MAX_FUNCTIONS = 12;

const results = [];
const record = (ok, label, detail) => results.push({ ok, label, detail });

// 1) Production build compiles.
try {
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
  record(true, "Build compiles", "vite build exited clean");
} catch (e) {
  const out = ((e.stdout?.toString() || "") + (e.stderr?.toString() || "")).trim();
  const tail = out.split("\n").slice(-6).join("\n");
  record(false, "Build compiles", "vite build FAILED:\n" + tail);
}

// 1b) Unit tests pass — the money/logic resolver safety net (pricing, duration, order, cancel-window).
//     Runs the real resolver code extracted live from src/App.jsx; a regression here blocks the deploy.
try {
  execSync("node --test tests/*.test.mjs", { cwd: ROOT, stdio: "pipe" });
  record(true, "Unit tests pass", "resolver safety net green");
} catch (e) {
  const out = ((e.stdout?.toString() || "") + (e.stderr?.toString() || "")).trim();
  const fails = out.split("\n").filter((l) => l.trim().startsWith("not ok")).slice(0, 10).join("\n");
  record(false, "Unit tests pass", "node --test FAILED:\n" + (fails || out.split("\n").slice(-10).join("\n")));
}

// 2) Consent phrase appears exactly N times.
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const count = app.split(CONSENT_PHRASE).length - 1;
  record(count === CONSENT_REQUIRED, `Consent phrase ×${CONSENT_REQUIRED}`,
    `found ${count}× "${CONSENT_PHRASE}"` + (count === CONSENT_REQUIRED ? "" : ` — expected exactly ${CONSENT_REQUIRED}`));
} catch (e) {
  record(false, `Consent phrase ×${CONSENT_REQUIRED}`, "could not read src/App.jsx: " + e.message);
}

// 3) api/ serverless function count within the plan limit.
const countApiFiles = (dir) => {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countApiFiles(p);
    else if (entry.endsWith(".js")) n += 1;
  }
  return n;
};
try {
  const fnCount = countApiFiles(join(ROOT, "api"));
  record(fnCount <= MAX_FUNCTIONS, `Serverless functions ≤ ${MAX_FUNCTIONS}`,
    `${fnCount} function file(s) under api/` + (fnCount <= MAX_FUNCTIONS ? "" : ` — over the limit by ${fnCount - MAX_FUNCTIONS}; fold one into an existing endpoint`));
} catch (e) {
  record(false, `Serverless functions ≤ ${MAX_FUNCTIONS}`, "could not scan api/: " + e.message);
}

// 4) No hardcoded secret keys in source (src/ + api/). Public keys (pk_live_,
//    sb_publishable_) are intentionally inline and are NOT in this list.
const SECRET_PATTERNS = [
  { re: /\bsk_live_[A-Za-z0-9]/, label: "Stripe LIVE secret key (sk_live_)" },
  { re: /\bsk_test_[A-Za-z0-9]/, label: "Stripe test secret key (sk_test_)" },
  { re: /\brk_live_[A-Za-z0-9]/, label: "Stripe restricted key (rk_live_)" },
  { re: /\bwhsec_[A-Za-z0-9]/, label: "Stripe webhook signing secret (whsec_)" },
  { re: /\bsb_secret_[A-Za-z0-9]/, label: "Supabase secret key (sb_secret_)" },
];
const CODE_EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs"];
const walkCode = (dir) => {
  let files = [];
  let entries;
  try { entries = readdirSync(dir); } catch (e) { return files; }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files = files.concat(walkCode(p));
    else if (CODE_EXTS.some((x) => entry.endsWith(x))) files.push(p);
  }
  return files;
};
try {
  const findings = [];
  for (const d of ["src", "api"]) {
    for (const f of walkCode(join(ROOT, d))) {
      const txt = readFileSync(f, "utf8");
      for (const { re, label } of SECRET_PATTERNS) {
        if (re.test(txt)) findings.push(`${label} in ${f.replace(ROOT + "/", "")}`);
      }
    }
  }
  record(findings.length === 0, "No hardcoded secrets in source",
    findings.length ? findings.join(" · ") : "scanned src/ + api/ — clean");
} catch (e) {
  record(false, "No hardcoded secrets in source", "scan error: " + e.message);
}

// 5) Regression lock — previously-shipped fixes that already regressed and cost the owner trust.
//    Each marker is STABLE CODE that must stay present in src/App.jsx; if a future edit removes one,
//    this check FAILS and blocks the deploy, so a "done" fix can't silently un-ship. Add to this list
//    whenever you fix a painful regression you never want to come back.
const GUARDS = [
  { needle: "table === 'providers' && rows.length", label: "staff email/phone save-backstop (never blank on save)" },
  { needle: "!hasStoredSession()", label: "staff email/phone load-gate (sanitized feed can't overwrite owner)" },
  { needle: "setTabNonce(", label: "bottom-tab tap resets to tab root" },
  { needle: "per-barber-pricing-lock", label: "per-barber price/time overrides on library questions & add-ons (service editor)" },
  { needle: "apptHoldsSlot", label: "single busy-slot rule — a shown booking time is always bookable (no false 'just taken')" },
  { needle: "pendingSaveRef", label: "flush pending saves on app-background (a checkout/edit can't be lost to an iOS swipe-away)" },
  { needle: "onCommit(appt.id, summary)", label: "checkout commits done+paid the moment 'All done' shows (not after the closing dwell)" },
  { needle: "tableBusy(", label: "session-keyed loads can't clobber a mid-save local edit (uid-keyed + busy guard)" },
  { needle: "hydrateFromCache(", label: "offline read-cache — an outage shows the last-synced calendar, never a blank screen" },
  { needle: "GUARD: login-fail-open", label: "login/auth gate fails OPEN — a failed/slow/timed-out session check can never grey out the sign-in button or brick the app" },
  { needle: "GUARD: cancel-window-lock", label: "client change/cancel window enforced everywhere — one resolver (12h default; leadTimeMin:0 can't zero it) + re-checks at action time, not just render" },
  { needle: "GUARD: conflict-next-slot-from-start", label: "conflict popup suggests the TRUE next opening — scan from the attempted start with the moved appt excluded (9:20-instead-of-9:10 bug)" },
  { needle: "outage-honest-menu", label: "public booking shows an honest 'can't load — call us' state on a failed menu load, never the DEFAULT_SERVICES demo menu masquerading as the shop's real one" },
  { needle: "loadWatchdog", label: "initial-load hang watchdog — a HANGING backend (compute-exhausted outage: requests never resolve OR reject) still forces a terminal state so the honest-menu gate fires, instead of sitting on the demo menu forever" },
  { needle: "bookTimeout", label: "booking-submit hang timeout — book_public is raced against a timeout so a hanging backend surfaces the honest 'couldn't confirm — tap again' error instead of a 'CONFIRMING…' spinner that never ends" },
  { needle: "PREBOOK_RPC_TIMEOUT_MS", label: "pre-book RPC hang timeout — the lookups + save_booking_client that run BEFORE book_public are time-boxed, so the earliest hang can't strand the submit before the book_public honest-error timeout is ever reached (root cause: bookTimeout was unreachable during a real hang)" },
  { needle: "withRpcTimeout", label: "shared RPC hang timeout — the manage-your-appointment link (lookup/cancel/reschedule/check-in) races Supabase against a timeout, so a hanging backend surfaces the honest error instead of an endless spinner (root-cause fix for the no-timeout hang class)" },
  { needle: "mirrorWatchdog", label: "staff-calendar mirror hang watchdog — a hanging backend (auth refresh / sync-pull / direct reads all hang) still reaches hydrateFromCache so staff see the last-synced calendar + an honest 'showing last synced' banner instead of being stranded mid-load" },
  { needle: "cross-device-sync", label: "staff cold-start never seeds demo appts / block the first server pull (iPad must see iPhone bookings)" },
  { needle: "fetchStaffTable", label: "staff table reads refresh stale iOS JWT before pull (iPad empty calendar/clients)" },
  { needle: "Sync problem on this device", label: "sync-gap banner when cloud has data but device shows empty" },
  { needle: "mirrorFromServer", label: "staff calendar mirrors server via api/sync-pull" },
  { needle: "blocked empty save", label: "never push empty clients/appts when server has rows" },
  { needle: "the whole shop shares one calendar", label: "all staff see every chair by default (Heather sees Dan bookings)" },
  { needle: "sync-pull allows read for valid login on small shops", label: "micro-shop sync-pull auth for Dan+Heather without provider emails on file" },
  { needle: "mergeLocalOverServer", label: "non-calendar tables still merge on refetch (waitlist/services)" },
  { needle: "flushApptsNow", label: "check-in/book/checkout save to server immediately" },
  { needle: "time blocks must flush immediately", label: "time block confirm flushes to server immediately (2s mirror stomp)" },
  { needle: "apptsRef.current", label: "server mirror merges against latest local appts (stale-closure guard)" },
  { needle: 'mode: "save"', label: "appointments/clients save via api/sync-pull service-role (iPad RLS write fix)" },
  { needle: "deletion-aware merge", label: "server mirror respects local deletes and server deletes (no resurrect)" },
  { needle: "server-authoritative-sync", label: "idle calendar sync replaces from server — no client merge" },
  { needle: "syncGuardRef", label: "auto-refresh waits for unsaved work before hard-reload during saves" },
  { needle: "mergeApptRow", label: "completed checkout beats stale in-service on cross-device sync" },
  { needle: "card-on-file-verified-only", label: "a saved card-on-file (brand + last-4) shows ONLY to a verified/signed-in client — never to an unverified booker who typed a matching phone (card disclosure + enumeration hole)" },
  { needle: "GUARD: calendar-sync-contract", label: "calendar sync contract comment block (server-authoritative model)" },
  { needle: "applyServerMirror = applyServerAuthoritative", label: "mirror pull uses authoritative replace, not merge" },
  { needle: "scheduleRtMirror", label: "realtime calendar pulls debounced when idle" },
  { needle: 'tableHasUnsavedWork("appointments") || tableHasUnsavedWork("clients")', label: "mirror skips while calendar edits are pending" },
  { needle: "deleteAppt flushes immediately", label: "deleteAppt calls flushApptsNow (cross-device delete)" },
  { needle: "service-order-dataloss", label: "services save never blanks an `order` the server has (stale device can't revert/reshuffle the menu)" },
  { needle: "byServiceOrder", label: "one deterministic menu sort (order + id tiebreak) — a missing order can't reshuffle the menu across loads" },
  { needle: "Home barber from history", label: "migration importer derives each client's home barber from their imported visit history (most-seen barber, ties→most recent) instead of defaulting everyone to one staff member — verified live on vero-mig, no unit test covers it" },
];
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const missing = GUARDS.filter((g) => !app.includes(g.needle)).map((g) => g.label);
  record(missing.length === 0, "Regression lock (shipped fixes intact)",
    missing.length ? "REMOVED: " + missing.join(" · ") + " — a shipped fix was deleted; restore it before deploy" : `all ${GUARDS.length} guarded fixes still present`);
} catch (e) {
  record(false, "Regression lock (shipped fixes intact)", "could not read src/App.jsx: " + e.message);
}

// 6) Calendar sync contract — structural checks beyond string needles (the #1 shop-critical path).
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const syncPull = readFileSync(join(ROOT, "api/sync-pull.js"), "utf8");
  const calFails = [];
  const authFn = app.match(/const applyServerAuthoritative = \(payload\) => \{[\s\S]*?\n  \};/);
  if (!authFn || authFn[0].includes("mergeLocalOverServer")) {
    calFails.push("applyServerAuthoritative must REPLACE server rows (no mergeLocalOverServer)");
  }
  if (!/server-authoritative-sync: appointments\/clients replace from server when idle/.test(app)) {
    calFails.push("refetchTable must replace appts/clients from server when idle");
  }
  if (!/if \(table === "appointments" \|\| table === "clients"\)[\s\S]*?deleteIds: toDelete/.test(app)) {
    calFails.push("appointments/clients saves must go through api/sync-pull mode:save with deleteIds");
  }
  if (!syncPull.includes('mode === "save"') || !syncPull.includes("const clients =") || !syncPull.includes("const appointments =")) {
    calFails.push("api/sync-pull save must return fresh clients + appointments after write");
  }
  if (!/const deleteAppt[\s\S]*?flushApptsNow/.test(app)) {
    calFails.push("deleteAppt must call flushApptsNow");
  }
  if (!/const confirmBlock[\s\S]*?flushApptsNow/.test(app)) {
    calFails.push("confirmBlock must call flushApptsNow");
  }
  record(calFails.length === 0, "Calendar sync contract (structural)",
    calFails.length ? calFails.join(" · ") : "server-authoritative read/write/delete path intact");
} catch (e) {
  record(false, "Calendar sync contract (structural)", "check error: " + e.message);
}

// 7) No out-of-scope variable references (eslint no-undef). This is the EXACT class of bug
//    that crashed the Settings tab on 2026-07-11 — a variable used where it isn't in scope
//    (a prop not passed down). `npm run build` does NOT catch it: it only throws when that
//    component actually renders. eslint does catch it, so gate the deploy on it. The config
//    (eslint.config.js) whitelists real globals (Node in api/lib, __BUILD_VERSION__), so any
//    no-undef here is a genuine render-crash risk, not noise.
try {
  // Use --format json (stable, in-core). eslint exits non-zero when ANY rule errors, so the
  // results come back on stdout even then — we catch and read stdout. JSON.parse throwing means
  // eslint truly failed to run (config/parse error), which we treat as a FAILED check, never a
  // false "clean". We count ONLY no-undef (the render-crash class) — other rules don't gate.
  let raw = "";
  try {
    raw = execSync("npx eslint src api lib --format json", { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (e) {
    raw = e.stdout?.toString() || "";
  }
  const parsed = JSON.parse(raw); // throws → caught below → check FAILS (safe)
  const hits = [];
  for (const file of parsed) {
    for (const m of file.messages || []) {
      if (m.ruleId === "no-undef") hits.push(`${file.filePath.replace(ROOT + "/", "")}:${m.line} — ${m.message}`);
    }
  }
  record(hits.length === 0, "No out-of-scope variables (no-undef)",
    hits.length
      ? `${hits.length} undefined-variable reference(s) — would crash at render:\n` + hits.slice(0, 6).join("\n")
      : "eslint no-undef clean across src/ api/ lib/");
} catch (e) {
  record(false, "No out-of-scope variables (no-undef)", "lint gate could not run eslint: " + String(e.message || e).slice(0, 160));
}

// Report.
console.log("\n  Pre-flight check\n  " + "─".repeat(40));
for (const r of results) {
  console.log(`  ${r.ok ? "✅" : "❌"}  ${r.label}`);
  if (r.detail) for (const line of r.detail.split("\n")) console.log(`        ${line}`);
}
const failed = results.filter((r) => !r.ok);
console.log("  " + "─".repeat(40));
if (failed.length) {
  console.log(`  ❌ ${failed.length} check(s) FAILED — do NOT deploy until fixed.\n`);
  process.exit(1);
}
console.log("  ✅ All checks passed — safe to deploy.\n");
process.exit(0);

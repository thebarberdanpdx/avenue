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
];
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const missing = GUARDS.filter((g) => !app.includes(g.needle)).map((g) => g.label);
  record(missing.length === 0, "Regression lock (shipped fixes intact)",
    missing.length ? "REMOVED: " + missing.join(" · ") + " — a shipped fix was deleted; restore it before deploy" : `all ${GUARDS.length} guarded fixes still present`);
} catch (e) {
  record(false, "Regression lock (shipped fixes intact)", "could not read src/App.jsx: " + e.message);
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

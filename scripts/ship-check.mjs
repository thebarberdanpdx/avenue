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

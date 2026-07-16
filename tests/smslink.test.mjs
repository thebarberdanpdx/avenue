/* smslink.test.mjs — the tap-to-text safety net.
 *
 * Locks the two pure helpers behind the running-late "text your next client" flow:
 *   - smsLink(number, body, isIOS)  → the sms: deep link (iOS &body= vs Android ?body=)
 *   - runningLateText(business, {…}) → fills the shop's message template for that text
 *
 * Like resolvers.test.mjs, it does NOT import App.jsx (which pulls in React/Supabase/window) —
 * it EXTRACTS the live function source from src/App.jsx at run time and executes it in isolation,
 * so the test always tracks the real shipped code. A renamed/missing function FAILS loudly.
 *
 * HONEST LIMIT: this proves the URL STRING is correct. It cannot prove iOS actually opens Messages
 * with the body prefilled — that's device-only behavior (sms: can't be triggered from Node/CI). That
 * one-tap check has to happen on a real phone after deploy.
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

// Pull one top-level `function NAME(...) { … }` out of the source by its signature line, up to the
// first column-0 `}` (these helpers have no nested column-0 braces). Returns the callable function.
function extractFn(signature, name) {
  const s = src.indexOf(signature);
  if (s === -1) throw new Error(`smslink.test: could not find \`${signature}\` in src/App.jsx (renamed?) — refusing to pass`);
  const end = src.indexOf("\n}", s);
  if (end === -1) throw new Error(`smslink.test: could not find end of ${name} — refusing to pass`);
  const block = src.slice(s, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function(block + `\nreturn ${name};`)();
}

const smsLink = extractFn("function smsLink(number, body, isIOS) {", "smsLink");
const runningLateText = extractFn("function runningLateText(business, { client, provider, range }) {", "runningLateText");

// ─── smsLink: the exact strings ──────────────────────────────────────────────
test("smsLink — iOS uses &body= and URL-encodes the body", () => {
  const body = "Hi Sam, running about 10 min behind — see you soon!";
  assert.equal(smsLink("5035551234", body, true), "sms:+15035551234&body=" + encodeURIComponent(body));
});

test("smsLink — Android/web uses ?body=", () => {
  assert.equal(smsLink("5035551234", "Hi Sam", false), "sms:+15035551234?body=Hi%20Sam");
});

test("smsLink — normalizes a formatted US 10-digit number to +1 E.164", () => {
  assert.ok(smsLink("(503) 555-1234", "x", true).startsWith("sms:+15035551234&"));
});

test("smsLink — a US 11-digit (leading 1) becomes +1…", () => {
  assert.ok(smsLink("15035551234", "x", false).startsWith("sms:+15035551234?"));
});

test("smsLink — an already-+ international number passes through untouched", () => {
  assert.ok(smsLink("+447700900123", "x", false).startsWith("sms:+447700900123?body="));
});

test("smsLink — empty / garbage number returns '' so the caller hides the link", () => {
  assert.equal(smsLink("", "x", true), "");
  assert.equal(smsLink(null, "x", true), "");
  assert.equal(smsLink("abc", "x", true), "");
});

test("smsLink — no body returns a bare sms: link (no separator)", () => {
  assert.equal(smsLink("5035551234", "", true), "sms:+15035551234");
  assert.equal(smsLink("5035551234", "", false), "sms:+15035551234");
});

test("smsLink — reserved chars in the body can't corrupt the URL", () => {
  // & ? # in the copy must be percent-encoded, never leak as query separators.
  const body = "A&B ? #1 done";
  const url = smsLink("5035551234", body, false);
  assert.equal(url, "sms:+15035551234?body=" + encodeURIComponent(body));
  const after = url.slice(url.indexOf("body=") + 5);
  assert.ok(!after.includes("&") && !after.includes("?") && !after.includes("#"), "raw reserved char leaked into body");
});

// ─── runningLateText: fills the shop's saved template (incl. {shop}/{range}) ──
test("runningLateText — fills {client} {provider} {shop} {range} from the shop template", () => {
  const biz = { name: "Sanctuary Barber Co", runningLate: { message: "Hi {client}, it's {provider} at {shop} — {range} min behind." } };
  assert.equal(
    runningLateText(biz, { client: "Sam", provider: "Dan", range: 10 }),
    "Hi Sam, it's Dan at Sanctuary Barber Co — 10 min behind.",
  );
});

test("runningLateText — falls back to a default when the shop cleared the message", () => {
  const out = runningLateText({ name: "Sanctuary" }, { client: "Sam", range: 10 });
  assert.ok(out.includes("Sam") && out.includes("10"), "default should still name the client + range");
});

test("runningLateText — tolerates missing fields and leaves no unfilled tags", () => {
  const out = runningLateText({}, {});
  assert.ok(typeof out === "string" && out.length > 0);
  for (const tag of ["{client}", "{provider}", "{shop}", "{range}", "{business}"]) {
    assert.ok(!out.includes(tag), `left an unfilled ${tag} tag`);
  }
});

// ─── end-to-end: the real link the app builds ────────────────────────────────
test("end-to-end — iOS running-late link is well-formed and body-encoded", () => {
  const biz = { name: "Sanctuary", runningLate: { message: "Hi {client}, running {range} min behind" } };
  const body = runningLateText(biz, { client: "Sam", range: 10 });
  assert.equal(smsLink("(503) 555-1234", body, true), "sms:+15035551234&body=" + encodeURIComponent("Hi Sam, running 10 min behind"));
});

// PHASE 3 (offline-first) — booking SUBMIT under a FULL backend hang (the real outage).
// The earlier booking-submit-hang.mjs hangs ONLY book_public and leaves the pre-book RPCs
// reachable — which HID a gap: commitBooking awaits save_booking_client (and, for a new
// client, lookup_client_by_phone/_by_email) BEFORE the book_public timeout. In a real
// compute-exhausted outage EVERY Supabase RPC hangs, so the submit froze on the earliest
// call and the "couldn't confirm" path never ran (dead Confirm button for the whole outage).
// This drill hangs the pre-book RPCs too and proves the honest error still appears.
//   node tests/live/booking-submit-hang-all.mjs                    (deployed gotvero.com)
//   BASE_URL=http://127.0.0.1:4173 node tests/live/booking-submit-hang-all.mjs
import { launch } from './driver.mjs';

const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const URL_ = (process.env.BASE_URL || 'https://gotvero.com') + '/?shop=vero-test#book';
const { browser, context, page, errors } = await launch();
const byRole = async (name, wait = 900) => { const el = page.getByRole('button', { name }).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };
const byText = async (re, wait = 700) => { const el = page.getByText(re).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };

// Drive to the details step with the backend fully reachable.
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2500);
// vero-test's account now has multiple locations → a "Choose a location" chooser appears first.
if (await page.getByText(/Choose a location/i).first().count()) {
  const loc = page.getByRole('button', { name: /Vero Test \(automated\)/i }).first();
  if (await loc.count()) { await loc.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(1800); }
}
if (await page.getByText(/Book here/i).first().count()) await byText(/Book here/i, 1500);
await byText(/It'?s my first time/i);
await byRole(/^Beard Trim$/i, 1400);
for (let g = 0; g < 3; g++) { if (await page.getByRole('button', { name: /^Continue$/i }).first().count()) { await byRole(/^Continue$/i); break; } if (!(await page.getByText(/Choose your cut/i).first().count())) break; await byRole(/^Standard/i); }
await byRole(/^Dan\b/, 1400) || await byRole(/First available/i, 1400);
let picked = await byRole(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
if (!picked) for (const s of [/^Morning/i, /^Afternoon/i, /^Evening/i]) { await byRole(s); if (await byRole(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)) { picked = true; break; } }
await byRole(/^Continue$/i, 1200);
const stamp = String(Date.now()).slice(-6);
await page.getByPlaceholder('First name').fill('HangAllDan').catch(() => {});
await page.getByPlaceholder('Last name').fill('Test').catch(() => {});
await page.getByPlaceholder('Email').fill(`hangall+${stamp}@vero.test`).catch(() => {});
await page.getByPlaceholder('Phone number').fill('5555551' + stamp.slice(-3)).catch(() => {});
await byText(/Consent to SMS/i, 300);
await byText(/I agree to the cancellation policy/i, 300);

// FULL HANG: every RPC on the submit path — the pre-book lookups + client save AND book_public.
// This is the real compute-exhausted outage. Before the PREBOOK_RPC_TIMEOUT_MS fix the submit
// would freeze on the FIRST of these and never reach the book_public honest-error timeout.
const HANG = /rpc\/(book_public|save_booking_client|lookup_client_by_phone|lookup_client_by_email)/i;
const hung = {};
await context.route((url) => HANG.test(url), async (route) => {
  const m = (route.request().url().match(HANG) || [])[1] || 'other';
  hung[m] = (hung[m] || 0) + 1; /* never fulfill → hang */
});

const bookedAt = Date.now();
await byRole(/^BOOK FOR/i, 1500);

// Worst case for a NEW client: phone(8s) + email(8s) + save(8s) + book_public(25s) ≈ 49s.
// Poll to ~66s. The honest error MUST appear and the spinner MUST release.
let erroredAt = null, stuckSpinner = false;
for (let s = 3; s <= 66 && erroredAt === null; s += 3) {
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText || '');
  if (/Couldn'?t confirm your booking|check your connection and tap again|wasn'?t held/i.test(t)) erroredAt = Math.round((Date.now() - bookedAt) / 1000);
  stuckSpinner = /CONFIRMING/i.test(t);
}
await page.screenshot({ path: `${OUT}/booking-submit-hang-all.png` });
const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');

console.log('\n=== BOOKING SUBMIT under a FULL backend hang (pre-book RPCs + book_public) ===');
console.log('RPCs hung                :', JSON.stringify(hung));
console.log('honest error shown at    :', erroredAt === null ? 'NEVER (within ~66s) ❌' : `~${erroredAt}s ✅`);
console.log('still stuck on CONFIRMING :', stuckSpinner ? 'YES ❌ (frozen submit)' : 'no ✅');
console.log('screen text[0:200]       :', text.slice(0, 200));

const pass = erroredAt !== null && !stuckSpinner;
console.log('\n' + (pass
  ? '✅ PASS: submit fails honestly even when the pre-book RPCs hang (PREBOOK timeout reachable).'
  : '❌ FAIL: submit froze on a pre-book RPC — the honest-error timeout is unreachable.'));
await browser.close();
process.exit(pass ? 0 : 1);

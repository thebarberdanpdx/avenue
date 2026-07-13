// PHASE 3 (offline-first) — booking SUBMIT under a hanging backend.
// Drives the public flow to the "Book" tap with the backend reachable, then makes ONLY the
// book_public RPC HANG (compute-exhausted mode) and confirms the client gets the honest
// "couldn't confirm — tap again" error instead of a "CONFIRMING…" spinner that never ends.
//   BASE_URL=http://127.0.0.1:4173 node tests/live/booking-submit-hang.mjs   (local build w/ fix)
//   node tests/live/booking-submit-hang.mjs                                   (deployed gotvero.com)
import { launch } from './driver.mjs';

const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
// ?shop= + #book resolves vero-test AND the client view on BOTH localhost and gotvero.com.
// (Path form /vero-test misresolves on 127.0.0.1 — the host's "127" is read as a subdomain shop.)
const URL_ = (process.env.BASE_URL || 'https://gotvero.com') + '/?shop=vero-test#book';
const { browser, context, page, errors } = await launch();
const byRole = async (name, wait = 900) => { const el = page.getByRole('button', { name }).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };
const byText = async (re, wait = 700) => { const el = page.getByText(re).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };

// Drive to the details step with the backend fully reachable.
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2500);
if (await page.getByText(/Book here/i).first().count()) await byText(/Book here/i, 1500);
await byText(/It'?s my first time/i);
await byRole(/^Beard Trim$/i, 1400);
for (let g = 0; g < 3; g++) { if (await page.getByRole('button', { name: /^Continue$/i }).first().count()) { await byRole(/^Continue$/i); break; } if (!(await page.getByText(/Choose your cut/i).first().count())) break; await byRole(/^Standard/i); }
await byRole(/^Dan\b/, 1400) || await byRole(/First available/i, 1400);
let picked = await byRole(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
if (!picked) for (const s of [/^Morning/i, /^Afternoon/i, /^Evening/i]) { await byRole(s); if (await byRole(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)) { picked = true; break; } }
await byRole(/^Continue$/i, 1200);
const stamp = String(Date.now()).slice(-6);
await page.getByPlaceholder('First name').fill('OutageDan').catch(() => {});
await page.getByPlaceholder('Last name').fill('Test').catch(() => {});
await page.getByPlaceholder('Email').fill(`outage+${stamp}@vero.test`).catch(() => {});
await page.getByPlaceholder('Phone number').fill('5555550' + stamp.slice(-3)).catch(() => {});
await byText(/Consent to SMS/i, 300);
await byText(/I agree to the cancellation policy/i, 300);

// NOW hang only book_public (the submit), leaving everything else alone.
let hung = 0;
await context.route((url) => /rpc\/book_public/i.test(url), async () => { hung++; /* never fulfill → hang */ });

const bookedAt = Date.now();
await byRole(/^BOOK FOR/i, 1500);

// Poll: the honest error must appear and the spinner must stop, within the 25s timeout + margin.
let erroredAt = null, stuckSpinner = false;
for (let s = 3; s <= 33 && erroredAt === null; s += 3) {
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText || '');
  if (/Couldn'?t confirm your booking|check your connection and tap again|wasn'?t held/i.test(t)) erroredAt = Math.round((Date.now() - bookedAt) / 1000);
  stuckSpinner = /CONFIRMING/i.test(t);
}
await page.screenshot({ path: `${OUT}/booking-submit-hang.png` });
const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');

console.log('\n=== BOOKING SUBMIT under a hanging backend ===');
console.log('book_public calls hung   :', hung);
console.log('honest error shown at    :', erroredAt === null ? 'NEVER (within ~33s) ❌' : `~${erroredAt}s ✅`);
console.log('still stuck on CONFIRMING :', stuckSpinner ? 'YES ❌ (infinite spinner)' : 'no ✅');
console.log('screen text[0:200]       :', text.slice(0, 200));

const pass = erroredAt !== null && !stuckSpinner;
console.log('\n' + (pass
  ? '✅ PASS: booking submit fails honestly on a hang (error shown, spinner released).'
  : '❌ FAIL: booking submit hangs — the book_public timeout is missing/not working.'));
await browser.close();
process.exit(pass ? 0 : 1);

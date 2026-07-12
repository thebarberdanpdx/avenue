// FULL public customer booking, driven through a real browser end-to-end.
// This is THE core client journey — the one thing that must never break before
// real clients. Unlike calendar sync it needs no realtime, so it runs fully from
// the cloud: storefront → "first time" → pick service → barber → day → time →
// details → BOOK, then verifies the row landed in Postgres with the RIGHT instant
// (bookedFor must be the picked wall-clock time IN Pacific — the tz-correctness
// backstop for shopWallToInstant). Cleans up after itself.
//
//   source <scratchpad>/.vero-secret && node tests/live/public-book-e2e.mjs
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const SHOP = 'vero-test';
// Service to book. Default = Beard Trim (a plain no-card, no-choice service) so the core
// booking → persist → tz path is tested cleanly. Pass a name+id to exercise another.
const SVC_NAME = process.env.SVC_NAME || 'Beard Trim';
const SVC_ID = process.env.SVC_ID || 'beard';
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
// Pretty shop URL = the exact entry a real client uses: gotvero.com/<slug> resolves the
// shop AND lands on the booking flow (view="client"). ?shop= is the STAFF/dashboard entry.
const URL_ = `https://gotvero.com/${SHOP}`;

const idsNow = async () => (await sb.from('appointments').select('id').eq('shop_id', SHOP)).data.map((r) => r.id);
const shot = async (page, name) => { try { await page.screenshot({ path: `${OUT}/pb-${name}.png` }); } catch (e) {} };
const fail = async (browser, msg) => { console.log('\n❌ FAIL:', msg); await browser.close(); process.exit(1); };

// Convert a UTC instant to its wall-clock minute-of-day in a tz (for the tz assertion).
function minuteOfDayInTz(iso, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = +p.find((x) => x.type === 'hour').value, m = +p.find((x) => x.type === 'minute').value;
  return (h % 24) * 60 + m;
}

// Fresh slate on the test shop so the "first time" path is clean and the new row is unambiguous.
await sb.from('appointments').delete().eq('shop_id', SHOP);
const before = new Set(await idsNow());

const { browser, page, errors } = await launch();
const clickByRole = async (name, opts = {}) => { const el = page.getByRole('button', { name }).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(opts.wait || 900); return true; } return false; };
const clickText = async (re, wait = 900) => { const el = page.getByText(re).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };

console.log('GET', URL_);
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2500);
await shot(page, '1-landing');

// If we somehow landed on staff sign-in, take the client entry.
if (await page.getByText(/Book here/i).first().count()) { await clickText(/Book here/i, 1500); }

// 1) first-time path
if (!(await clickText(/It'?s my first time/i))) await fail(browser, 'no "It\'s my first time" button (shop may be returning-only) — ' + (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200));
await shot(page, '2-services');

// 2) pick the service (exact match on its name)
if (!(await clickByRole(new RegExp('^' + SVC_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')))) await fail(browser, SVC_NAME + ' service not tappable');
await page.waitForTimeout(1400);
await shot(page, '3-whoscutting');

// 2b) if this service uses the guided "Choose your cut"/add-on flow, answer it: pick first
// choice option, dismiss any confirm sheet, decline optional add-ons, then Continue.
for (let g = 0; g < 4; g++) {
  if (await page.getByText(/Choose your cut/i).first().count()) {
    await clickByRole(/^Standard/i) || await page.getByText(/Standard/i).first().click().catch(() => {});
    await page.waitForTimeout(700);
  }
  if (await page.getByRole('button', { name: /^OK$/i }).first().count()) { await clickByRole(/^OK$/i); }
  if (await page.getByRole('button', { name: /^No thanks$/i }).first().count()) { await clickByRole(/^No thanks$/i); }
  if (await page.getByRole('button', { name: /^Continue$/i }).first().count()) { await clickByRole(/^Continue$/i); break; }
}
await page.waitForTimeout(600);

// 3) barber — pick Dan specifically (deterministic)
if (!(await clickByRole(/^Dan\b/))) { if (!(await clickByRole(/First available/i))) await fail(browser, 'no barber to pick'); }
await page.waitForTimeout(1400);
await shot(page, '4-times');

// 4) time — a day is pre-selected to the first with openings. Expand a section if collapsed, then tap a time.
let picked = await clickByRole(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
if (!picked) { for (const sec of [/^Morning/i, /^Afternoon/i, /^Evening/i]) { await clickByRole(sec); if (await clickByRole(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)) { picked = true; break; } } }
if (!picked) await fail(browser, 'no bookable time cell found for Dan in the horizon');
await shot(page, '5-timepicked');

// 5) continue → details
if (!(await clickByRole(/^Continue$/i))) await fail(browser, 'Continue button not available (no slot locked?)');
await page.waitForTimeout(1000);
await shot(page, '6-details');

// 6) fill details
const stamp = String(Date.now()).slice(-6);
const testPhone = '555' + stamp.padStart(7, '0').slice(-7);
await page.getByPlaceholder('First name').fill('Livetest');
await page.getByPlaceholder('Last name').fill('Booker');
await page.getByPlaceholder('Email').fill(`livetest+${stamp}@vero.test`);
await page.getByPlaceholder('Phone number').fill(testPhone);
await page.waitForTimeout(300);
// consent toggles (both required)
await clickText(/Consent to SMS/i, 400);
await clickText(/I agree to the cancellation policy/i, 400);
await page.waitForTimeout(400);
await shot(page, '7-ready');

// 7) BOOK
if (!(await clickByRole(/^BOOK FOR/i, { wait: 3500 }))) {
  const label = await page.getByRole('button', { name: /BOOK|CHECK BOTH|ADD A CARD|PAY ABOVE/i }).first().innerText().catch(() => '(none)');
  await fail(browser, 'Book button not in a bookable state — reads: "' + label + '"');
}
await page.waitForTimeout(3500);
await shot(page, '8-confirmation');

// 8) verify the row landed
const after = await idsNow();
const fresh = after.filter((id) => !before.has(id));
if (!fresh.length) await fail(browser, 'no new appointment row after Book — ' + (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200));
const { data: row } = await sb.from('appointments').select('data').eq('shop_id', SHOP).eq('id', fresh[0]).single();
const a = row.data;
console.log('\nbooked row:', JSON.stringify({ id: a.id, providerId: a.providerId, serviceId: a.serviceId, start: a.start, bookedFor: a.bookedFor, status: a.status, price: a.price, bookedOnline: a.bookedOnline }));

// 9) tz correctness: the stored instant, read back in Pacific, must equal the picked wall-clock slot.
const tzMin = minuteOfDayInTz(a.bookedFor, 'America/Los_Angeles');
const tzOk = tzMin === a.start;
console.log(`tz check: bookedFor→Pacific = ${Math.floor(tzMin / 60)}:${String(tzMin % 60).padStart(2, '0')} vs slot start ${Math.floor(a.start / 60)}:${String(a.start % 60).padStart(2, '0')} → ${tzOk ? 'MATCH' : 'MISMATCH'}`);

// screenshot text sanity
const confText = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ').slice(0, 220);
console.log('confirmation text:', confText);
console.log('js errors:', errors.length ? errors.slice(0, 4) : 'none');

// cleanup — remove the appt + the client this test created (keep the shop pristine)
await sb.from('appointments').delete().eq('shop_id', SHOP).eq('id', fresh[0]);
if (a.clientId && a.clientId !== 'vt_client1') await sb.from('clients').delete().eq('shop_id', SHOP).eq('id', a.clientId);

await browser.close();
const ok = a.status && a.bookedFor && a.providerId === 'dan' && a.serviceId === SVC_ID && tzOk;
console.log(ok ? '\n✅ PASS: public booking works end-to-end through the real UI, row persisted, instant is tz-correct' : '\n❌ FAIL: booking landed but a field was wrong (see above)');
process.exit(ok ? 0 : 1);

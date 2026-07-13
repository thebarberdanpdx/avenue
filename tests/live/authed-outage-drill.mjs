// PHASE 3 (offline-first) — STAFF calendar outage drill. RUN NEXT SESSION (needs the
// admin key to mint a staff login; unavailable the session this was written).
//
// Reproduces the ORIGINAL July-2026 symptom: staff calendar went BLANK during the outage.
// Signs in as staff, then makes the backend HANG (compute-exhausted mode) and confirms the
// calendar falls back to the last-synced cache + an honest "offline" banner — never a blank
// screen or an endless spinner.
//
// KNOWN GAP this targets (found by code inspection 2026-07-13): mirrorFromServer() awaits
// fetch(/api/sync-pull) with NO timeout (src/App.jsx ~2783). On a hang the fetch never
// resolves, so the hydrateFromCache fallback (~2812) never runs. The fix (next session):
// wrap that fetch in an AbortController timeout so a hang routes into the existing cache
// fallback. This drill is the regression gate for that fix.
//
//   source <scratchpad>/.vero-secret && node tests/live/authed-outage-drill.mjs
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('No service key in env — run next session once the rotated key is loaded.'); process.exit(2); }
const sb = createClient(process.env.SUPABASE_URL || 'https://iufgznminbujcabqeesk.supabase.co', KEY, { auth: { persistSession: false } });
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const SHOP = 'vero-test', EMAIL = 'vero-livetest@vero.test';
const BASE = process.env.BASE_URL || 'https://gotvero.com';

// 1) sign in as staff (headless magic link) and let the real calendar load + cache once.
const { data: link, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: `${BASE}/?shop=${SHOP}` } });
if (error) { console.error('generateLink:', error.message); process.exit(1); }

const { browser, context, page, errors } = await launch();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => { localStorage.setItem('vero_login_intent', 'staff'); localStorage.setItem('vero_testday_v1', '1'); });
await page.goto(link.properties.action_link, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(9000); // let the calendar fully load + write its offline cache before we cut the cord

// 2) now HANG the backend (compute-exhausted): sync-pull + supabase never respond.
let hung = 0;
await context.route((url) => { try { const h = new URL(url).hostname; return h.includes('supabase') || /\/api\/sync-pull/.test(url); } catch (e) { return false; } },
  async () => { hung++; /* never fulfill */ });

// 3) force a fresh mirror (reload) under the hang and watch what the calendar does.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
// Honest banner = any of the app's real outage messages (incl. the load-incomplete "Reload" one).
const honestBannerRe = /didn'?t load|saving is paused|Reload|offline|showing.*local|sync problem|last synced/i;
let settledAt = null, sawCalendar = false;
for (let s = 3; s <= 42; s += 3) {
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText || '');
  if (/PULSE|CALENDAR|CLIENTS/i.test(t)) sawCalendar = true;         // dashboard chrome rendered (not blank/spinner)
  if (settledAt === null && honestBannerRe.test(t)) settledAt = s;
  // stop once the cache has clearly hydrated (the false-empty state is gone) and the banner is up
  if (sawCalendar && settledAt !== null && !/Nothing booked today yet/i.test(t)) break;
}
const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
await page.screenshot({ path: `${OUT}/outage-staff.png` });

// THE fix signal: the last-synced appointments show from cache instead of a false "nothing booked".
// We seeded 2 real appts today, so "Nothing booked today yet" must NOT be the state during the outage.
const falselyEmpty = /Nothing booked today yet/i.test(text);
const cachedApptsShown = !falselyEmpty;

console.log('\n=== STAFF OUTAGE RESULT (backend hanging) ===');
console.log('requests hung             :', hung);
console.log('dashboard rendered (not blank/spinner):', sawCalendar ? 'YES ✅' : 'NO ❌');
console.log('honest banner shown       :', settledAt === null ? 'NO ❌' : `~${settledAt}s ✅`);
console.log('cached appts shown (not falsely empty):', cachedApptsShown ? 'YES ✅' : 'NO ❌ (shows "Nothing booked" despite 2 real appts)');
console.log('screen text[0:220]        :', text.slice(0, 220));

const pass = sawCalendar && settledAt !== null && cachedApptsShown;
console.log('\n' + (pass
  ? '✅ PASS: staff calendar survives a hanging backend (cached appts shown + honest banner, no false-empty).'
  : '❌ FAIL: staff calendar hang gap — cached appts not shown / no honest banner (see header).'));
await browser.close();
process.exit(pass ? 0 : 1);

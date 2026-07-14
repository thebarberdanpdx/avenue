// PHASE 3 (offline-first) — staff calendar RE-DISPLAYS the last-synced schedule from cache during
// a hanging backend (not merely showing the "offline" banner). Closes the item the earlier
// authed-outage-drill couldn't confirm: the test shops never populate the offline cache, so this
// SEEDS it directly with a today-dated appt, then hangs the backend and reloads — exercising the
// exact path mirrorWatchdog → hydrateFromCache → setAppts → render.
//
// Proof-of-hydration signal: the seeded appt has price $40, so the Pulse projection "On track for
// $40 today" can only appear if the cached appt is actually in appts state — a signal immune to
// calendar tile virtualization. Runs against vero-mig.
//   source <scratchpad>/.vero-secret && node tests/live/outage-cache-redisplay.mjs
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('No service key — needs the admin key to mint a staff login.'); process.exit(2); }
const sb = createClient(process.env.SUPABASE_URL || 'https://iufgznminbujcabqeesk.supabase.co', KEY, { auth: { persistSession: false } });
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const SHOP = process.env.SHOP || 'vero-mig', EMAIL = process.env.EMAIL || 'vero-livetest@vero.test', BASE = process.env.BASE_URL || 'https://gotvero.com';
const PROBE = 'CacheProbe Rider';

const { data: link, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: `${BASE}/?shop=${SHOP}` } });
if (error) { console.error('generateLink:', error.message); process.exit(1); }

const { browser, context, page } = await launch({ device: 'iphone' });
const txt = async () => (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => localStorage.setItem('vero_login_intent', 'staff'));
await page.goto(link.properties.action_link, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(8000);
if (/Choose|which shop|location/i.test(await txt())) { const el = page.getByText(/Vero Migration Test/i).first(); if (await el.count()) { await el.click().catch(() => {}); await page.waitForTimeout(2000); } }

// Seed the offline cache with one TODAY appt (browser clock = Pacific via driver tz), price $40.
const seeded = await page.evaluate((probe) => {
  const now = new Date(), at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0);
  const appt = { id: 'cacheprobe_' + Date.now(), providerId: 'dan', clientId: 'cacheprobe_c', serviceId: null, title: 'Cache Probe Visit', name: probe, serviceName: 'Cache Probe Visit', start: 600, end: 640, status: 'confirmed', bookedFor: at.toISOString(), price: 40 };
  const keys = Object.keys(localStorage).filter(k => /^vero_cache_.*_appointments$/.test(k));
  const shopKeys = keys.length ? keys : ['vero_cache_' + (window.__SHOP__ || 'vero-mig') + '_appointments'];
  for (const k of shopKeys) localStorage.setItem(k, JSON.stringify([appt]));
  return shopKeys;
}, PROBE);
console.log('seeded cache keys:', JSON.stringify(seeded));

// HANG the backend: supabase + sync-pull never respond.
let hung = 0;
await context.route((url) => { try { const h = new URL(url).hostname; return h.includes('supabase') || /\/api\/sync-pull/.test(url); } catch (e) { return false; } }, async () => { hung++; });

// Reload under the hang → fresh load starts empty → mirror hangs → watchdog hydrates from cache.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

const bannerRe = /showing last synced|backend unreachable|last synced|changes are paused|offline|didn'?t load|Retry/i;
const hydratedRe = /On track for \$40|\$40 today/i;
let hydratedAt = null, bannerAt = null, sawDash = false;
for (let s = 3; s <= 39; s += 3) {
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText || '');
  if (/PULSE|CALENDAR|CLIENTS|Today/i.test(t)) sawDash = true;
  if (hydratedAt === null && hydratedRe.test(t)) hydratedAt = s;
  if (bannerAt === null && bannerRe.test(t)) bannerAt = s;
  if (hydratedAt !== null && bannerAt !== null) break;
}
let tileShown = false;
try {
  const cal = page.getByText(/^Calendar$/i).first();
  if (await cal.count()) { await cal.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); }
  const ct = await page.evaluate(() => document.body.innerText || '');
  tileShown = new RegExp(PROBE, 'i').test(ct) || /Cache Probe Visit/i.test(ct);
} catch (e) {}
await page.screenshot({ path: `${OUT}/outage-cache-redisplay.png` });
const finalText = await txt();
await browser.close();

console.log('\n=== STAFF OUTAGE — CACHED CALENDAR RE-DISPLAY ===');
console.log('requests hung           :', hung);
console.log('dashboard rendered      :', sawDash ? 'YES ✅' : 'NO ❌');
console.log('cached appt HYDRATED    :', hydratedAt === null ? 'NO ❌' : `~${hydratedAt}s ✅ (pulse projects the seeded $40 appt)`);
console.log('tile visible on Calendar:', tileShown ? 'YES ✅' : 'not seen (virtualized/scroll) — projection is the proof');
console.log('honest banner shown     :', bannerAt === null ? 'NO ❌' : `~${bannerAt}s ✅`);
console.log('screen text[0:220]      :', finalText.slice(0, 220));

const pass = sawDash && bannerAt !== null && hydratedAt !== null;
console.log('\n' + (pass
  ? '✅ PASS: last-synced calendar re-displays from cache during a hang (appt hydrated + honest banner).'
  : '❌ FAIL: cached appt did not hydrate and/or no banner — hydrateFromCache gap.'));
process.exit(pass ? 0 : 1);

// Log into the dashboard headlessly (no phone) for a given staff email + shop,
// then report whether the session took and whether writes succeed (no RLS 403 /
// no "couldn't save" banner). Screenshots the result.
//
//   source <scratchpad>/.vero-secret && node tests/live/authed-smoke.mjs [email] [shop]
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const EMAIL = process.argv[2] || 'vero-livetest@vero.test';
const SHOP = process.argv[3] || 'vero-test';
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const REDIRECT = `https://gotvero.com/?shop=${SHOP}`;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: REDIRECT } });
if (error) { console.error('generateLink:', error.message); process.exit(1); }

const { browser, page, errors, blockedTelemetry } = await launch();
await page.goto('https://gotvero.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => { try {
  localStorage.setItem('vero_login_intent', 'staff');
  localStorage.setItem('vero_testday_v1', '1'); // suppress the near-empty-shop demo-day so tests see only real seeded data
} catch (e) {} });
await page.goto(data.properties.action_link, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(5000); // let phantom-dirty saves attempt so we see any RLS failure

const hasSession = await page.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)));
const saveBanner = await page.evaluate(() => (document.body.innerText || '').includes("Couldn't save"));
const rlsErrors = errors.filter((e) => /row-level security|42501|save .*failed/i.test(e));
const body = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ').slice(0, 220);

console.log('shop            :', SHOP, '| login:', EMAIL);
console.log('session stored  :', hasSession);
console.log('writes OK        :', !saveBanner && rlsErrors.length === 0, saveBanner ? '(SAVE BANNER SHOWN)' : '', rlsErrors.length ? `(${rlsErrors.length} RLS errors)` : '');
console.log('visible text     :', body);
if (rlsErrors.length) console.log('  RLS sample     :', rlsErrors[0].slice(0, 160));
console.log('telemetry blocked:', blockedTelemetry.length);
await page.screenshot({ path: `${OUT}/authed-${SHOP}.png` });
console.log('shot ->', `${OUT}/authed-${SHOP}.png`);
await browser.close();

// Live end-to-end proof of the access-lockdown (only shop members reach the dashboard).
//   AUTHORIZED   : a real member (vero-livetest@vero.test) loads the dashboard — NO "Not authorized".
//   UNAUTHORIZED : a throwaway non-member (vero-intruder@vero.test) is stopped at the AccessDenied screen.
// Both against PRODUCTION (gotvero.com) after the lockdown is deployed. The intruder user is created
// here and deleted at the end, so it never lingers. Run:
//   source <scratchpad>/.vero-secret && node tests/live/access-lockdown.mjs [shop]
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const SHOP = process.argv[2] || 'vero-mig';
const MEMBER = 'vero-livetest@vero.test';
const INTRUDER = 'vero-intruder@vero.test';
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const URL = process.env.SUPABASE_URL || 'https://iufgznminbujcabqeesk.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Ensure the throwaway intruder exists (confirmed, no membership/provider → non-member of any shop).
async function ensureIntruder() {
  try {
    const { data, error } = await sb.auth.admin.createUser({ email: INTRUDER, email_confirm: true });
    if (error && !/already/i.test(error.message)) throw error;
    if (data && data.user) return data.user.id;
  } catch (e) { if (!/already/i.test(String(e.message || e))) throw e; }
  // already existed — find its id
  for (let page = 1; page <= 40; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const u = (data?.users || []).find((x) => String(x.email || '').toLowerCase() === INTRUDER);
    if (u) return u.id;
    if ((data?.users || []).length < 200) break;
  }
  return null;
}

async function loginAndInspect(email, label) {
  const redirect = `https://gotvero.com/?shop=${SHOP}`;
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: redirect } });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const { browser, page, errors } = await launch();
  try {
    await page.goto('https://gotvero.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate(() => { try {
      localStorage.setItem('vero_login_intent', 'staff');
      localStorage.setItem('vero_testday_v1', '1');
    } catch (e) {} });
    await page.goto(data.properties.action_link, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(8000); // let sign-in → mirrorFromServer → sync-pull(403/200) settle
    const hasSession = await page.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)));
    const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
    const denied = /Not authorized/i.test(text) && /isn't on the staff list/i.test(text);
    await page.screenshot({ path: `${OUT}/access-${label}.png` });
    return { hasSession, denied, snippet: text.slice(0, 160) };
  } finally { await browser.close(); }
}

async function main() {
  const intruderId = await ensureIntruder();
  console.log(`shop=${SHOP}  intruder user id=${intruderId || '(unknown)'}\n`);

  const mem = await loginAndInspect(MEMBER, 'member');
  console.log(`AUTHORIZED  ${MEMBER}`);
  console.log(`  session stored : ${mem.hasSession}`);
  console.log(`  AccessDenied   : ${mem.denied}  (expected false)`);
  console.log(`  visible text   : ${mem.snippet}\n`);

  const intr = await loginAndInspect(INTRUDER, 'intruder');
  console.log(`UNAUTHORIZED ${INTRUDER}`);
  console.log(`  session stored : ${intr.hasSession}`);
  console.log(`  AccessDenied   : ${intr.denied}  (expected true)`);
  console.log(`  visible text   : ${intr.snippet}\n`);

  // clean up the throwaway user so it never lingers in auth
  if (intruderId) { try { await sb.auth.admin.deleteUser(intruderId); console.log('cleaned up intruder user'); } catch (e) { console.log('cleanup failed (non-fatal):', e.message); } }

  const pass = mem.hasSession && !mem.denied && intr.denied;
  console.log('\n' + (pass ? '✅ PASS — member reaches dashboard, non-member is blocked.' : '❌ FAIL — see above.'));
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('threw:', e); process.exit(2); });

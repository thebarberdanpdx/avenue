// Root-cause probe: what does /api/sync-pull ACTUALLY return for a non-member on vero-mig?
// Creates a throwaway user WITH a password, signs in to get a real JWT, calls sync-pull, prints
// the raw status + body. Then cleans up. Run:
//   source <scratchpad>/.vero-secret && node tests/live/probe-syncpull.mjs [shop]
import { createClient } from '@supabase/supabase-js';

const SHOP = process.argv[2] || 'vero-mig';
const URL = process.env.SUPABASE_URL || 'https://iufgznminbujcabqeesk.supabase.co';
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i';
const EMAIL = 'vero-probe@vero.test';
const PW = 'Probe!' + 'x9k2m7q'; // fixed, deleted at end

const admin = createClient(URL, SKEY, { auth: { persistSession: false } });

let uid = null;
try {
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true });
  if (error && !/already/i.test(error.message)) throw error;
  uid = data?.user?.id || null;
} catch (e) { if (!/already/i.test(String(e.message || e))) throw e; }
if (!uid) {
  for (let p = 1; p <= 40; p++) { const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 }); const u = (data?.users || []).find((x) => String(x.email||'').toLowerCase() === EMAIL); if (u) { uid = u.id; break; } if ((data?.users||[]).length < 200) break; }
  // ensure a known password so we can sign in
  if (uid) await admin.auth.admin.updateUserById(uid, { password: PW });
}

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PW });
if (sErr) { console.error('signIn failed:', sErr.message); process.exit(2); }
const token = signIn.session.access_token;
console.log(`probe user: ${EMAIL}  id=${uid}`);
console.log(`shop=${SHOP}\n`);

// 1) PULL (default GET-like POST with just shop)
const rPull = await fetch('https://gotvero.com/api/sync-pull', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ shop: SHOP }),
});
const bPull = await rPull.text();
console.log(`PULL  status=${rPull.status}`);
console.log(`      body=${bPull.slice(0, 300)}\n`);

// cleanup
if (uid) { try { await admin.auth.admin.deleteUser(uid); console.log('cleaned up probe user'); } catch (e) { console.log('cleanup failed:', e.message); } }

console.log(`\nEXPECT: status=403 (canAccessShop denies a non-member). Anything else is the bug.`);
process.exit(0);

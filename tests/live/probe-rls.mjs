// Security probe: what can a signed-in NON-MEMBER read directly (anon key + their JWT, RLS-governed)?
// This is the real data-exposure surface behind the client access-lockdown. Creates a throwaway user,
// signs in, and attempts direct table reads for the target shop. Prints row counts + a sample so we know
// exactly what RLS leaks vs blocks. Cleans up. Run:
//   source <scratchpad>/.vero-secret && node tests/live/probe-rls.mjs [shop]
import { createClient } from '@supabase/supabase-js';

const SHOP = process.argv[2] || 'vero-mig';
const URL = process.env.SUPABASE_URL || 'https://iufgznminbujcabqeesk.supabase.co';
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i';
const EMAIL = 'vero-rlsprobe@vero.test';
const PW = 'Rls!' + 'z4v8n1c';

const admin = createClient(URL, SKEY, { auth: { persistSession: false } });
let uid = null;
try { const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true }); if (error && !/already/i.test(error.message)) throw error; uid = data?.user?.id || null; } catch (e) { if (!/already/i.test(String(e.message||e))) throw e; }
if (!uid) { for (let p=1;p<=40;p++){ const {data}=await admin.auth.admin.listUsers({page:p,perPage:200}); const u=(data?.users||[]).find(x=>String(x.email||'').toLowerCase()===EMAIL); if(u){uid=u.id;break;} if((data?.users||[]).length<200)break;} if (uid) await admin.auth.admin.updateUserById(uid,{password:PW}); }

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: si, error: sErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PW });
if (sErr) { console.error('signIn failed:', sErr.message); process.exit(2); }
console.log(`non-member: ${EMAIL}  id=${uid}\nshop=${SHOP}\n`);

const SENSITIVE = ['clients', 'appointments', 'waitlist', 'reviews'];
const PUBLICish = ['providers', 'shops'];

async function probe(table, isShops) {
  const sel = isShops ? anon.from(table).select('id,settings').eq('id', SHOP) : anon.from(table).select('data').eq('shop_id', SHOP);
  const { data, error } = await sel;
  if (error) return { table, blocked: true, note: `RLS/error: ${error.message.slice(0,80)}` };
  const n = (data || []).length;
  let sample = '';
  if (n && !isShops) { const d = data[0].data || {}; sample = d.name || d.title || d.clientId || JSON.stringify(d).slice(0,40); }
  if (n && isShops) { const s = data[0].settings || {}; sample = s.name || ''; }
  return { table, blocked: false, rows: n, sample: String(sample).slice(0, 50) };
}

console.log('SENSITIVE (client PII — MUST be blocked for a non-member):');
for (const t of SENSITIVE) { const r = await probe(t, false); console.log(`  ${r.blocked ? '🔒 blocked' : (r.rows ? `⚠️  READ ${r.rows} rows` : '✅ 0 rows')}  ${t}${r.sample ? '  e.g. '+r.sample : ''}${r.note ? '  ('+r.note+')' : ''}`); }
console.log('\nPUBLIC-ish (also on the public booking page — leak here is not new):');
for (const t of PUBLICish) { const r = await probe(t, t === 'shops'); console.log(`  ${r.blocked ? '🔒 blocked' : (r.rows ? `read ${r.rows} rows` : '0 rows')}  ${t}${r.sample ? '  e.g. '+r.sample : ''}${r.note ? '  ('+r.note+')' : ''}`); }

if (uid) { try { await admin.auth.admin.deleteUser(uid); console.log('\ncleaned up probe user'); } catch (e) { console.log('cleanup failed:', e.message); } }
process.exit(0);

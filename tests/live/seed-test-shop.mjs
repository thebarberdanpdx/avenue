// Stand up (or refresh) an ISOLATED, throwaway test shop for live testing.
//
// Everything is scoped to shop_id='vero-test' and a dedicated test account +
// login, so it can never touch Sanctuary. Payments are forced to Test mode
// (nothing charges). Idempotent: safe to re-run. Reads the service key from
// SUPABASE_SERVICE_KEY (never hard-coded / committed).
//
//   source <scratchpad>/.vero-secret && node tests/live/seed-test-shop.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_KEY not set'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

export const TEST_SHOP = 'vero-test';
export const TEST_EMAIL = 'vero-livetest@vero.test';
const ACCOUNT_NAME = 'Vero Livetest (automated testing)';
const TEMPLATE_SHOP = 'sanctuary';

// 1) test login (find-or-create) --------------------------------------------
const { data: userList } = await sb.auth.admin.listUsers();
let user = userList.users.find((u) => u.email === TEST_EMAIL);
if (!user) {
  const { data, error } = await sb.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true });
  if (error) throw new Error('createUser: ' + error.message);
  user = data.user;
  console.log('created test user', TEST_EMAIL);
} else console.log('test user exists', TEST_EMAIL);
const userId = user.id;

// 2) account (find-or-create) ------------------------------------------------
let { data: accts } = await sb.from('accounts').select('*').eq('owner_user_id', userId).eq('name', ACCOUNT_NAME);
let account = accts && accts[0];
if (!account) {
  const { data, error } = await sb.from('accounts').insert({ id: randomUUID(), name: ACCOUNT_NAME, owner_user_id: userId }).select().single();
  if (error) throw new Error('accounts insert: ' + error.message);
  account = data;
  console.log('created account', account.id);
} else console.log('account exists', account.id);

// 3) membership (find-or-create) --------------------------------------------
const { data: mems } = await sb.from('memberships').select('*').eq('account_id', account.id).eq('user_id', userId);
if (!mems || !mems.length) {
  const { error } = await sb.from('memberships').insert({ id: randomUUID(), account_id: account.id, user_id: userId, role: 'owner' });
  if (error) throw new Error('memberships insert: ' + error.message);
  console.log('created membership owner');
} else console.log('membership exists');

// 4) templates from the real shop -------------------------------------------
const { data: tShop } = await sb.from('shops').select('settings').eq('id', TEMPLATE_SHOP).single();
const { data: tProvs } = await sb.from('providers').select('data').eq('shop_id', TEMPLATE_SHOP);
const { data: tSvcs } = await sb.from('services').select('data').eq('shop_id', TEMPLATE_SHOP);

// 5) shop row (Test mode, relabeled, no real payment linkage) ----------------
const settings = { ...(tShop?.settings || {}), name: 'Vero Test (automated)', payments: { live: false }, __test: true };
delete settings.phone; delete settings.email; // don't carry the real business contact
// Test shop: don't gate bookings on a card (keeps the automated end-to-end flow simple + deterministic).
settings.booking = { ...(settings.booking || {}), requireCard: false };
{
  const { error } = await sb.from('shops').upsert({ id: TEST_SHOP, name: 'Vero Test', slug: TEST_SHOP, settings, account_id: account.id });
  if (error) throw new Error('shops upsert: ' + error.message);
}

// 6) providers / services / clients — delete-then-insert, scoped to TEST_SHOP
for (const t of ['providers', 'services', 'clients', 'appointments', 'waitlist']) {
  const { error } = await sb.from(t).delete().eq('shop_id', TEST_SHOP);
  if (error && !/schema cache/.test(error.message)) throw new Error(`${t} clear: ${error.message}`);
}
const provRows = (tProvs || []).map((r) => {
  const d = { ...r.data }; delete d.email; delete d.phone; delete d.pin; // strip PII / auth
  return { id: d.id, shop_id: TEST_SHOP, data: d };
});
const svcRows = (tSvcs || []).map((r) => ({ id: r.data.id, shop_id: TEST_SHOP, data: r.data }));
const clientRows = [{ id: 'vt_client1', shop_id: TEST_SHOP, data: { id: 'vt_client1', name: 'Test Client A', phone: '5555550101', email: 'testclient@vero.test', visits: 0 } }];
if (provRows.length) { const { error } = await sb.from('providers').insert(provRows); if (error) throw new Error('providers insert: ' + error.message); }
if (svcRows.length) { const { error } = await sb.from('services').insert(svcRows); if (error) throw new Error('services insert: ' + error.message); }
{ const { error } = await sb.from('clients').insert(clientRows); if (error) throw new Error('clients insert: ' + error.message); }

console.log('\n=== SEED COMPLETE ===');
console.log('shop      :', TEST_SHOP, '(payments.live=false, Test mode)');
console.log('login     :', TEST_EMAIL, '(account', account.id + ')');
console.log('providers :', provRows.length, '| services:', svcRows.length, '| clients:', clientRows.length);
console.log('open with : https://gotvero.com/?shop=' + TEST_SHOP);

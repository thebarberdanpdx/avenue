// Verify the SERVER-side booking guards in book_public — the backstop that protects
// real bookings even when the UI is bypassed or two people race for the same slot.
// Calls book_public with the ANON key (exactly as a public booker does) against the
// isolated vero-test shop. Cleans up after. Prints PASS/FAIL per guard.
//   source <scratchpad>/.vero-secret && node tests/live/booking-guards.mjs
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const ANON = 'sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i';
const svc = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const SHOP = 'vero-test';

const appt = (id, min) => ({ id, clientId: 'vt_client1', providerId: 'dan', serviceId: 'cut', title: 'Haircut',
  bookedFor: `2026-07-20T${String(17 + Math.floor(min / 60) - 10).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00.000Z`,
  start: min, end: min + 35, status: 'confirmed', bookedOnline: true, price: 42 });
const book = (p_client, p_appts) => anon.rpc('book_public', { p_shop: SHOP, p_client, p_appts });
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

// clean slate
await svc.from('appointments').delete().eq('shop_id', SHOP);
await svc.from('clients').delete().eq('shop_id', SHOP).eq('id', 'gt_blocked');

// 1) a first booking succeeds
const a1 = appt('gt_a1', 600); // 10:00 PT
{ const { error } = await book(null, [a1]);
  const { data } = await svc.from('appointments').select('id').eq('shop_id', SHOP).eq('id', 'gt_a1');
  check('a valid slot books', !error && data.length === 1, error ? error.message : ''); }

// 2) DOUBLE-BOOK: the same provider+slot must be rejected (slot_taken)
{ const { error } = await book(null, [appt('gt_a2', 600)]); // overlaps gt_a1
  const { data } = await svc.from('appointments').select('id').eq('shop_id', SHOP).eq('id', 'gt_a2');
  check('double-book is rejected (slot_taken)', !!error && data.length === 0, error ? error.message.slice(0, 40) : 'NO ERROR — slot was double-booked!'); }

// 3) a non-overlapping slot for the same provider still books
{ const { error } = await book(null, [appt('gt_a3', 720)]); // 12:00, clear of gt_a1
  const { data } = await svc.from('appointments').select('id').eq('shop_id', SHOP).eq('id', 'gt_a3');
  check('a clear slot still books', !error && data.length === 1, error ? error.message : ''); }

// 4) BLOCKED client cannot book
await svc.from('clients').insert({ id: 'gt_blocked', shop_id: SHOP, data: { id: 'gt_blocked', name: 'Blocked Person', phone: '5555559999', blocked: true } });
{ const { error } = await book({ id: 'gt_blocked', name: 'Blocked Person', phone: '5555559999' }, [{ ...appt('gt_a4', 780), clientId: 'gt_blocked' }]);
  const { data } = await svc.from('appointments').select('id').eq('shop_id', SHOP).eq('id', 'gt_a4');
  check('a blocked client is rejected', !!error && data.length === 0, error ? error.message.slice(0, 40) : 'NO ERROR — blocked client booked!'); }

// 5) INSERT-ONLY: booking with an existing appt id must NOT overwrite it
{ const tampered = { ...appt('gt_a1', 900), price: 1, title: 'HACKED' }; // reuse gt_a1's id, different data
  await book(null, [tampered]);
  const { data } = await svc.from('appointments').select('data').eq('shop_id', SHOP).eq('id', 'gt_a1').single();
  check('existing appt cannot be overwritten (insert-only)', data && data.data.price === 42 && data.data.title === 'Haircut',
    data ? `price=${data.data.price} title=${data.data.title}` : 'row missing'); }

// cleanup
await svc.from('appointments').delete().eq('shop_id', SHOP);
await svc.from('clients').delete().eq('shop_id', SHOP).eq('id', 'gt_blocked');
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${failed ? '❌ ' + failed + ' guard(s) FAILED' : '✅ all ' + results.length + ' server booking guards hold'}`);
process.exit(failed ? 1 : 0);

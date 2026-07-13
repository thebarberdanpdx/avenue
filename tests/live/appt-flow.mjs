// Full staff-side flow on the test shop, headless: open an appointment by
// deep-link (?appt=), CHECK-IN (→ in-service), then CHECKOUT with Cash (Test
// mode — no real charge). Verifies each step against the DB.
//
// Requires the ?appt= deep-link to be deployed (src/App.jsx). Seeds/uses the
// appointment `vt_appt_today` on the `vero-test` shop.
//   source <scratchpad>/.vero-secret && node tests/live/appt-flow.mjs
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const sb = createClient(process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const SHOP = 'vero-test', APPT = 'vt_appt_today', EMAIL = 'vero-livetest@vero.test';
const DL = `https://gotvero.com/?shop=${SHOP}&appt=${APPT}`;

// fresh confirmed appointment at noon today (Pacific)
await sb.from('appointments').upsert({ id: APPT, shop_id: SHOP, data: { id: APPT, clientId: 'vt_client1', providerId: 'dan', serviceId: 'cut', title: 'Haircut', bookedFor: '2026-07-12T17:00:00.000Z', start: 600, end: 635, status: 'confirmed', price: 42 } });
const appt = async () => (await sb.from('appointments').select('data').eq('shop_id', SHOP).eq('id', APPT).single()).data.data;

const { data: link } = await sb.auth.admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: DL } });
const { browser, page } = await launch();
async function tap(re) { const el = page.getByText(re).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(1200); return true; } return false; }
const sheetOpen = async () => (await page.getByRole('button', { name: /CHECK-?IN|CHECK-?OUT/i }).count()) > 0;

await page.goto('https://gotvero.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => { localStorage.setItem('vero_login_intent', 'staff'); localStorage.setItem('vero_testday_v1', '1'); });
await page.goto(link.properties.action_link, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3000);
// the deep-link opens the sheet once appts load; a reload defeats the initial-load race
let open = false;
for (let r = 0; r < 4 && !open; r++) { for (let i = 0; i < 8 && !open; i++) { if (await sheetOpen()) { open = true; break; } await page.waitForTimeout(1000); } if (!open) { await page.goto(DL, { waitUntil: 'networkidle', timeout: 45000 }); await page.waitForTimeout(2500); } }
if (!open) { console.log('FAIL: appointment sheet did not open'); await browser.close(); process.exit(1); }

await page.getByRole('button', { name: /CHECK-?IN/i }).first().click({ timeout: 6000 }).catch(() => {});
await page.waitForTimeout(1200);
for (const re of [/In service/i, /Start service/i, /Checked in/i, /Start the timer/i]) { if (await tap(re)) break; }
let a = await appt(); console.log('CHECK-IN  ->', a.status, '| startedAt:', a.serviceStartedAt ? 'set' : 'MISSING');

await tap(/CHECK-?OUT/i); await tap(/^Pay$/i); await tap(/^Cash$/i);
for (const re of [/Mark .*paid/i, /Collect/i, /Exact/i, /^Charge/i, /Record/i, /Confirm/i, /Complete/i]) { if (await tap(re)) break; }
await page.waitForTimeout(1500);
a = await appt();
console.log('CHECKOUT ->', a.status, '| endedAt:', a.serviceEndedAt ? 'set' : 'MISSING', '| paid:', a.paid ? a.paid.totalLabel : 'MISSING');
const ok = a.status === 'done' && a.paid && a.serviceStartedAt && a.serviceEndedAt;
console.log(ok ? '\nPASS: book-adjacent check-in + checkout verified end-to-end' : '\nFAIL: flow incomplete');
await browser.close();
process.exit(ok ? 0 : 1);

// PHASE 4 (migration) — importer end-to-end regression, against the clean vero-mig shop.
// Drives the real UI: staff login → Settings → Reports → Import data → upload → preview → import,
// then reads the DB to assert the whole feature at once:
//   • dedup           — 5 rows / 4 people collapse to the right clients (phone/email)
//   • home barber     — derived from imported history (Nora: 2 Heather / 1 Dan → Heather, not Default=Dan)
//   • notes / formula — carried onto the card
//   • retention       — visits derived from past appts
//   • skip surfacing  — a row with an unreadable date is COUNTED + warned, never silently dropped
// Cleans up its imp_ rows afterward.
//
// Requires: the admin key (mint a staff login) + the vero-mig shop (providers Dan + Heather).
//   source <scratchpad>/.vero-secret && node tests/live/importer-e2e.mjs
import { createClient } from '@supabase/supabase-js';
import { launch } from './driver.mjs';

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('No service key in env — needs the admin key to mint a staff login.'); process.exit(2); }
const sb = createClient(process.env.SUPABASE_URL || 'https://iufgznminbujcabqeesk.supabase.co', KEY, { auth: { persistSession: false } });
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const SHOP = 'vero-mig', EMAIL = 'vero-livetest@vero.test', BASE = process.env.BASE_URL || 'https://gotvero.com';

// One CSV that exercises every importer behavior. Note the quoted-comma service and the bad date.
const CSV = [
  'Client Name,Phone,Email,Appointment Date,Start Time,Service,Staff,Notes',
  'Nora Vance,5551110001,nora@ex.com,01/05/2026,10:00 AM,Haircut,Heather,Prefers scissors; base 6N + 20vol',
  'Nora Vance,5551110001,nora@ex.com,03/06/2026,10:00 AM,"Beard Trim, Hot Towel",Heather,',
  'Nora Vance,5551110001,nora@ex.com,05/07/2026,10:00 AM,Haircut,Dan,',
  'Owen Pratt,5551110002,owen@ex.com,02/10/2026,2:00 PM,Beard Trim,Dan,Allergic to sandalwood oil',
  'Bad Row Bob,5551110003,bob@ex.com,not-a-date,2:00 PM,Beard Trim,Dan,',
  '',
].join('\n');

await sb.from('appointments').delete().eq('shop_id', SHOP).like('id', 'imp_%');
await sb.from('clients').delete().eq('shop_id', SHOP).like('id', 'imp_%');

const { data: link, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: `${BASE}/?shop=${SHOP}` } });
if (error) { console.error('generateLink:', error.message); process.exit(1); }

const { browser, page } = await launch({ device: 'iphone' });
const txt = async () => (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
const tapText = async (re, wait = 900) => { const el = page.getByText(re).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };
const tapRole = async (re, wait = 900) => { const el = page.getByRole('button', { name: re }).first(); if (await el.count()) { await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(wait); return true; } return false; };

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => localStorage.setItem('vero_login_intent', 'staff'));
await page.goto(link.properties.action_link, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(7000);
if (/Choose|which shop|location/i.test(await txt())) await tapText(/Vero Migration Test/i, 1500);
await tapText(/^Settings$/i, 1200) || await tapRole(/Settings/i, 1200);
const search = page.getByPlaceholder(/Search/i).first();
if (await search.count()) { await search.fill('reports').catch(() => {}); await page.waitForTimeout(900); }
await tapText(/Reports/i, 1400);
await tapText(/Filter, view & export/i, 1600) || await tapText(/^Reports$/i, 1600);
for (let i = 0; i < 6; i++) { if (await page.getByText(/Import data/i).first().count()) break; await page.mouse.wheel(0, 1400); await page.waitForTimeout(500); }
await tapText(/Import data/i, 1600);

// Upload the CSV from an in-memory buffer (self-contained — no fixture file needed).
await page.locator('input[type="file"]').first().setInputFiles({ name: 'importer-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) }, { timeout: 30000 });
await page.waitForTimeout(2000);
const mapText = await txt();
const notesRowShown = /Notes/i.test(mapText);

await tapRole(/Preview import/i, 2000) || await tapText(/Preview import/i, 2000);
await page.screenshot({ path: `${OUT}/importer-e2e-preview.png` });
const previewText = await txt();
const previewWarnsSkip = /couldn'?t be read/i.test(previewText);

await tapRole(/^Import \d+ clients/i, 3000) || await tapText(/^Import \d+ clients/i, 3000);
await page.waitForTimeout(4000);
const doneText = await txt();
const doneWarnsSkip = /weren'?t imported|couldn'?t be read|date wasn'?t recognized/i.test(doneText);
await page.screenshot({ path: `${OUT}/importer-e2e-done.png` });
await browser.close();

// ---- DB assertions ----
const { data: cl } = await sb.from('clients').select('id,data').eq('shop_id', SHOP).like('id', 'imp_%');
const { data: ap } = await sb.from('appointments').select('id,data').eq('shop_id', SHOP).like('id', 'imp_%');
const byName = (n) => (cl || []).map(r => r.data).find(c => (c.name || '').toLowerCase() === n.toLowerCase());
const nora = byName('Nora Vance'), owen = byName('Owen Pratt'), bob = byName('Bad Row Bob');

console.log('\n=== IMPORTER E2E — DB AFTER IMPORT ===');
console.log('clients:', (cl || []).length, '| names:', (cl || []).map(r => r.data.name).join(', '));
console.log('appts  :', (ap || []).length, '(expect 4 — 3 Nora + 1 Owen; Bob\'s bad-date row skipped)');
const R = [];
const check = (label, cond, got) => { R.push(cond); console.log(`${cond ? '✅' : '❌'} ${label}${got !== undefined ? ' → ' + got : ''}`); };
check('3 clients imported (Nora, Owen, Bob — client survives a bad appt row)', (cl || []).length === 3, (cl || []).length);
check('4 appts imported (only readable dates)', (ap || []).length === 4, (ap || []).length);
check('dedup: Nora is ONE card for 3 rows', !!nora && (cl || []).filter(r => r.data.name === 'Nora Vance').length === 1);
check('home barber from history: Nora = heather (2 Heather > 1 Dan, overrode Default=dan)', nora && nora.provider === 'heather', nora && nora.provider);
check('home barber: Owen = dan', owen && owen.provider === 'dan', owen && owen.provider);
check('notes carried: Nora', nora && /scissors/i.test(nora.notes || ''));
check('notes carried: Owen', owen && /sandalwood/i.test(owen.notes || ''));
check('retention: Nora visits = 3', nora && nora.visits === 3, nora && nora.visits);
check('quoted-comma service preserved on a Nora appt', (ap || []).some(r => /Beard Trim, Hot Towel/i.test(r.data.title || '')));
check('skip surfaced in PREVIEW (Bob\'s bad date)', previewWarnsSkip);
check('skip surfaced on DONE screen', doneWarnsSkip);
check('Notes row present in the column mapper', notesRowShown);

await sb.from('appointments').delete().eq('shop_id', SHOP).like('id', 'imp_%');
await sb.from('clients').delete().eq('shop_id', SHOP).like('id', 'imp_%');
console.log('\n[cleaned imp_ rows from vero-mig]');

const pass = R.every(Boolean);
console.log('\n' + (pass ? '✅ PASS: importer end-to-end — dedup, home-barber, notes, retention, quoted-comma, skip-surfacing.' : '❌ FAIL: see checks above.'));
process.exit(pass ? 0 : 1);

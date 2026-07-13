// PHASE 3 (offline-first) — outage resilience drill, PUBLIC side.
// Reproduces the real July 2026 failure: Supabase down, internet up. We BLOCK all
// Supabase traffic in the browser and confirm the public booking page fails HONESTLY —
// the "can't load — call us" state — NEVER the DEFAULT_SERVICES demo menu (a client
// must never book off a fake menu) and never a blank white screen.
//
// Cloud-verifiable, no login/service key needed. This establishes the real baseline of
// what already survives an outage before we build more.
//   node tests/live/outage-drill.mjs
import { launch } from './driver.mjs';

const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
// Default targets the deployed site; override with BASE_URL to test a LOCAL build (the fix
// isn't on gotvero.com until deployed). e.g. BASE_URL=http://localhost:4173
const URL_ = (process.env.BASE_URL || 'https://gotvero.com') + '/vero-test';
const SUPABASE_HOST = 'iufgznminbujcabqeesk.supabase.co';

const MODE = process.env.OUTAGE_MODE || 'abort'; // 'abort' = fast fail; 'hang' = never responds (compute-exhausted)
const { browser, context, page, errors } = await launch();

// Capture ALL console output — the app logs '[vero] load … failed' when a load ERRORS.
// If those never appear during the outage, the load is HANGING (never reaches its finally),
// which is the root-cause signal for dataLoaded never flipping.
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/\[vero\]|load|dataLoaded/i.test(t)) logs.push(`${m.type()}: ${t}`.slice(0, 160)); });

// Simulate the backend outage. Two modes:
//   abort — request fails immediately (clean network error)
//   hang  — request never responds (mimics a compute-exhausted Supabase: the July outage)
let blocked = 0;
await context.route((url) => { try { return new URL(url).hostname.includes('supabase'); } catch (e) { return false; } },
  async (route) => { blocked++; if (MODE === 'hang') { /* never fulfill → the request hangs */ } else { route.abort(); } });

console.log('GET', URL_, '— Supabase', MODE === 'hang' ? 'HANGING (compute-exhausted sim)' : 'ABORTED (fast-fail sim)');
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

// Poll the honest-state up to 25s so we see WHETHER and WHEN it fires.
const honestRe = /can'?t load|having a moment|on us, not you|reach us|call us/i;
let firedAt = null;
for (let s = 3; s <= 25 && firedAt === null; s += 3) {
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText || '');
  if (honestRe.test(t)) firedAt = s;
}
const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
await page.screenshot({ path: `${OUT}/outage-public.png` });
console.log('honest state fired at     :', firedAt === null ? 'NEVER (within 25s)' : `~${firedAt}s`);
console.log('load console logs         :', logs.length ? logs.slice(0, 8) : 'NONE (loads never errored → hanging)');

// The honest guard (src/App.jsx ~5916) returns BEFORE any bookable screen. So the clean
// signal is: honest "can't load" state shown, vs. a bookable entry (welcome / "first time"
// / service list) rendered — the latter means a client could book off an untrusted menu.
const honest = /can'?t load|having a moment|try again|call us|reach us|on us, not you/i.test(text);
const bookable = /It'?s my first time|I'?ve been here before|Glad you'?re here|pick a time/i.test(text);
const blank = text.trim().length < 20;

console.log('\n=== OUTAGE RESULT (public booking) ===');
console.log('supabase requests blocked :', blocked);
console.log('screen text[0:200]        :', text.slice(0, 200));
console.log('honest "can\'t load" state :', honest ? 'YES ✅' : 'NO');
console.log('bookable menu rendered    :', bookable ? 'YES ❌ (client could book off an untrusted menu)' : 'no ✅');
console.log('blank white screen        :', blank ? 'YES ❌' : 'no ✅');
console.log('js errors                 :', errors.length ? errors.slice(0, 4) : 'none');

const pass = honest && !bookable && !blank;
console.log('\n' + (pass
  ? '✅ PASS: public booking fails honestly under a backend outage (no demo menu, no blank).'
  : '❌ FAIL: outage handling gap — see above.'));
await browser.close();
process.exit(pass ? 0 : 1);

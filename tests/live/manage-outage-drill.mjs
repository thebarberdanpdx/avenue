// PHASE 3 — the "manage your appointment" link under a hanging backend.
// Opens /manage?t=…&shop=vero-test with the backend HANGING (compute-exhausted mode) and
// confirms the screen reaches the honest "link not found — give us a call" state via the
// timeout, instead of sitting on "Loading your appointment…" forever.
//
// A fake token is fine: with the backend hanging, manage_lookup_by_token never returns, so
// the ONLY way to leave "loading" is the withRpcTimeout fallback — exactly what we're testing.
//   BASE_URL=http://127.0.0.1:4173 node tests/live/manage-outage-drill.mjs   (local build)
//   node tests/live/manage-outage-drill.mjs                                   (deployed)
import { launch } from './driver.mjs';

const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const URL_ = (process.env.BASE_URL || 'https://gotvero.com') + '/manage?t=outage-drill-faketoken&shop=vero-test';
const { browser, context, page, errors } = await launch();

// Hang every Supabase request (the manage_lookup RPC never returns).
let hung = 0;
await context.route((url) => { try { return new URL(url).hostname.includes('supabase'); } catch (e) { return false; } },
  async () => { hung++; /* never fulfill → hang */ });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

const honestRe = /link is no longer valid|Link not found|give us a call|couldn'?t|expired/i;
let honestAt = null, stuckLoading = false;
for (let s = 3; s <= 30 && honestAt === null; s += 3) {
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => document.body.innerText || '');
  if (honestRe.test(t)) honestAt = s;
  stuckLoading = /Loading your appointment/i.test(t);
}
await page.screenshot({ path: `${OUT}/manage-outage.png` });
const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');

console.log('\n=== MANAGE LINK under a hanging backend ===');
console.log('supabase requests hung   :', hung);
console.log('honest error shown at    :', honestAt === null ? 'NEVER (within 30s) ❌' : `~${honestAt}s ✅`);
console.log('still stuck on "Loading…" :', stuckLoading ? 'YES ❌ (infinite spinner)' : 'no ✅');
console.log('screen text[0:200]       :', text.slice(0, 200));

const pass = honestAt !== null && !stuckLoading;
console.log('\n' + (pass
  ? '✅ PASS: the manage link fails honestly on a hang (error shown, not stuck loading).'
  : '❌ FAIL: manage link hangs — the withRpcTimeout wrapper is missing/not working.'));
await browser.close();
process.exit(pass ? 0 : 1);

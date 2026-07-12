// Drives the PUBLIC booking flow (no login) and screenshots each step.
// Safe: reads the storefront; does not submit a booking.
//   node tests/live/public-smoke.mjs [baseUrl] [shopSlug]
import { launch } from './driver.mjs';

const BASE = process.argv[2] || 'https://gotvero.com';
const SHOP = process.argv[3] || '';
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-avenue/ddfa0049-b5f9-51e2-b568-16ceb8cfaebf/scratchpad/shots';
const url = SHOP ? `${BASE}/?shop=${SHOP}` : `${BASE}/`;

const { browser, page, errors } = await launch();
console.log('GET', url);
const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
console.log('HTTP', resp && resp.status());
await page.waitForTimeout(2500);
console.log('title:', await page.title());
const body = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ').slice(0, 500);
console.log('visible text[0:500]:', body);
await page.screenshot({ path: `${OUT}/public-landing.png` });
console.log('shot ->', `${OUT}/public-landing.png`);
console.log('js errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();

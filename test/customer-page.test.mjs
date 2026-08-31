import { chromium } from 'playwright';
let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
    window.__tools = [];
    document.modelContext = { registerTool(t) { window.__tools.push(t); return Promise.resolve(); } };
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:8787/demo/copperleaf/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__tools.length >= 2, { timeout: 8000 });

check('page looks like a real site', (await page.title()).includes('Copperleaf'));
check('tools register on a plain customer page', (await page.evaluate(() => window.__tools.length)) === 2);
check('team name flows into tool descriptions',
    (await page.evaluate(() => window.__tools[0].description)).includes('Copperleaf'),
    (await page.evaluate(() => window.__tools[0].description)).slice(0, 80));
check('no demo instrumentation leaked into the page',
    (await page.locator('#tools, #log, #status').count()) === 0);

// The answer text carries whatever team name the API returns (the mock's
// DEMO_TEAM); data-team only labels the tool descriptions on the client.
const avail = await page.evaluate(async () => await window.__tools.find((t) => t.name.includes('availability')).execute({}));
const availText = avail?.content?.[0]?.text || '';
check('availability answers on the customer page', /can take a call right now/.test(availText), availText.slice(0, 90));
check('no page errors', errors.length === 0, errors.join(' / '));

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

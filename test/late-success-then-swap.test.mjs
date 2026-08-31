/*
 * A registerTool promise can stay pending past the retry window and only then
 * resolve. The tool is registered at that point, so a context replaced after
 * it still has to be followed — the watch cannot be hung off the retry timer,
 * which has already given up by then.
 */
import { chromium } from 'playwright';

let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();

// Resolves at 12s: past the 20 × 500ms retry window.
await page.addInitScript(() => {
    window.__slow = [];
    window.__after = [];
    document.modelContext = {
        registerTool(tool) {
            window.__slow.push(tool.name);

            return new Promise((resolve) => setTimeout(resolve, 12000));
        },
    };
});

await page.goto('http://localhost:8787/demo/copperleaf/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__slow.length >= 2, { timeout: 8000 });
check('both tools attempted on the slow context', (await page.evaluate(() => window.__slow.length)) === 2);

// Let the retry window lapse, then the registrations resolve.
await page.waitForFunction(() => window.callingly.isRegistered(), { timeout: 20000 });
check('registered once the slow promises resolve', true);

await page.evaluate(() => {
    document.modelContext = {
        registerTool(tool) {
            window.__after.push(tool.name);

            return Promise.resolve();
        },
    };
});

await page.waitForFunction(() => window.__after.length >= 2, { timeout: 8000 }).catch(() => {});
check('follows a context replaced after a late registration',
    (await page.evaluate(() => window.__after.length)) === 2,
    (await page.evaluate(() => window.__after)).join(', ') || 'none');
check('reports registered on the live context', (await page.evaluate(() => window.callingly.isRegistered())) === true);

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

/*
 * A context can be replaced after registration has already succeeded, with no
 * event to announce it. The tools have to follow the live context — and stop
 * following it once the page unregisters.
 */
import { chromium } from 'playwright';

let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();

// The first context registers cleanly and immediately, so the retry loop
// finishes and stops — this is the window the tools used to be stranded in.
await page.addInitScript(() => {
    window.__a = [];
    window.__b = [];
    window.__c = [];
    document.modelContext = {
        registerTool(tool) {
            window.__a.push(tool.name);

            return Promise.resolve();
        },
    };
});

await page.goto('http://localhost:8787/demo/copperleaf/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.callingly && window.callingly.isRegistered(), { timeout: 8000 });
check('registers and settles on the first context', (await page.evaluate(() => window.__a.length)) === 2);

await page.evaluate(() => {
    document.modelContext = {
        registerTool(tool) {
            window.__b.push(tool.name);

            return Promise.resolve();
        },
    };
});

await page.waitForFunction(() => window.__b.length >= 2, { timeout: 8000 }).catch(() => {});
check('follows a context swapped in after registration', (await page.evaluate(() => window.__b.length)) === 2,
    (await page.evaluate(() => window.__b)).join(', ') || 'none');
check('still reports registered', (await page.evaluate(() => window.callingly.isRegistered())) === true);

// Unregistering has to stop the watch, or it would keep re-registering
// against a signal the page already aborted.
await page.evaluate(() => window.callingly.unregister());
await page.evaluate(() => {
    document.modelContext = {
        registerTool(tool) {
            window.__c.push(tool.name);

            return Promise.resolve();
        },
    };
});
await page.waitForTimeout(4500);
check('unregister stops the watch', (await page.evaluate(() => window.__c.length)) === 0,
    (await page.evaluate(() => window.__c)).join(', ') || 'none');

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

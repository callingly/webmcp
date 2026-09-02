// A browser may expose a model context whose registerTool cannot be replaced.
// The console used to depend on its own wrapper to know what had registered,
// so on such a browser it reported "registration failed" while both tools were
// in fact live. It must read the snippet's own state instead.
import { chromium } from 'playwright';

let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();

await page.addInitScript(() => {
    const accepted = [];
    const context = {};

    Object.defineProperty(context, 'registerTool', {
        value: function (tool) { accepted.push(tool.name); return Promise.resolve(); },
        writable: false,
        configurable: false,
        enumerable: true
    });

    Object.defineProperty(document, 'modelContext', { value: context, configurable: false });
    window.__accepted = accepted;
});

await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });

const accepted = await page.evaluate(() => window.__accepted);
check('the snippet registers both tools through the unwrappable context', accepted.length === 2, accepted.join(', '));

const wrapped = await page.evaluate(() => document.modelContext.registerTool.toString().indexOf('accepted.push') !== -1);
check('the console really could not wrap registerTool', wrapped);

await page.waitForFunction(
    () => document.getElementById('status').textContent.indexOf('tools live') !== -1,
    null,
    { timeout: 8000 }
).catch(() => {});

const status = (await page.textContent('#status')).trim();
check('the console reports the tools as live, not as a failure', status === '2 tools live', status);

const listed = await page.$$eval('#tools code', (els) => els.map((e) => e.textContent));
check('both tools are named in the console', listed.length === 2 && listed.every((n) => n.startsWith('callingly-')), listed.join(', '));

await browser.close();
process.exit(failures ? 1 : 0);

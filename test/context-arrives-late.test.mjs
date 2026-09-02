/*
 * The two orderings that used to leave nothing watching: a context that never
 * settles its first registration, and no context at all — in both cases with
 * the real one arriving well after the snippet's fast startup window. Nothing
 * announces either, so the poll has to still be running.
 */
import { chromium } from 'playwright';

let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

// Comfortably past the 10s fast window, so the old finite retry budget would
// have been spent and stopped by the time the context shows up.
const AFTER_THE_WINDOW = 12000;

const browser = await chromium.launch();

const arrive = () => {
    window.__late = [];
    document.modelContext = {
        registerTool(tool) {
            window.__late.push(tool.name);

            return Promise.resolve();
        },
    };
};

async function open(setup) {
    const page = await browser.newPage();
    if (setup) { await page.addInitScript(setup); }
    await page.goto('http://localhost:8787/demo/joes-plumbing/after/', { waitUntil: 'networkidle' });

    return page;
}

// One page stalls its first registration forever; the other has no WebMCP at
// all. Run them together so the wait is paid once.
const stalled = await open(() => {
    window.__first = [];
    navigator.modelContext = {
        registerTool(tool) {
            window.__first.push(tool.name);

            return new Promise(() => {});
        },
    };
});
const bare = await open(null);

await stalled.waitForFunction(() => window.__first.length >= 2, { timeout: 8000 });
check('a pending registration does not count as registered',
    (await stalled.evaluate(() => window.callingly.isRegistered())) === false);
check('no context at all is not registered either',
    (await bare.evaluate(() => window.callingly.isRegistered())) === false);

await new Promise((resolve) => setTimeout(resolve, AFTER_THE_WINDOW));

await Promise.all([stalled, bare].map((page) => page.evaluate(arrive)));
await Promise.all([stalled, bare].map((page) => page
    .waitForFunction(() => window.callingly.isRegistered(), { timeout: 8000 })
    .catch(() => {})));

for (const [name, page] of [['over a stalled registration', stalled], ['on a page that had none', bare]]) {
    check('registers on a context that arrives late ' + name,
        (await page.evaluate(() => window.__late)).join(', ') === 'callingly-check-sales-availability, callingly-request-sales-call',
        (await page.evaluate(() => window.__late)).join(', ') || 'none');
    check('reports registered afterwards ' + name,
        (await page.evaluate(() => window.callingly.isRegistered())) === true);
}

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

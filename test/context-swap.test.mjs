/*
 * A model context can be replaced after the snippet has already started
 * registering against an earlier one — a native implementation landing over an
 * extension's, or document.modelContext appearing after we settled for
 * navigator's. The tools have to end up on whichever context is live.
 */
import { chromium } from 'playwright';

let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();

// Context A never settles its registerTool promise, so the snippet is left
// with a pending registration when the replacement arrives.
await page.addInitScript(() => {
    window.__a = [];
    window.__b = [];
    navigator.modelContext = {
        registerTool(tool) {
            window.__a.push(tool.name);

            return new Promise((resolve) => { window.__resolveA = resolve; });
        },
    };
});

await page.goto('http://localhost:8787/demo/joes-plumbing/after/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__a.length >= 2, { timeout: 8000 });
check('registers against the first context', (await page.evaluate(() => window.__a.length)) === 2);
check('not reported registered while pending', (await page.evaluate(() => window.callingly.isRegistered())) === false);

// A different object takes over, at the location the snippet prefers.
await page.evaluate(() => {
    document.modelContext = {
        registerTool(tool) {
            window.__b.push(tool.name);

            return Promise.resolve();
        },
    };
});

await page.waitForFunction(() => window.__b.length >= 2, { timeout: 8000 })
    .catch(() => {});

const onB = await page.evaluate(() => window.__b);
check('re-registers against the replacement context', onB.length === 2, onB.join(', ') || 'none');
check('reports registered once the live context has them',
    (await page.evaluate(() => window.callingly.isRegistered())) === true);

// The superseded registration settling late must not rewrite state.
await page.evaluate(() => window.__resolveA && window.__resolveA());
await page.waitForTimeout(200);
check('a late resolve from the old context changes nothing',
    (await page.evaluate(() => window.callingly.isRegistered())) === true);
check('no duplicate registrations on the live context',
    (await page.evaluate(() => new Set(window.__b).size)) === 2, (await page.evaluate(() => window.__b)).join(', '));

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

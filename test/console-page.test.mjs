import { chromium } from 'playwright';

const URL = 'http://localhost:8787/';
let failures = 0;

function check(name, ok, extra = '') {
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? ' — ' + extra : ''));
    if (!ok) { failures++; }
}

const browser = await chromium.launch();
const page = await browser.newPage();

// Stub WebMCP the way a compatible browser exposes it.
await page.addInitScript(() => {
    window.__tools = [];
    document.modelContext = {
        registerTool(tool) {
            window.__tools.push(tool);
            return Promise.resolve();
        },
    };
});

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__tools && window.__tools.length >= 2, { timeout: 8000 });

const names = await page.evaluate(() => window.__tools.map((t) => t.name));
check('two tools registered', names.length === 2, names.join(', '));
check('availability tool present', names.some((n) => n.includes('check-sales-availability')));
check('call tool present', names.some((n) => n.includes('request-sales-call')));

const readOnly = await page.evaluate(() => window.__tools.find((t) => t.name.includes('availability')).annotations?.readOnlyHint);
check('availability marked read-only', readOnly === true, String(readOnly));

// Console panel reflects the registration.
check('console lists tools', (await page.locator('#tools li code').count()) === 2);
check('status pill goes live', (await page.locator('#status').textContent()).includes('2 tools live'));

// An agent calling the availability tool gets live data and it is logged.
const avail = await page.evaluate(async () => {
    const tool = window.__tools.find((t) => t.name.includes('availability'));
    return await tool.execute({});
});
check('availability returns team', avail && (avail.team === 'Sales' || JSON.stringify(avail).includes('Sales')), JSON.stringify(avail).slice(0, 120));
check('availability call logged', (await page.locator('#log li').count()) >= 2);

// Placing a call goes straight out and the tool answers with the number it
// dialled, which is also what proves the arguments reached it.
const placed = await page.evaluate(async () => {
    const tool = window.__tools.find((t) => t.name.includes('request-sales-call'));

    return await tool.execute({ phone: '+14155550134', fname: 'Ada' });
});
const placedText = placed?.content?.[0]?.text || '';
check('the call is placed', placed?.isError !== true, JSON.stringify(placed).slice(0, 140));
check('the answer names the number', /\+1 415 555 0134/.test(placedText), placedText.slice(0, 120));
check('a phone number is still required', await page.evaluate(async () => {
    const tool = window.__tools.find((t) => t.name.includes('request-sales-call'));

    return (await tool.execute({})).isError === true;
}));
check('the call was logged', (await page.locator('#log li').count()) >= 3);

check('no page errors', errors.length === 0, errors.join(' / '));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

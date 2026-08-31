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

// The call tool must refuse when consent is missing rather than dialing. MCP
// convention is an isError result, not a thrown exception.
const refused = await page.evaluate(async () => {
    const tool = window.__tools.find((t) => t.name.includes('request-sales-call'));

    return await tool.execute({ phone: '+14155550134' });
});
const refusedText = refused?.content?.[0]?.text || '';
check('call refused without consent', refused?.isError === true, JSON.stringify(refused).slice(0, 120));
check('refusal tells the agent to ask first', /consent=true/.test(refusedText), refusedText.slice(0, 90));
check('consent is a required tool input', await page.evaluate(() =>
    (window.__tools.find((t) => t.name.includes('request-sales-call')).inputSchema.required || []).includes('consent')));
check('no card created for a refused call', await page.locator('[data-callingly-confirm]').count() === 0);

// With consent, the confirmation card appears and declining aborts the call.
await page.evaluate(() => {
    const tool = window.__tools.find((t) => t.name.includes('request-sales-call'));
    window.__callResult = tool.execute({ phone: '+14155550134', fname: 'Ada', consent: true })
        .then((r) => ({ ok: r }), (e) => ({ declined: !!e.declined, message: e.message }));
});
// The card lives in a shadow root on a zero-box host, so wait on its content
// rather than the host's own visibility.
await page.waitForFunction(
    () => document.querySelector('[data-callingly-confirm]')?.shadowRoot?.querySelectorAll('button').length >= 2,
    { timeout: 5000 },
);
check('confirmation card shown', await page.locator('[data-callingly-confirm]').count() === 1);

const declineLabel = await page.evaluate(() => {
    const root = document.querySelector('[data-callingly-confirm]').shadowRoot;
    return Array.from(root.querySelectorAll('button')).map((b) => b.textContent.trim());
});
check('card offers a choice', declineLabel.length >= 2, declineLabel.join(' | '));

await page.evaluate(() => {
    const root = document.querySelector('[data-callingly-confirm]').shadowRoot;
    const buttons = Array.from(root.querySelectorAll('button'));
    (buttons.find((b) => /no|cancel|not now|decline/i.test(b.textContent)) || buttons[0]).click();
});
const declined = await page.evaluate(() => window.__callResult);
const declinedText = declined?.ok?.content?.[0]?.text || '';
check('declining aborts the call', declined?.ok?.isError === true, JSON.stringify(declined).slice(0, 140));
check('refusal says nothing was sent', /nothing was sent/i.test(declinedText), declinedText.slice(0, 90));

check('no page errors', errors.length === 0, errors.join(' / '));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

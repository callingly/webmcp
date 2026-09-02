// The page's own data-team label has to be what the tools say back. The
// availability sentence used the server's internal team name instead, so the
// plumber demo answered "The Sales team can take a call right now" while the
// confirmation card on the same page said "our Joe's Plumbing team".
import { chromium } from 'playwright';

let failures = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? ' — ' + extra : '')); if (!ok) failures++; };

const browser = await chromium.launch();

const read = async (url) => {
    const page = await browser.newPage();

    await page.addInitScript(() => {
        window.__tools = {};
        document.modelContext = { registerTool(tool) { window.__tools[tool.name] = tool; return Promise.resolve(); } };
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Object.keys(window.__tools).length === 2, null, { timeout: 15000 });

    const out = await page.evaluate(async () => {
        const result = await window.__tools['callingly-check-sales-availability'].execute({}, {});

        return { text: result.content[0].text, served: JSON.parse(result.content[1].text).team };
    });

    await page.close();

    return out;
};

// data-team="Joe's Plumbing", while the mock API calls the team "Sales".
const labelled = await read('http://localhost:8787/demo/joes-plumbing/after/');
check('the server really calls the team something else', labelled.served === 'Sales', labelled.served);
check('the page label is what the tool says back', labelled.text.startsWith("The Joe's Plumbing team"), labelled.text.split('\n')[0]);
check('the server name does not leak into the sentence', !labelled.text.includes('The Sales team'), labelled.text.split('\n')[0]);

// The console page sets no data-team, so the server's name beats "sales".
const unlabelled = await read('http://localhost:8787/');
check('with no data-team the server name is used', unlabelled.text.startsWith('The Sales team'), unlabelled.text.split('\n')[0]);
check('the generic fallback is not used when the server named the team', !unlabelled.text.includes('The sales team'), unlabelled.text.split('\n')[0]);

// A successful call request answers with the server's own sentence, which
// names the team by its internal name. Availability using the page label while
// this one did not made the agent call the same team two unrelated things in
// consecutive turns.
const page = await browser.newPage();

await page.addInitScript(() => {
    window.__tools = {};
    document.modelContext = { registerTool(tool) { window.__tools[tool.name] = tool; return Promise.resolve(); } };
});

await page.goto('http://localhost:8787/demo/joes-plumbing/after/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Object.keys(window.__tools).length === 2, null, { timeout: 15000 });

const placed = await page.evaluate(async () => {
    const pending = window.__tools['callingly-request-sales-call']
        .execute({ phone: '+14155550134', name: 'Dana Reyes', reason: 'burst pipe', consent: true }, {});

    for (let i = 0; i < 80 && !document.querySelector('[data-callingly-confirm]'); i++) {
        await new Promise((f) => setTimeout(f, 50));
    }

    document.querySelector('[data-callingly-confirm]').shadowRoot.querySelector('.yes').click();

    const result = await pending;

    return { text: result.content[0].text, isError: !!result.isError };
});

check('the call request was accepted', !placed.isError, placed.text);
check('the accepted call names the page label', placed.text.includes("Joe's Plumbing"), placed.text);
check('the server name does not leak into the confirmation', !placed.text.includes('Sales team'), placed.text);

await browser.close();
process.exit(failures ? 1 : 0);

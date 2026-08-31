/*
 * The confirmation card is where a visitor checks the number is theirs, so
 * it shows a grouped one — while what gets sent stays exactly what the caller
 * passed.
 */
import { chromium } from 'playwright';
let failures = 0;
const check = (n, ok, extra='') => { console.log((ok?'PASS  ':'FAIL  ')+n+(extra?' — '+extra:'')); if(!ok) failures++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.addInitScript(() => {
    window.__tools = [];
    document.modelContext = { registerTool(t) { window.__tools.push(t); return Promise.resolve(); } };
});
await page.goto('http://localhost:8787/demo/copperleaf/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__tools.length >= 2, { timeout: 8000 });

await page.evaluate(() => {
    window.__p = window.__tools.find((t) => t.name.includes('request-sales-call'))
        .execute({ phone: '+14155550134', name: 'Dana Reyes', consent: true });
});
await page.waitForFunction(() => document.querySelector('[data-callingly-confirm]')?.shadowRoot?.querySelector('.num')?.textContent, { timeout: 5000 });
const shown = await page.evaluate(() => document.querySelector('[data-callingly-confirm]').shadowRoot.querySelector('.num').textContent);
check('card groups the number', shown === '+1 415 555 0134', JSON.stringify(shown));

// Accepting must still send the unformatted number the caller gave.
const posted = [];
page.on('request', (r) => { if (r.url().includes('/calls') && r.method() === 'POST') posted.push(r.postData()); });
await page.evaluate(() => {
    const root = document.querySelector('[data-callingly-confirm]').shadowRoot;
    Array.from(root.querySelectorAll('button')).find((b) => /call me/i.test(b.textContent)).click();
});
await page.waitForTimeout(1200);
check('sends the raw number, not the display one', posted.length === 1 && /"phone":"\+14155550134"/.test(posted[0]),
    (posted[0] || 'nothing posted').slice(0, 80));
const result = await page.evaluate(() => window.__p.then((r) => r.content[0].text));
check('result text is grouped too', /\+1 415 555 0134/.test(result), result.slice(0, 110));

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

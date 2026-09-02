/*
 * Builds site/ — what Cloudflare Pages serves — from demo/joes-plumbing/.
 *
 * The two are the same pages with one difference: the local demo loads the
 * snippet from the mock server (so `npm start` needs no backend), while the
 * deployed site loads it from callingly.com with the real demo key, so a judge
 * clicking through gets live availability and a real phone call. Generating
 * one from the other keeps a single source of truth for the site itself.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const LOCAL = '<script src="/webmcp.js" data-callingly-key="demo" data-team="Joe\'s Plumbing" async></script>';
const LIVE = '<script src="https://callingly.com/js/webmcp.js"\n'
    + '        data-callingly-key="fFcdRp7ahpaFHTmkioOT"\n'
    + '        data-team="Joe\'s Plumbing" async></script>';

rmSync('site', { recursive: true, force: true });

for (const page of ['before', 'after']) {
    const src = readFileSync(`demo/joes-plumbing/${page}/index.html`, 'utf8');

    if (page === 'after' && !src.includes(LOCAL)) {
        throw new Error('after/index.html no longer carries the expected snippet tag');
    }

    mkdirSync(`site/${page}`, { recursive: true });
    writeFileSync(`site/${page}/index.html`, src.split(LOCAL).join(LIVE));
}

writeFileSync('site/index.html', readFileSync('site-index.html', 'utf8'));

console.log('site/ built — before/, after/, index.html');

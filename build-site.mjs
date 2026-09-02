/*
 * Builds site/ — what the joesplumbing.callingly.com host serves — from
 * demo/joes-plumbing/after/.
 *
 * Same page, one difference: the local demo loads the snippet from the mock
 * server (so `npm start` needs no backend), while the deployed site loads it
 * from callingly.com with the real demo key, so a visitor gets live
 * availability and a real phone call. Generating one from the other keeps a
 * single source of truth for the site itself.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const LOCAL = '<script src="/webmcp.js" data-callingly-key="demo" data-team="Joe\'s Plumbing" async></script>';
const LIVE = '<script src="https://callingly.com/js/webmcp.js"\n'
    + '        data-callingly-key="fFcdRp7ahpaFHTmkioOT"\n'
    + '        data-team="Joe\'s Plumbing" async></script>';

// Only the "after" page is deployed, and it sits at the root. The domain
// reads as an ordinary plumber's website, so a landing page explaining the
// demo — or a /before/ path — would give the game away before an agent ever
// looked at it. The before/after pair still lives in demo/ for the diff and
// for the tests.
const src = readFileSync('demo/joes-plumbing/after/index.html', 'utf8');

if (!src.includes(LOCAL)) {
    throw new Error('demo/joes-plumbing/after/index.html no longer carries the expected snippet tag');
}

rmSync('site', { recursive: true, force: true });
mkdirSync('site', { recursive: true });
writeFileSync('site/index.html', src.split(LOCAL).join(LIVE));

console.log('site/ built — index.html (the after page, live snippet)');

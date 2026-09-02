# Deploying the demo site

`site/` is what gets served, and it holds exactly one file: `index.html`, the
plumber page with the snippet on it, at the root. It is generated from
`demo/joes-plumbing/after/index.html` by `npm run build:site` and committed, so
a host needs no build step at all.

There is deliberately no landing page and no `/before/` path on the deployed
site. The domain has to read as an ordinary plumber's website — a page
explaining the demo would give the game away before an agent ever looked at it.
The before/after pair still lives in `demo/` for the `diff` and for the tests.

The hosted page differs from the local one in one line: `npm start` loads the
snippet from its own mock server so it works with no backend, while `site/`
loads it from `callingly.com` with the demo account's key, so a visitor gets
live availability and a real phone call.

## Cloudflare Pages, connected to this repo

Dashboard → Workers & Pages → Create → Pages → Connect to Git → `callingly/webmcp`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `site` |

Every push to `main` then redeploys. Nothing else to configure — the page is
static and the API it calls is CORS-open by design.

The deployment is served at <https://joesplumbing.callingly.com/> via a custom
domain on the Pages project.

## After editing the site

```sh
npm run build:site   # regenerates site/index.html from demo/joes-plumbing/after/
git add site demo && git commit && git push
```

`build:site` fails loudly if `demo/joes-plumbing/after/index.html` no longer
carries the expected snippet tag, so the two cannot drift apart silently.

## Locking the key to these origins (optional)

The embed key is public by design, and the call endpoint is rate limited per IP
and per key. To narrow it further, set `settings.embed_origins` on the demo
integration to the deployed origin plus `https://callingly.com` — the endpoint
then refuses any other site. Leave it unset and any origin may use the key,
matching how the webhook URL already behaves.

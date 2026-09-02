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

## Deploying

The live site is a Cloudflare **Worker with static assets** — `wrangler.toml`
here, served at <https://joesplumbing.callingly.com/> via a custom domain:

```sh
npm run build:site   # regenerates site/index.html from demo/joes-plumbing/after/
npx wrangler deploy  # uploads site/ to the `webmcp` Worker
```

This is **not** connected to Git, so pushing to `main` does not redeploy it —
run `wrangler deploy` after any change to the page.

`build:site` fails loudly if `demo/joes-plumbing/after/index.html` no longer
carries the expected snippet tag, so the two cannot drift apart silently.

Unknown paths 404 by default, which is what we want: no `/before/` or `/after/`
survives on the deployed origin even though earlier deploys served them.

## Cloudflare Pages instead, connected to this repo

If you would rather have every push to `main` redeploy: Dashboard → Workers &
Pages → Create → Pages → Connect to Git → `callingly/webmcp`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `site` |

Nothing else to configure — the page is static and the API it calls is
CORS-open by design.

## Locking the key to these origins (optional)

The embed key is public by design, and the call endpoint is rate limited per IP
and per key. To narrow it further, set `settings.embed_origins` on the demo
integration to the deployed origin plus `https://callingly.com` — the endpoint
then refuses any other site. Leave it unset and any origin may use the key,
matching how the webhook URL already behaves.

# Deploying the demo site

`site/` is what gets served. It is generated from `demo/joes-plumbing/` by
`npm run build:site` and committed, so a host needs no build step at all.

The two differ in one way: the local demo (`npm start`) loads the snippet from
its own mock server so it works with no backend, while `site/` loads it from
`callingly.com` with the demo account's key, so a visitor gets live availability
and a real phone call.

## Cloudflare Pages, connected to this repo

Dashboard → Workers & Pages → Create → Pages → Connect to Git → `callingly/webmcp`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `site` |

Every push to `main` then redeploys. Nothing else to configure — the pages are
static and the API they call is CORS-open by design.

## After editing the site

```sh
npm run build:site   # regenerates site/ from demo/joes-plumbing/
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

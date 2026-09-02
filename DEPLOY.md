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

The live site is a Cloudflare **Pages** project connected to this repo, serving
`site/` at <https://joesplumbing.callingly.com/>. A push to `main` redeploys it,
about a minute end to end:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `site` |

So the whole flow after editing the page is:

```sh
npm run build:site   # regenerates site/index.html from demo/joes-plumbing/after/
git add site demo && git commit && git push
```

To publish without a push — or if the Git integration is ever disconnected:

```sh
npx wrangler pages deploy site --project-name=<project>
```

Deliberately no `wrangler.toml` here: Pages reads one from the repo root if it
finds it, and a config written for a Worker (`[assets]`) makes the build fail.

`build:site` fails loudly if `demo/joes-plumbing/after/index.html` no longer
carries the expected snippet tag, so the two cannot drift apart silently.

Unknown paths 404, so no `/before/` or `/after/` survives on the deployed
origin even though earlier deploys served them.

## Locking the key to these origins (optional)

The embed key is public by design, and the call endpoint is rate limited per IP
and per key. To narrow it further, set `settings.embed_origins` on the demo
integration to the deployed origin plus `https://callingly.com` — the endpoint
then refuses any other site. Leave it unset and any origin may use the key,
matching how the webhook URL already behaves.

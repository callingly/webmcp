# Callingly for WebMCP

**One script tag that lets an AI agent get a human sales rep on the phone with
the person it is helping — in about a minute, with their explicit say-so.**

```html
<script src="https://callingly.com/js/webmcp.js"
        data-callingly-key="YOUR_WEBHOOK_KEY" async></script>
```

That is the whole integration. The snippet registers two
[WebMCP](https://webmachinelearning.github.io/webmcp/) tools on the page:

| Tool | What it does |
| --- | --- |
| `callingly-check-sales-availability` | Read-only. Is the team inside its hours, is a rep actually free right now, when is the next opening, and are call requests being accepted at all. |
| `callingly-request-sales-call` | Asks Callingly to ring the sales team and bridge the visitor. Requires the visitor's consent, and confirms in-page before anything is sent. |

## The problem this solves

Every B2B site has the same dead end: a visitor with a real question, and a
contact form that answers in "1–2 business days". The visitor wants to *talk to
someone*. The site can only offer them a form or a scheduling link three days
out.

An agent browsing that page hits the same wall. It can read your pricing and
summarise your docs, but the moment its user says "I just need to talk to a
human about this", the best it can do is fill in the form and hope.

With these tools on the page, the agent can find out whether anyone is actually
free — not whether the office is nominally open, but whether a rep is on, off
another call and past their cooldown — and then get that rep dialling. The
visitor's phone rings while they still have the page open and the question in
their head.

**What is newly possible:** the agent negotiates the *timing* of a human
conversation. "They're free now, want me to get someone on the line?" / "Nobody
until 9am Tuesday — shall I have them call you then?" That is a conversation
about human availability that a form cannot have and a chatbot has no authority
to make good on.

## Try it in 60 seconds

```bash
git clone https://github.com/callingly/webmcp
cd webmcp
npm start          # no dependencies; serves on http://localhost:8787
```

Then open it in a WebMCP-capable browser:

- **ChatGPT's in-app browser** — WebMCP works out of the box, or
- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled.

Three pages are served:

| URL | What it is |
| --- | --- |
| <http://localhost:8787/demo/joes-plumbing/before/> | A **fictional plumber's site**, as the web is today. Good design, real phone number, and a contact form that promises a reply "within 1–2 business days". An agent that lands here has nothing to work with. |
| <http://localhost:8787/demo/joes-plumbing/after/> | The **same file plus one line**. `diff demo/joes-plumbing/{before,after}/index.html` shows exactly one changed row: the script tag. |
| <http://localhost:8787/> | An **agent console**: the same snippet, plus a live view of which tools registered and every call an agent makes against them, with arguments and return values. |

The before/after pair is the whole argument in one `diff`. Nothing else on the
page changes — the contact form still says 1–2 business days, because the human
path is not what this replaces. What changes is that an agent can now find out
whether anyone is free and get the visitor a phone call in the next minute.

Ask your agent things like:

> "Is the sales team available to talk right now?"
> "When is the earliest I could speak to someone?"
> "Have someone call me on +1 415 555 0134 about pricing."

`npm start` runs a **mock backend**, so no real call is placed and the
console prints what would have been sent. To drive a real Callingly account,
pass the API origin and a webhook key:

```
http://localhost:8787/?api=https://callingly.com&key=YOUR_WEBHOOK_KEY
```

Set the mock's team name to match the page you are on:

```bash
DEMO_TEAM="Copperleaf Solar" npm start     # the name the agent says back
DEMO_CLOSED=1 npm start                    # exercise the after-hours path
```

## How consent works

Getting a stranger's phone to ring is not something an agent should be able to
do on a hunch, so consent is enforced in three places and the tool descriptions
say so plainly:

1. **`consent` is a required boolean in the tool's input schema**, described as
   *"True only if the visitor asked to be called on this number. Never assume
   it."* An agent that omits it gets an `isError` result telling it to go and
   ask, not a call.
2. **The page confirms.** Before anything is sent, the snippet shows a card in
   a shadow root — immune to the host page's CSS — naming the number and asking
   the visitor to approve. Escape, an abort signal or 120 seconds of silence
   all count as "no".
3. **The server records it.** Consent, the page URL, the origin and a timestamp
   land on the audit row alongside the lead.

The direct JS API (`window.callingly.requestCall`) applies the same rules, so
non-WebMCP callers cannot route around them.

## How it is implemented

The snippet is dependency-free ES5 in a single IIFE, ~500 lines. It:

- reads its config from the script tag (`data-callingly-key`, `data-api`,
  `data-team`, `data-prefix`, `data-confirm`) or `window.callinglySettings`;
- registers both tools via `document.modelContext.registerTool(tool, { signal })`,
  falling back to `navigator.modelContext` for older origin-trial builds;
- retries registration when `document.modelContext` is not there yet — agent
  browsers inject it at different points in page load — and recovers a tool
  whose registration rejects after the retry window has closed;
- unregisters through an `AbortController`, since WebMCP has no
  `unregisterTool`;
- returns MCP `content` results, using `isError` for refusals so the agent gets
  a sentence it can act on rather than an exception;
- exposes everything on `window.callingly` so ordinary page code, or an
  extension that does not speak WebMCP yet, can call the same functions.

The server side is two public endpoints:

```
GET  /embed/v1/{key}/availability
POST /embed/v1/{key}/calls
```

keyed by a Callingly webhook integration's slug. Accepted calls are handed to
the same queued pipeline every webhook lead goes through — routing rules,
de-duplication, then dialling — so the endpoint answers `202` rather than
pretending to know which rep will pick up. See
[`server/README.md`](server/README.md) for the real implementation and the
reasoning behind the key model, the rate limits and the field-mapping guard.

## What is in this repo

```
webmcp.js              The snippet, exactly as production serves it
demo/index.html        Agent console — tools and live tool calls
demo/joes-plumbing/    A fictional customer site, before and after the one line
site/                  The same pair built for hosting — see DEPLOY.md
build-site.mjs         Generates site/ from demo/joes-plumbing/
demo/server.js         Dependency-free mock API + static server
server/                The real Laravel implementation, for reading
test/                  Browser checks for both demo pages
```

## Tests

The server side has a Pest feature suite (`server/EmbedWebMcpTest.php`):
availability open and closed, unknown keys, the exact payload handed to the
queue, consent refusal, undialable numbers, the origin allow-list, the
field-mapping guard and CORS preflight.

The client side has browser checks that drive a stubbed `document.modelContext`
the way an agent browser would:

```bash
npm install     # playwright, for the browser checks only
npm start &     # in another shell
npm test
```

They assert that both tools register, that availability is marked
`readOnlyHint`, that a call with no consent is refused with an actionable
message and creates no card, that the confirmation card appears and that
declining it sends nothing.

## License

MIT — see [LICENSE](LICENSE).

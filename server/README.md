# Server reference

These are the real files that back the snippet in Callingly's Laravel app,
copied here verbatim so the whole implementation is readable. They are not
wired up as a standalone service — [`../demo/server.js`](../demo/server.js) is
a dependency-free mock with the same two endpoints and the same response
shapes, which is what `npm start` runs.

| File | What it is |
| --- | --- |
| `routes-embed.php` | The two public routes, deliberately outside the session-authenticated `web` stack. Lives at `routes/embed.php`. |
| `WebMcpController.php` | Resolves the integration from the embed key, answers availability, and hands accepted calls to the same queued webhook pipeline every other lead goes through. |
| `EmbedCors.php` | Wildcard CORS for the embed routes. The app's normal CORS config sets `supports_credentials`, which forbids a wildcard origin, so these routes need their own middleware. |
| `EmbedWebMcpTest.php` | The Pest feature suite: open and closed availability, unknown keys, the queued job payload, undialable numbers, the origin allow-list, the field-mapping guard, and CORS preflight. |

## Notes on the design

**The embed key is a webhook integration slug.** It is public by design, the
same way the webhook URL you paste into Zapier is: it can only submit a lead
to that one account. Rate limits (60/min per IP for reads, 3/min per IP and
60/hour per key for calls) and an optional `embed_origins` allow-list bound
the blast radius, and every submission lands on an `Event` row for audit.

**Calls are accepted, not placed inline.** The controller dispatches to the
existing queued pipeline, which applies the integration's routing rules,
de-dupes against known leads and starts the call. So it answers `202`, rather
than pretending to know which rep will pick up.

**The field-mapping guard.** A webhook integration that is not in AI-extract
mode reads leads through its own field map. If that map does not name `phone`,
the submission would be dropped after the agent had already been told the call
was accepted — so the controller returns `409` up front instead.

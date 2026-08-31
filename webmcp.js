/*!
 * Callingly WebMCP snippet
 * -----------------------------------------------------------------------
 * Drop this on your website and an AI agent browsing the page can find out
 * when your sales team is free and ask Callingly to get one of your reps on
 * the phone with the visitor — right then, no form, no scheduling link.
 *
 *   <script src="https://callingly.com/js/webmcp.js"
 *           data-callingly-key="YOUR_WEBHOOK_KEY" async></script>
 *
 * The key is the slug from a Callingly Webhook integration's URL
 * (Settings -> Integrations -> Webhook). It is public by design, the same way
 * the webhook URL you paste into other tools is: it can only submit a lead to
 * your account. Rate limits and an optional origin allow-list guard it.
 *
 * Tools registered (WebMCP, https://webmachinelearning.github.io/webmcp/):
 *   <prefix>-check-sales-availability  read-only; hours + can they talk now
 *   <prefix>-request-sales-call        rings the team and bridges the visitor
 *
 * Optional attributes:
 *   data-api="https://callingly.com"  API origin (defaults to this script's)
 *   data-team="Sales"                 label used in tool descriptions
 *   data-prefix="callingly"           tool-name prefix ("" for none)
 *   data-confirm="false"              skip the in-page confirmation card
 *
 * Anything registered here is also on window.callingly, so your own code (or
 * an extension that doesn't speak WebMCP yet) can call the same functions.
 */
(function () {
    'use strict';

    var script = document.currentScript || document.querySelector('script[data-callingly-key], script[data-key][src*="webmcp"]');
    var overrides = window.callinglySettings || {};

    function attr(name) {
        return script && script.getAttribute(name);
    }

    function defaultApiOrigin() {
        try {
            return new URL(script.src, window.location.href).origin;
        } catch (e) {
            return 'https://callingly.com';
        }
    }

    var config = {
        key: overrides.key || attr('data-callingly-key') || attr('data-key'),
        api: (overrides.api || attr('data-api') || defaultApiOrigin()).replace(/\/+$/, ''),
        team: overrides.team || attr('data-team') || 'sales',
        prefix: overrides.prefix != null ? overrides.prefix : (attr('data-prefix') != null ? attr('data-prefix') : 'callingly'),
        confirm: overrides.confirm != null ? !!overrides.confirm : attr('data-confirm') !== 'false'
    };

    if (!config.key) {
        console.warn('[callingly] No Callingly key. Add data-callingly-key="..." to the script tag.');

        return;
    }

    function toolName(suffix) {
        return config.prefix ? config.prefix + '-' + suffix : suffix;
    }

    function endpoint(path) {
        return config.api + '/embed/v1/' + encodeURIComponent(config.key) + path;
    }

    /* ------------------------------------------------------------------
     * API calls
     * ---------------------------------------------------------------- */

    var availabilityCache = null;

    function request(path, options) {
        options = options || {};

        return fetch(endpoint(path), {
            method: options.method || 'GET',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: options.signal,
            mode: 'cors',
            credentials: 'omit'
        }).then(function (response) {
            return response.json().catch(function () {
                return {};
            }).then(function (payload) {
                if (response.ok) {
                    return payload;
                }

                var error = new Error(errorMessage(response.status, payload));
                error.status = response.status;
                error.payload = payload;

                throw error;
            });
        });
    }

    function errorMessage(status, payload) {
        if (payload && payload.errors) {
            var first = Object.keys(payload.errors)[0];

            if (first) {
                return payload.errors[first][0];
            }
        }

        if (payload && payload.message) {
            return payload.message;
        }

        if (status === 429) {
            return 'Too many requests to Callingly right now. Try again in a minute.';
        }

        return 'Callingly returned an unexpected error (HTTP ' + status + ').';
    }

    /**
     * Availability changes on the minute at most (schedules, who is on a
     * call), so a short cache keeps a chatty agent from re-fetching per turn.
     */
    function checkAvailability(options) {
        options = options || {};

        if (!options.fresh && availabilityCache && Date.now() - availabilityCache.at < 30000) {
            return Promise.resolve(availabilityCache.data);
        }

        return request('/availability', { signal: options.signal }).then(function (data) {
            availabilityCache = { at: Date.now(), data: data };

            return data;
        });
    }

    /**
     * Ask Callingly to call this person.
     *
     * `lead.consent` is the caller's assertion that the visitor asked to be
     * called on this number, and it is never assumed: the audit record kept
     * against the call has to mean something, so a caller that can't say yes
     * gets an error instead of a fabricated yes. On top of that the visitor
     * confirms on the page, which a first-party caller that has already taken
     * consent (its own form, say) can waive with `{ confirm: false }`.
     */
    function requestCall(lead, options) {
        options = options || {};

        if (lead.consent !== true) {
            return Promise.reject(new Error(
                'requestCall needs consent: true — the visitor must have asked to be called on this number.'
            ));
        }

        var confirmation = options.confirm === false
            ? Promise.resolve(true)
            : confirmCall(lead, options.signal);

        return confirmation.then(function (confirmed) {
            if (!confirmed) {
                var declined = new Error('The visitor did not confirm the call on the page.');
                declined.declined = true;

                throw declined;
            }

            return request('/calls', {
                method: 'POST',
                signal: options.signal,
                body: {
                    fname: lead.fname || null,
                    lname: lead.lname || null,
                    phone: lead.phone,
                    email: lead.email || null,
                    company: lead.company || null,
                    comments: lead.comments || null,
                    page_url: window.location.href,
                    consent: true
                }
            });
        }).then(function (data) {
            // The team's state just changed (a rep is about to be on a call).
            availabilityCache = null;

            return data;
        });
    }

    /* ------------------------------------------------------------------
     * Confirmation card
     *
     * WebMCP has no built-in consent prompt, and this tool makes a phone
     * ring: someone's number gets dialed and a rep's time gets spent. So the
     * page asks the human directly before the request goes out, in a shadow
     * root so no host-page CSS can hide or restyle it.
     * ---------------------------------------------------------------- */

    function confirmCall(lead, signal) {
        if (!config.confirm) {
            return Promise.resolve(true);
        }

        return new Promise(function (resolve) {
            var host = document.createElement('div');
            host.setAttribute('data-callingly-confirm', '');
            var root = host.attachShadow({ mode: 'open' });

            root.innerHTML =
                '<style>' +
                ':host{all:initial}' +
                '.card{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;max-width:calc(100vw - 32px);' +
                'background:#fff;color:#0e2d3e;border-radius:12px;box-shadow:0 12px 32px rgba(7,59,76,.24);' +
                'font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}' +
                '.title{font-weight:600;margin:0 0 6px;font-size:15px}' +
                '.body{margin:0 0 14px;color:#3d5866}' +
                '.num{font-weight:600;color:#0e2d3e;white-space:nowrap}' +
                '.row{display:flex;gap:8px;justify-content:flex-end}' +
                'button{font:inherit;font-weight:600;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid transparent}' +
                '.no{background:#fff;border-color:#c9d6dd;color:#3d5866}' +
                '.yes{background:#167296;color:#fff}' +
                '.yes:hover{background:#0e2d3e}' +
                'button:focus-visible{outline:2px solid #24a9df;outline-offset:2px}' +
                '@media (prefers-color-scheme:dark){.card{background:#0e2d3e;color:#eaf4f8}.body{color:#b7cdd7}' +
                '.num{color:#eaf4f8}.no{background:transparent;border-color:#3d5866;color:#b7cdd7}}' +
                '</style>' +
                '<div class="card" role="dialog" aria-modal="false" aria-labelledby="callingly-confirm-title">' +
                '<p class="title" id="callingly-confirm-title">Call you now?</p>' +
                '<p class="body">We\'ll ring our ' + escapeHtml(config.team) + ' team and connect them to ' +
                '<span class="num"></span> in the next minute or two.</p>' +
                '<div class="row"><button type="button" class="no">Not now</button>' +
                '<button type="button" class="yes">Call me</button></div></div>';

            root.querySelector('.num').textContent = lead.phone;

            var settled = false;

            function finish(answer) {
                if (settled) {
                    return;
                }

                settled = true;
                document.removeEventListener('keydown', onKey, true);
                host.remove();
                resolve(answer);
            }

            function onKey(event) {
                if (event.key === 'Escape') {
                    finish(false);
                }
            }

            root.querySelector('.yes').addEventListener('click', function () {
                finish(true);
            });
            root.querySelector('.no').addEventListener('click', function () {
                finish(false);
            });
            document.addEventListener('keydown', onKey, true);

            if (signal) {
                signal.addEventListener('abort', function () {
                    finish(false);
                });
            }

            // An unanswered card is a "no": never leave a pending call request
            // hanging around a page the visitor has moved on from.
            setTimeout(function () {
                finish(false);
            }, 120000);

            document.body.appendChild(host);
            root.querySelector('.yes').focus();
        });
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }

    /* ------------------------------------------------------------------
     * Tool result helpers
     * ---------------------------------------------------------------- */

    function text(value) {
        return { content: [{ type: 'text', text: value }] };
    }

    function failure(value) {
        return { content: [{ type: 'text', text: value }], isError: true };
    }

    function describeAvailability(data) {
        var lines = [];

        lines.push(data.available_now
            ? 'The ' + data.team + ' team can take a call right now.'
            : 'The ' + data.team + ' team cannot take a call right now.');

        if (!data.available_now) {
            lines.push(data.within_business_hours
                ? 'They are inside business hours but every rep is on a call or off duty.'
                : 'They are outside their calling hours.');
        }

        if (data.next_available_description) {
            lines.push('Next available: ' + data.next_available_description + '.');
        } else if (!data.accepting_call_requests) {
            lines.push('No calling hours are set, so no time can be quoted.');
        }

        lines.push('Business hours (' + data.timezone + '), local time ' + data.local_time + ':');

        (data.business_hours || []).forEach(function (day) {
            lines.push('  ' + day.day + ': ' + (day.closed
                ? 'closed'
                : day.windows.map(function (window) {
                    return window.start + '-' + window.end;
                }).join(', ')));
        });

        if (data.accepting_call_requests) {
            lines.push('A call can be requested at any time — outside hours it is queued and placed when the team opens.');
        }

        return lines.join('\n');
    }

    function splitName(value) {
        var parts = String(value || '').trim().split(/\s+/).filter(Boolean);

        return { fname: parts.shift() || null, lname: parts.join(' ') || null };
    }

    /* ------------------------------------------------------------------
     * Tool definitions
     * ---------------------------------------------------------------- */

    var tools = [
        {
            name: toolName('check-sales-availability'),
            description:
                'Check whether this company\'s ' + config.team + ' team can take a phone call right now, when they are ' +
                'next available, and their weekly calling hours. Call this before offering the visitor a phone call.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
            execute: function (input, options) {
                return checkAvailability({ signal: options && options.signal }).then(function (data) {
                    return {
                        content: [
                            { type: 'text', text: describeAvailability(data) },
                            { type: 'text', text: JSON.stringify(data) }
                        ]
                    };
                }).catch(function (error) {
                    return failure('Could not read ' + config.team + ' availability: ' + error.message);
                });
            }
        },
        {
            name: toolName('request-sales-call'),
            description:
                'Get the visitor on the phone with this company\'s ' + config.team + ' team now. Callingly rings the ' +
                'available reps and bridges the first one who picks up to the visitor\'s phone, usually within a ' +
                'minute. This places a real phone call to a real person: only use it when the visitor has asked to ' +
                'be called and has given you their own phone number, and pass consent=true to confirm that. ' +
                'Outside the team\'s calling hours the request is queued and placed when they open. ' +
                'The visitor is also asked to confirm on the page before the call goes out.',
            inputSchema: {
                type: 'object',
                properties: {
                    phone: {
                        type: 'string',
                        description: 'The visitor\'s phone number, with country code where possible (e.g. +1 415 555 0134).'
                    },
                    name: { type: 'string', description: 'The visitor\'s full name.' },
                    email: { type: 'string', description: 'The visitor\'s email address.' },
                    company: { type: 'string', description: 'The visitor\'s company.' },
                    reason: {
                        type: 'string',
                        description: 'What the visitor wants to talk about, in one or two sentences. Shown to the rep before they connect.'
                    },
                    consent: {
                        type: 'boolean',
                        description: 'True only if the visitor asked to be called on this number. Never assume it.'
                    }
                },
                required: ['phone', 'consent']
            },
            execute: function (input, options) {
                input = input || {};

                var signal = options && options.signal;

                if (!input.phone) {
                    return Promise.resolve(failure('A phone number is required. Ask the visitor for the number to call.'));
                }

                if (input.consent !== true) {
                    return Promise.resolve(failure(
                        'Not sent: consent was not given. Ask the visitor whether they want the ' + config.team +
                        ' team to call them on this number, then retry with consent=true.'
                    ));
                }

                var name = splitName(input.name);

                return requestCall({
                    fname: name.fname,
                    lname: name.lname,
                    phone: String(input.phone).trim(),
                    email: input.email || null,
                    company: input.company || null,
                    comments: input.reason || null,
                    consent: true
                }, { signal: signal }).then(function (data) {
                    return text(data.message + ' (Callingly is calling ' + data.phone_number + '.)');
                }).catch(function (error) {
                    if (error.declined) {
                        return failure(
                            'The visitor did not confirm the call on the page, so nothing was sent. ' +
                            'Ask them whether they still want to be called before trying again.'
                        );
                    }

                    return failure('The call could not be requested: ' + error.message);
                });
            }
        }
    ];

    /* ------------------------------------------------------------------
     * Registration
     *
     * The API moved from navigator.modelContext to document.modelContext, and
     * some agents inject their own shim after page load — so try both, and
     * keep looking for a short while before giving up.
     * ---------------------------------------------------------------- */

    var controller = new AbortController();

    // Per tool: undefined = not registered, 'pending' = registerTool in
    // flight, 'done' = it resolved. registerTool is async and can reject, so a
    // tool only counts as registered once its own promise settles — otherwise
    // one rejection would look like a clean registration and stop the retries
    // that could still recover it.
    var state = {};
    var attempts = 0;
    var restarts = 0;
    var timer = null;
    var watcher = null;

    function modelContext() {
        return (typeof document !== 'undefined' && document.modelContext)
            || (typeof navigator !== 'undefined' && navigator.modelContext)
            || null;
    }

    function allRegistered() {
        var context = modelContext();

        // Registered means registered with the context that is live *now*. A
        // tool sitting on a context that has since been replaced is not
        // reachable, so it does not count.
        return !!context && tools.every(function (tool) {
            var entry = state[tool.name];

            return entry && entry.status === 'done' && entry.context === context;
        });
    }

    /**
     * Drop a tool that failed to register, and make sure something is still
     * trying: registerTool can stay pending past the retry window and only
     * then reject, by which point the timer has stopped and its budget is
     * spent, so the tool would be gone for the life of the page.
     *
     * Only such a late rejection buys a fresh window. One that lands while
     * the timer is still running is already covered by it, and spending the
     * allowance on those would leave nothing for the late one that needs it.
     * The cap stops an implementation that always rejects from spinning.
     */
    function forget(tool, error) {
        state[tool.name] = undefined;
        console.warn('[callingly] Could not register ' + tool.name + ':', error);

        if (!timer && restarts < 3) {
            restarts++;
            attempts = 0;
        }

        scheduleRetries();
    }

    function register() {
        var context = modelContext();

        if (controller.signal.aborted || !context || typeof context.registerTool !== 'function') {
            return false;
        }

        tools.forEach(function (tool) {
            var existing = state[tool.name];

            // Skip only what is already done or in flight against *this*
            // context. A replacement context — a native implementation landing
            // over an extension's, or document.modelContext appearing after we
            // settled for navigator's — needs its own registration, and
            // treating a pending one as good enough would leave the tool on
            // the obsolete context for the life of the page.
            if (existing && existing.context === context) {
                return;
            }

            var entry = { context: context, status: 'pending' };

            state[tool.name] = entry;

            // A settled promise from a superseded registration must not touch
            // state that has moved on: it would either report a tool as live
            // on the wrong context or drop a good registration.
            var isCurrent = function () {
                return state[tool.name] === entry;
            };

            try {
                Promise.resolve(context.registerTool(tool, { signal: controller.signal })).then(function () {
                    if (isCurrent()) {
                        entry.status = 'done';

                        // Wherever the last tool lands — inside the retry
                        // window or long after it gave up — that is the moment
                        // the replacement watch has to start. Hanging it off
                        // the retry timer instead missed a registration that
                        // resolved once the timer had stopped.
                        if (allRegistered()) {
                            watchForReplacement();
                        }
                    }
                }, function (error) {
                    if (isCurrent()) {
                        forget(tool, error);
                    }
                });
            } catch (error) {
                if (isCurrent()) {
                    forget(tool, error);
                }
            }
        });

        return allRegistered();
    }

    function scheduleRetries() {
        if (timer || attempts >= 20) {
            return;
        }

        timer = setInterval(function () {
            if (register() || ++attempts >= 20) {
                clearInterval(timer);
                timer = null;
            }
        }, 500);
    }

    /**
     * A context can also be swapped out *after* everything registered, and
     * there is no event to tell us. So once we are registered somewhere, keep
     * a slow watch: register() is a pair of identity checks while nothing has
     * changed, and re-registers the moment something has.
     *
     * Only ever started once every tool is registered, so pages in browsers
     * with no WebMCP at all — nearly all of them — give up after the retry
     * budget and leave no timer behind.
     */
    function watchForReplacement() {
        if (watcher) {
            return;
        }

        watcher = setInterval(register, 2000);
    }

    if (!register()) {
        scheduleRetries();
    }

    window.callingly = {
        config: config,
        tools: tools,
        checkAvailability: checkAvailability,
        requestCall: requestCall,
        isRegistered: function () {
            return allRegistered();
        },
        unregister: function () {
            controller.abort();
            state = {};

            // Stop watching, or the next tick would register all over again
            // against the signal we just aborted.
            if (timer) {
                clearInterval(timer);
                timer = null;
            }

            if (watcher) {
                clearInterval(watcher);
                watcher = null;
            }
        }
    };
})();

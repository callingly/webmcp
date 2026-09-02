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
 *   data-team="Sales"                 what the tools call the team, in their
 *                                     descriptions and in what they answer
 *   data-prefix="callingly"           tool-name prefix ("" for none)
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
        prefix: overrides.prefix != null ? overrides.prefix : (attr('data-prefix') != null ? attr('data-prefix') : 'callingly')
    };

    // Whether the page named the team itself, as opposed to falling back to
    // the generic label. See teamName().
    var teamFromPage = !!(overrides.team || attr('data-team'));

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
     */
    function requestCall(lead, options) {
        options = options || {};

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
                page_url: window.location.href
            }
        }).then(function (data) {
            // The team's state just changed (a rep is about to be on a call).
            availabilityCache = null;

            return data;
        });
    }

    /**
     * Group a number for display so a person reading the tool's answer can
     * check at a glance that it is theirs. Only NANP numbers have a grouping worth assuming; anything else is shown
     * exactly as it was given rather than guessed at. Display only: what gets
     * sent is always the number the caller passed.
     */
    function formatPhone(value) {
        var raw = String(value == null ? '' : value).trim();
        var digits = raw.replace(/[^0-9]/g, '');

        if (raw.charAt(0) === '+' && digits.length === 11 && digits.charAt(0) === '1') {
            return '+1 ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + ' ' + digits.slice(7);
        }

        if (raw.charAt(0) !== '+' && digits.length === 10) {
            return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
        }

        return raw;
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

    /**
     * What to call the team in a sentence. The page's own label wins when the
     * operator set one: the server knows the team by its internal Callingly
     * name, which can be nothing like what the site calls it, and the tool
     * descriptions already use the page's label. A
     * page that named no team gets the server's name, which beats "sales".
     */
    function teamName(data) {
        return teamFromPage ? config.team : ((data && data.team) || config.team);
    }

    /**
     * The server composes its own sentences — "We're ringing the X team now" —
     * and names the team by its internal Callingly name. Swap in the page's
     * label so the two tools cannot call the same team two unrelated things in
     * consecutive turns.
     *
     * Only the name in front of the word "team" is replaced. Replacing every
     * occurrence would garble the rest of the sentence for an account whose
     * team is named after a common word: a team called "call" would turn
     * "expect a call within a minute" into "expect a Plumbers within a minute".
     */
    function relabelTeam(message, data) {
        if (!teamFromPage || !message || !data || !data.team || data.team === config.team) {
            return message;
        }

        return message.split(data.team + ' team').join(config.team + ' team');
    }

    function describeAvailability(data) {
        var lines = [];
        var team = teamName(data);

        lines.push(data.available_now
            ? 'The ' + team + ' team can take a call right now.'
            : 'The ' + team + ' team cannot take a call right now.');

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
                'minute. This places a real phone call to a real person, so use the number the visitor gave you. ' +
                'Outside the team\'s calling hours the request is queued and placed when they open.',
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
                    }
                },
                required: ['phone']
            },
            execute: function (input, options) {
                input = input || {};

                var signal = options && options.signal;

                if (!input.phone) {
                    return Promise.resolve(failure('A phone number is required. Ask the visitor for the number to call.'));
                }

                var name = splitName(input.name);

                return requestCall({
                    fname: name.fname,
                    lname: name.lname,
                    phone: String(input.phone).trim(),
                    email: input.email || null,
                    company: input.company || null,
                    comments: input.reason || null
                }, { signal: signal }).then(function (data) {
                    return text(relabelTeam(data.message, data) + ' (Callingly is calling ' + formatPhone(data.phone_number) + '.)');
                }).catch(function (error) {
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
     * keep looking.
     *
     * One unconditional poll does all of it. There is no event for a context
     * appearing, being replaced, or a registration failing, and every attempt
     * to stop looking once things seemed settled left some ordering where
     * nothing was watching any more: a shim injected after a retry budget ran
     * out, a registration that stayed pending and rejected late, a context
     * swapped for another after a clean start. So the poll simply runs for the
     * life of the page, and register() is what decides whether there is
     * anything to do — a pair of identity checks when there is not.
     * ---------------------------------------------------------------- */

    var FAST_INTERVAL_MS = 500;
    var SLOW_INTERVAL_MS = 2000;
    var FAST_TICKS = 20;
    var MAX_FAILURES = 3;

    var controller = new AbortController();

    // Per tool, the last registration attempt: which context it was made
    // against, whether registerTool has resolved ('done'), rejected
    // ('failed') or is still in flight ('pending'), and how many times it has
    // rejected on that context. registerTool is async and can reject, so a
    // tool only counts as registered once its own promise resolves.
    var state = {};
    var ticks = 0;
    var timer = null;

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
     * Record a failed registration. The next poll retries it, up to MAX_FAILURES
     * times against the same context — enough to ride out a shim that is not
     * ready yet, without warning every couple of seconds for the life of the
     * page when an implementation simply refuses our tools. A replacement
     * context starts the count over, because it may well accept them.
     */
    function recordFailure(entry, tool, error) {
        entry.status = 'failed';
        entry.failures++;

        console.warn('[callingly] Could not register ' + tool.name + ':', error);
    }

    /**
     * Register anything that is not already registered against the context
     * that is live right now. Called on every poll, so it has to be cheap and
     * safe to repeat: when nothing has changed it does one identity check per
     * tool and returns.
     */
    function register() {
        var context = modelContext();

        if (controller.signal.aborted || !context || typeof context.registerTool !== 'function') {
            return false;
        }

        tools.forEach(function (tool) {
            var existing = state[tool.name];
            var sameContext = existing && existing.context === context;

            // Leave alone what is done or still in flight against *this*
            // context, and what has already failed on it too many times. A
            // replacement context — a native implementation landing over an
            // extension's, or document.modelContext appearing after we settled
            // for navigator's — always needs its own registration: a tool left
            // on the superseded context is not reachable.
            if (sameContext && (existing.status !== 'failed' || existing.failures >= MAX_FAILURES)) {
                return;
            }

            var entry = {
                context: context,
                status: 'pending',
                failures: sameContext ? existing.failures : 0
            };

            state[tool.name] = entry;

            // A settled promise from a superseded attempt must not touch state
            // that has moved on: it would either report a tool as live on the
            // wrong context or discard a good registration.
            var isCurrent = function () {
                return state[tool.name] === entry;
            };

            try {
                Promise.resolve(context.registerTool(tool, { signal: controller.signal })).then(function () {
                    if (isCurrent()) {
                        entry.status = 'done';
                    }
                }, function (error) {
                    if (isCurrent()) {
                        recordFailure(entry, tool, error);
                    }
                });
            } catch (error) {
                if (isCurrent()) {
                    recordFailure(entry, tool, error);
                }
            }
        });

        return allRegistered();
    }

    function poll() {
        register();

        // Quick while the page is still settling, since an agent's shim
        // usually lands within a few seconds of load, then slow and steady for
        // as long as the page is open. register() is nearly free when nothing
        // has changed, and nothing else can tell us a context arrived or was
        // swapped out.
        if (++ticks === FAST_TICKS) {
            clearInterval(timer);
            timer = setInterval(poll, SLOW_INTERVAL_MS);
        }
    }

    register();
    timer = setInterval(poll, FAST_INTERVAL_MS);

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

            // Stop polling, or the next tick would register all over again
            // against the signal we just aborted.
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }
    };
})();

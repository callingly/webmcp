/*
 * Mock Callingly embed API + static server, so this repo runs on its own.
 *
 *   node demo/server.js        then open http://localhost:8787
 *
 * It answers the same two endpoints as the real service with the same
 * response shapes, so webmcp.js is byte-identical to what production serves.
 * No calls are placed: requests are logged to the console and echoed back.
 *
 * To drive the real thing instead, open the demo page with ?api= and ?key=,
 * e.g. http://localhost:8787/?api=https://callingly.com&key=YOUR_KEY
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const ROOT = path.join(__dirname, '..');
const TEAM = process.env.DEMO_TEAM || 'Sales';
const TIMEZONE = process.env.DEMO_TIMEZONE || 'America/New_York';

// Flip to false (DEMO_CLOSED=1) to exercise the after-hours path an agent sees
// when nobody is on: availability says closed, but calls are still accepted
// and queued.
const OPEN = process.env.DEMO_CLOSED !== '1';

const WEEKDAY = [{ start: '09:00', end: '17:00' }];
const SCHEDULE = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => ({
    day,
    closed: false,
    windows: WEEKDAY,
})).concat([
    { day: 'Saturday', closed: true, windows: [] },
    { day: 'Sunday', closed: true, windows: [] },
]);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
}

function json(res, status, body) {
    const payload = JSON.stringify(body, null, 2);

    cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(payload);
}

/** Next weekday 09:00 in the team's timezone, as an ISO string. */
function nextOpening() {
    const now = new Date();
    const next = new Date(now);

    next.setHours(9, 0, 0, 0);

    if (next <= now) {
        next.setDate(next.getDate() + 1);
    }

    while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
    }

    return next.toISOString();
}

function availability() {
    const openAt = OPEN ? null : nextOpening();

    return {
        team: TEAM,
        timezone: TIMEZONE,
        local_time: new Date().toISOString(),
        available_now: OPEN,
        within_business_hours: OPEN,
        reps_available_now: OPEN,
        next_available_at: openAt,
        next_available_description: OPEN
            ? 'Available now'
            : 'Next available ' + new Date(openAt).toLocaleString(),
        business_hours: SCHEDULE,
        accepting_call_requests: true,
    };
}

/** Mirrors Laravel's 422 body so the snippet's error handling is exercised. */
function invalid(res, field, message) {
    return json(res, 422, { message, errors: { [field]: [message] } });
}

function handleCall(req, res, body) {
    let input;

    try {
        input = JSON.parse(body || '{}');
    } catch (e) {
        return invalid(res, 'phone', 'Could not parse that request body.');
    }

    const phone = String(input.phone || '').trim();

    if (!/^\+?[0-9][0-9\s\-().]{6,}$/.test(phone)) {
        return invalid(res, 'phone', "That doesn't look like a phone number we can dial. Include the country code, e.g. +1 415 555 0134.");
    }

    console.log('[mock] call requested', {
        name: [input.fname, input.lname].filter(Boolean).join(' ') || null,
        phone,
        comments: input.comments || null,
        page_url: input.page_url || null,
    });

    return json(res, 202, {
        accepted: true,
        team: TEAM,
        phone_number: phone,
        dialing_now: OPEN,
        message: OPEN
            ? "We're ringing the " + TEAM + ' team now — expect a call within a minute or two. (Mock server: no call was placed.)'
            : 'The ' + TEAM + " team is outside its calling hours, so the request is queued and will be called when they're next available. (Mock server: no call was placed.)",
    });
}

function serveStatic(req, res, pathname) {
    // Serve index.html for directory URLs, the way any static host would.
    const file = pathname === '/'
        ? '/demo/index.html'
        : (pathname.endsWith('/') ? pathname + 'index.html' : pathname);
    const resolved = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));

    if (!resolved.startsWith(ROOT)) {
        res.writeHead(403);

        return res.end('Forbidden');
    }

    fs.readFile(resolved, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });

            return res.end('Not found');
        }

        res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream' });
        res.end(data);
    });
}

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const embed = url.pathname.match(/^\/embed\/v1\/([^/]+)\/(availability|calls)$/);

    if (req.method === 'OPTIONS') {
        cors(res);
        res.writeHead(204);

        return res.end();
    }

    if (embed) {
        const [, key, action] = embed;

        if (key === 'unknown') {
            return json(res, 404, { message: 'Unknown embed key.' });
        }

        if (action === 'availability') {
            return json(res, 200, availability());
        }

        let body = '';

        req.on('data', (chunk) => { body += chunk; });

        return req.on('end', () => handleCall(req, res, body));
    }

    return serveStatic(req, res, url.pathname);
}).listen(PORT, () => {
    console.log('Callingly WebMCP demo on http://localhost:' + PORT);
    console.log(OPEN ? 'Team is OPEN (set DEMO_CLOSED=1 for the after-hours path)' : 'Team is CLOSED');
});

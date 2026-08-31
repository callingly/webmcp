<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * CORS for the public embed endpoints (routes/embed.php).
 *
 * The WebMCP snippet runs on customer websites, so the requesting origin is
 * any domain a customer owns. config/cors.php can't express that: it keeps
 * `supports_credentials` on, which forbids a wildcard origin. These endpoints
 * are keyed by the integration's webhook slug and never read the session or a
 * cookie, so a wildcard origin *without* credentials is the correct posture —
 * a hostile page gets no more than it would with curl and the same public key.
 */
class EmbedCors
{
    public function handle(Request $request, Closure $next): Response
    {
        // Answer the preflight here so it never reaches the throttler or the
        // controller (a browser sends it without the key's rate-limit budget
        // in mind, and it carries no body to validate).
        $response = $request->isMethod('OPTIONS')
            ? response('', Response::HTTP_NO_CONTENT)
            : $next($request);

        $response->headers->set('Access-Control-Allow-Origin', '*');
        $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Accept');
        $response->headers->set('Access-Control-Max-Age', '600');

        return $response;
    }
}

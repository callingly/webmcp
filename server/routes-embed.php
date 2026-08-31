<?php

use App\Http\Controllers\Embed\WebMcpController;
use Illuminate\Support\Facades\Route;

/*
 * Public endpoints for the WebMCP snippet customers embed on their own sites
 * (public/js/webmcp.js). Keyed by a webhook integration's slug, called
 * cross-origin from arbitrary domains, and never session-authenticated — so
 * this group deliberately sits outside the `web` middleware stack.
 */

Route::match(['get', 'options'], 'v1/{key}/availability', [WebMcpController::class, 'availability'])
    ->middleware('throttle:embed-read');

Route::match(['post', 'options'], 'v1/{key}/calls', [WebMcpController::class, 'call'])
    ->middleware('throttle:embed-call');

<?php

namespace App\Http\Controllers\Embed;

use App\Http\Controllers\Controller;
use App\Jobs\Integrations\Webhook;
use App\Models\Integration;
use App\Models\Profile;
use App\Services\PhoneNumber;
use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\ValidationException;

/**
 * Public, key-authenticated endpoints behind the WebMCP snippet
 * (public/js/webmcp.js) that customers embed on their own websites.
 *
 * The snippet registers two browser tools — one that reads when the sales
 * team can talk, one that asks Callingly to ring the team and bridge them to
 * the visitor — so an AI agent browsing the customer's site can get a lead on
 * the phone without leaving the page.
 *
 * The key is the webhook integration's `webhook_slug`: it is already the
 * customer's public "send me leads" credential, so the snippet adds no new
 * secret and every existing account can use it today. It is public by
 * definition, hence the throttling on these routes and the optional
 * `settings.embed_origins` allow-list.
 */
class WebMcpController extends Controller
{
    /**
     * Lead fields the snippet posts. Anything else in the body is ignored.
     *
     * @var list<string>
     */
    private const LEAD_FIELDS = ['fname', 'lname', 'phone', 'email', 'company', 'comments'];

    /**
     * When can this team talk, and can they talk right now?
     */
    public function availability(Request $request, string $key): JsonResponse
    {
        $integration = $this->resolveIntegration($request, $key);
        $team = $this->resolveTeam($integration);

        $team->loadMissing('voicemailSchedules', 'users.voicemailSchedules');

        $now = Date::now($team->timezone);
        $withinHours = $team->is_available;
        $repsReady = $team->is_users_available_for_call;
        $nextAvailable = $this->nextTeamAndUsersAvailable($team, $now);

        return response()->json([
            'team' => $team->name,
            'timezone' => $team->timezone,
            'local_time' => $now->toIso8601String(),
            // Available means a call placed right now would ring somebody:
            // the team is inside its hours AND a rep is on, off another call
            // and past their cooldown.
            'available_now' => $withinHours && $repsReady,
            'within_business_hours' => $withinHours,
            'reps_available_now' => $repsReady,
            'next_available_at' => $nextAvailable?->toIso8601String(),
            'next_available_description' => $this->describeNextAvailable($now, $nextAvailable),
            'business_hours' => $this->businessHours($team),
            // A call can still be requested outside hours — Callingly holds the
            // lead and dials when the team opens — unless nobody is ever on.
            'accepting_call_requests' => $team->hasAnyAvailability(),
        ]);
    }

    /**
     * Ask Callingly to call this visitor and bridge them to the sales team.
     *
     * Fire-and-forget by design: the same queued pipeline that every webhook
     * lead goes through applies the integration's routing rules, de-dupes
     * against existing leads and starts the call, so this returns 202 rather
     * than pretending to know which rep will pick up.
     */
    public function call(Request $request, string $key): JsonResponse
    {
        $integration = $this->resolveIntegration($request, $key);
        $team = $this->resolveTeam($integration);

        $data = $request->validate([
            'fname' => ['nullable', 'string', 'max:60'],
            'lname' => ['nullable', 'string', 'max:60'],
            'phone' => ['required', 'string', 'max:32'],
            'email' => ['nullable', 'email', 'max:120'],
            'company' => ['nullable', 'string', 'max:120'],
            'comments' => ['nullable', 'string', 'max:1000'],
            'page_url' => ['nullable', 'string', 'max:2048'],
        ]);

        $phone = PhoneNumber::getE164($data['phone'], $integration->account->country_code ?: 'US');

        if (!$phone) {
            throw ValidationException::withMessages([
                'phone' => ["That doesn't look like a phone number we can dial. Include the country code, e.g. +1 415 555 0134."],
            ]);
        }

        $this->assertIntegrationCanReadOurFields($integration);

        Webhook::dispatch($integration->webhook_slug, $request->fullUrl(), [
            'fname' => $data['fname'] ?? null,
            'lname' => $data['lname'] ?? null,
            'phone' => $phone,
            'email' => $data['email'] ?? null,
            'company' => $data['company'] ?? null,
            'comments' => $data['comments'] ?? null,
            'source' => $integration->name,
            // Kept for the audit trail on the Event row.
            'page_url' => $data['page_url'] ?? $request->headers->get('referer'),
            'origin' => $request->headers->get('origin'),
            'requested_via' => 'webmcp',
        ]);

        $repsReady = $team->is_available && $team->is_users_available_for_call;

        return response()->json([
            'accepted' => true,
            'team' => $team->name,
            'phone_number' => $phone,
            'dialing_now' => $repsReady,
            'message' => $repsReady
                ? "We're ringing the {$team->name} team now — expect a call within a minute or two."
                : "The {$team->name} team is outside its calling hours, so the request is queued and will be called when they're next available.",
        ], 202);
    }

    /**
     * @throws \Symfony\Component\HttpKernel\Exception\HttpException
     */
    private function resolveIntegration(Request $request, string $key): Integration
    {
        $integration = Integration::with('account', 'profile')
            ->where('webhook_slug', $key)
            ->first();

        abort_unless($integration, 404, 'Unknown Callingly key.');

        // Optional per-integration origin allow-list. Unset (the default)
        // means any site may use the key, matching how the webhook URL already
        // works; set it to lock the key to the customer's own domains.
        $allowed = $integration->settings['embed_origins'] ?? null;

        if (is_array($allowed) && $allowed !== []) {
            $origin = $request->headers->get('origin');

            abort_unless($origin && in_array($origin, $allowed, true), 403, 'This site is not allowed to use this Callingly key.');
        }

        return $integration;
    }

    private function resolveTeam(Integration $integration): Profile
    {
        $team = $integration->profile ?: $integration->account->primary_profile;

        abort_unless($team, 404, 'This Callingly key has no team to route calls to.');

        return $team;
    }

    /**
     * The next moment the team is open *and* a rep is on shift.
     *
     * Profile::getNextLeadTeamAndUsersAvailable does this for a known lead;
     * there is no lead yet here, so this walks the same converge-on-the-latest
     * loop over the team and its users only.
     */
    private function nextTeamAndUsersAvailable(Profile $team, CarbonInterface $now): ?CarbonInterface
    {
        $candidate = $now;
        $limit = $now->addWeek();

        while ($candidate->lte($limit)) {
            $teamNext = $team->getNextAvailableAttribute($candidate);
            $usersNext = $team->getUsersNextAvailableAttribute($candidate);

            if ($teamNext === false || $usersNext === false) {
                return null;
            }

            if ($teamNext->eq($usersNext)) {
                return $teamNext->setTimezone($team->timezone);
            }

            $candidate = ($teamNext->gt($usersNext) ? $teamNext : $usersNext)->setTimezone($team->timezone);
        }

        return null;
    }

    private function describeNextAvailable(CarbonInterface $now, ?CarbonInterface $next): ?string
    {
        if (!$next) {
            return null;
        }

        if ($next->lte($now->addMinute())) {
            return 'now';
        }

        return $next->diffForHumans($now, ['syntax' => CarbonInterface::DIFF_ABSOLUTE, 'parts' => 2])
            .' ('.$next->format('D j M, g:i A T').')';
    }

    /**
     * The team's weekly calling hours, in the team's timezone.
     *
     * @return list<array<string, mixed>>
     */
    private function businessHours(Profile $team): array
    {
        return collect($team->schedule)->map(fn (array $day) => [
            'day' => $day['label'],
            'closed' => !$day['is_available'],
            'windows' => $day['is_available']
                ? collect($day['times'])->map(fn ($time) => $time['start'] === 'allday'
                    ? ['start' => '00:00', 'end' => '24:00']
                    : ['start' => substr($time['start'], 0, 5), 'end' => substr($time['end'], 0, 5)])->values()->all()
                : [],
        ])->values()->all();
    }

    /**
     * The queued webhook pipeline reads lead fields either with an LLM
     * (`is_ai_extract`) or through the integration's own field map. In the
     * second case a map that doesn't name our keys would drop the submission
     * on the floor after we already told the agent the call was accepted — so
     * say so up front instead.
     */
    private function assertIntegrationCanReadOurFields(Integration $integration): void
    {
        if (!empty($integration->settings['is_ai_extract'])) {
            return;
        }

        $phoneField = $integration->settings['fields']['phone'] ?? null;

        abort_unless(
            is_string($phoneField) && in_array($phoneField, self::LEAD_FIELDS, true),
            409,
            'This Callingly integration maps its own lead fields. Point the snippet at a Webhook integration, or map its phone field to "phone".'
        );
    }
}

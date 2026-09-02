<?php

use App\Jobs\Integrations\Webhook;
use App\Models\Account;
use App\Models\Integration;
use App\Models\Profile;
use App\Models\User;
use App\Models\VoicemailSchedule;
use Illuminate\Support\Facades\Queue;

function createEmbedTestData(array $settings = [], array $integration = []): array
{
    $account = Account::factory()->create([
        'timezone' => 'America/New_York',
        'country_code' => 'US',
    ]);

    $team = Profile::factory()->create([
        'account_id' => $account->id,
        'name' => 'Sales',
        'timezone' => 'America/New_York',
    ]);

    $account->update(['primary_profile_id' => $team->id]);

    $user = User::factory()->create([
        'account_id' => $account->id,
        'timezone' => 'America/New_York',
    ]);

    $team->users()->attach($user->id);

    $integration = Integration::create(array_merge([
        'account_id' => $account->id,
        'profile_id' => $team->id,
        'platform' => 'webhook',
        'name' => 'Website',
        'webhook_slug' => 'testkey123',
        'settings' => array_merge(['is_ai_extract' => true], $settings),
    ], $integration));

    return compact('account', 'team', 'user', 'integration');
}

function embedCall(array $payload = [], array $headers = [])
{
    return test()->postJson('/embed/v1/testkey123/calls', array_merge([
        'fname' => 'Dana',
        'lname' => 'Reyes',
        'phone' => '(415) 555-0134',
        'email' => 'dana@example.com',
    ], $payload), $headers);
}

test('availability reports a team that can take a call right now', function () {
    createEmbedTestData();

    $response = $this->getJson('/embed/v1/testkey123/availability');

    $response->assertOk()
        ->assertJson([
            'team' => 'Sales',
            'timezone' => 'America/New_York',
            'available_now' => true,
            'within_business_hours' => true,
            'reps_available_now' => true,
            'accepting_call_requests' => true,
            'next_available_description' => 'now',
        ]);

    expect($response->json('business_hours'))->toHaveCount(7);
    expect($response->json('business_hours.0'))->toMatchArray([
        'day' => 'Sunday',
        'closed' => false,
    ]);
});

test('availability reports the next opening when the team is closed', function () {
    $data = createEmbedTestData();

    VoicemailSchedule::where('profile_id', $data['team']->id)->update([
        'start' => 'notavailable',
        'end' => 'notavailable',
    ]);

    $response = $this->getJson('/embed/v1/testkey123/availability');

    $response->assertOk()->assertJson([
        'available_now' => false,
        'within_business_hours' => false,
        'accepting_call_requests' => false,
        'next_available_at' => null,
    ]);
});

test('availability 404s on an unknown key', function () {
    createEmbedTestData();

    $this->getJson('/embed/v1/nope/availability')->assertNotFound();
});

test('a call request queues the webhook pipeline with a normalized number', function () {
    Queue::fake();

    createEmbedTestData();

    embedCall()->assertStatus(202)->assertJson([
        'accepted' => true,
        'team' => 'Sales',
        'phone_number' => '+14155550134',
        'dialing_now' => true,
    ]);

    Queue::assertPushed(Webhook::class, function (Webhook $job) {
        $input = (fn () => $this->input)->call($job);

        return (fn () => $this->api_key)->call($job) === 'testkey123'
            && $input['phone'] === '+14155550134'
            && $input['fname'] === 'Dana'
            && $input['lname'] === 'Reyes'
            && $input['requested_via'] === 'webmcp';
    });
});

test('the accepted-call message names the team in front of the word team', function () {
    Queue::fake();

    $data = createEmbedTestData();

    // The snippet relabels the team in this sentence with the page's own
    // data-team, and it does that by matching the name in front of "team".
    // Changing the wording so the name no longer sits there would silently stop
    // the relabelling — see tests/Browser/WebMcpSnippetTest.php.
    embedCall()->assertStatus(202)->assertJson([
        'team' => 'Sales',
        'message' => "We're ringing the Sales team now — expect a call within a minute or two.",
    ]);

    VoicemailSchedule::where('profile_id', $data['team']->id)->update([
        'start' => 'notavailable',
        'end' => 'notavailable',
    ]);

    embedCall()->assertStatus(202)
        ->assertJsonPath('dialing_now', false)
        ->assertJsonPath(
            'message',
            "The Sales team is outside its calling hours, so the request is queued and will be called when they're next available."
        );
});

test('a call request with an undialable number is rejected', function () {
    Queue::fake();

    createEmbedTestData();

    embedCall(['phone' => 'call me maybe'])->assertStatus(422)->assertJsonValidationErrors('phone');

    Queue::assertNotPushed(Webhook::class);
});

test('an origin allow-list blocks other sites', function () {
    Queue::fake();

    createEmbedTestData(['embed_origins' => ['https://customer.example']]);

    embedCall([], ['Origin' => 'https://attacker.example'])->assertForbidden();
    embedCall([], ['Origin' => 'https://customer.example'])->assertStatus(202);
});

test('an integration that maps its own fields is refused rather than dropping the lead', function () {
    Queue::fake();

    createEmbedTestData([
        'is_ai_extract' => false,
        'fields' => ['phone' => 'contact.mobile'],
    ]);

    embedCall()->assertStatus(409);

    Queue::assertNotPushed(Webhook::class);
});

test('embed responses carry wildcard CORS headers and answer preflight', function () {
    createEmbedTestData();

    $this->getJson('/embed/v1/testkey123/availability')
        ->assertHeader('Access-Control-Allow-Origin', '*');

    $this->call('OPTIONS', '/embed/v1/testkey123/calls')
        ->assertNoContent()
        ->assertHeader('Access-Control-Allow-Origin', '*')
        ->assertHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
});

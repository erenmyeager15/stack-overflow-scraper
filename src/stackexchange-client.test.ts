import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStackExchangeClient, StackExchangeApiError } from './stackexchange-client.js';

test('client adds common parameters and parses a successful wrapper', async () => {
    let requestedUrl = '';
    let requestHeaders: HeadersInit | undefined;
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        apiKey: 'secret-key',
        fetchImpl: fetchStub(async (url, init) => {
            requestedUrl = String(url);
            requestHeaders = init?.headers;
            return jsonResponse({ items: [{ question_id: 1 }], has_more: false, quota_max: 10000, quota_remaining: 9999 });
        }),
    });

    const page = await client.get('/questions?pagesize=1');
    const parsedUrl = new URL(requestedUrl);
    assert.equal(parsedUrl.searchParams.get('site'), 'stackoverflow');
    assert.equal(parsedUrl.searchParams.get('key'), 'secret-key');
    assert.equal(new Headers(requestHeaders).get('accept-encoding'), 'gzip, deflate');
    assert.equal(page.items.length, 1);
    assert.equal(page.quotaRemaining, 9999);
});

test('client honors a successful API backoff before returning', async () => {
    const sleeps: number[] = [];
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        fetchImpl: fetchStub(async () => jsonResponse({ items: [], has_more: false, backoff: 2, quota_max: 300, quota_remaining: 299 })),
    });
    const page = await client.get('/questions');
    assert.deepEqual(sleeps, [2000]);
    assert.equal(page.backoffSeconds, 2);
});

test('client retries throttle violations and succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        fetchImpl: fetchStub(async () => {
            calls += 1;
            return calls === 1
                ? jsonResponse({ error_id: 502, error_name: 'throttle_violation', error_message: 'too many requests' }, 400)
                : jsonResponse({ items: [], has_more: false, quota_max: 300, quota_remaining: 298 });
        }),
    });
    const page = await client.get('/questions');
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(page.quotaRemaining, 298);
});

test('client exposes bad parameters without retrying', async () => {
    let calls = 0;
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        fetchImpl: fetchStub(async () => {
            calls += 1;
            return jsonResponse({ error_id: 400, error_name: 'bad_parameter', error_message: 'sort' }, 400);
        }),
    });
    await assert.rejects(client.get('/search/advanced?sort=hot'), (error: unknown) => (
        error instanceof StackExchangeApiError && error.kind === 'invalid_request' && /sort/.test(error.message)
    ));
    assert.equal(calls, 1);
});

test('client reports rejected API keys clearly', async () => {
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        apiKey: 'bad-key',
        fetchImpl: fetchStub(async () => jsonResponse({ error_id: 400, error_name: 'bad_parameter', error_message: 'key' }, 400)),
    });
    await assert.rejects(client.get('/questions'), (error: unknown) => (
        error instanceof StackExchangeApiError && error.kind === 'authentication' && !error.message.includes('bad-key')
    ));
});

test('client fails on malformed success responses', async () => {
    const invalidJsonClient = createStackExchangeClient({
        site: 'stackoverflow',
        fetchImpl: fetchStub(async () => new Response('not-json', { status: 200 })),
    });
    await assert.rejects(invalidJsonClient.get('/questions'), (error: unknown) => (
        error instanceof StackExchangeApiError && error.kind === 'invalid_response'
    ));

    const missingItemsClient = createStackExchangeClient({
        site: 'stackoverflow',
        fetchImpl: fetchStub(async () => jsonResponse({ has_more: false, quota_remaining: 299 })),
    });
    await assert.rejects(missingItemsClient.get('/questions'), /did not contain an items array/);
});

test('client retries transient network errors with bounded delay', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        fetchImpl: fetchStub(async () => {
            calls += 1;
            if (calls === 1) throw new Error('socket closed');
            return jsonResponse({ items: [], has_more: false, quota_max: 300, quota_remaining: 299 });
        }),
    });
    await client.get('/questions');
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [500]);
});

test('client refuses an excessive API backoff instead of sleeping indefinitely', async () => {
    const client = createStackExchangeClient({
        site: 'stackoverflow',
        fetchImpl: fetchStub(async () => jsonResponse({ items: [], has_more: false, backoff: 31 })),
    });
    await assert.rejects(client.get('/questions'), (error: unknown) => (
        error instanceof StackExchangeApiError && error.kind === 'rate_limit'
    ));
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function fetchStub(
    implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch {
    return implementation as unknown as typeof fetch;
}

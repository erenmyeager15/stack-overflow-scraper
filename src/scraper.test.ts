import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeInput } from './input.js';
import { buildPath, scrapeStackExchange } from './scraper.js';
import type { StackExchangeApi, StackExchangePage } from './stackexchange-client.js';
import type { ChargeResult, StackExchangeRecord, StackExchangeRunStatus } from './types.js';

const FIXED_TIME = '2026-07-15T00:00:00.000Z';

test('scraper searches, paginates, deduplicates, and saves atomically', async () => {
    const harness = createHarness([
        page([question(1)], { hasMore: true }),
        page([question(1), question(2)]),
    ]);
    const input = normalizeInput({ searchQueries: ['async await'], tags: ['javascript'], maxResults: 2 });
    const result = await scrapeStackExchange(input, harness.dependencies);

    assert.equal(result.status.status, 'succeeded');
    assert.equal(result.status.questionsSaved, 2);
    assert.equal(result.status.duplicateQuestionsSkipped, 1);
    assert.equal(result.status.apiRequests, 2);
    assert.deepEqual(harness.events, ['question-scraped', 'question-scraped']);
    assert.match(harness.paths[0], /^\/search\/advanced\?/);
    assert.match(harness.paths[0], /q=async\+await/);
    assert.match(harness.paths[0], /tagged=javascript/);
});

test('scraper uses hot only on the tag-listing endpoint', async () => {
    const harness = createHarness([page([question(3)])]);
    const input = normalizeInput({ searchQueries: [], tags: ['javascript'], sort: 'hot', maxResults: 1 });
    const result = await scrapeStackExchange(input, harness.dependencies);
    assert.equal(result.status.tagListingCompleted, true);
    assert.match(harness.paths[0], /^\/questions\?/);
    assert.match(harness.paths[0], /sort=hot/);
});

test('scraper fetches exact questions and users with separate charge events', async () => {
    const harness = createHarness([
        page([question(42)]),
        page([user(22656)]),
    ]);
    const input = normalizeInput({ searchQueries: [], questionIds: ['42'], userIds: ['22656'], maxResults: 1 });
    const result = await scrapeStackExchange(input, harness.dependencies);
    assert.equal(result.status.questionsSaved, 1);
    assert.equal(result.status.usersSaved, 1);
    assert.deepEqual(harness.events, ['question-scraped', 'user-scraped']);
    assert.match(harness.paths[0], /^\/questions\/42\?/);
    assert.match(harness.paths[1], /^\/users\/22656\?/);
});

test('valid no-match responses finish as empty', async () => {
    const harness = createHarness([page([])]);
    const result = await scrapeStackExchange(
        normalizeInput({ searchQueries: ['unlikely-no-match'], maxResults: 1 }),
        harness.dependencies,
    );
    assert.equal(result.status.status, 'empty');
    assert.equal(result.status.recordsSaved, 0);
    assert.equal(harness.statuses.at(-1)?.status, 'empty');
});

test('spending-limit rejection stops without counting an unsaved row', async () => {
    const harness = createHarness([page([question(1), question(2)])], async () => ({
        chargedCount: 0,
        eventChargeLimitReached: true,
    }));
    const result = await scrapeStackExchange(
        normalizeInput({ searchQueries: ['x'], maxResults: 2 }),
        harness.dependencies,
    );
    assert.equal(result.status.status, 'stopped_spending_limit');
    assert.equal(result.status.recordsSaved, 0);
    assert.equal(harness.records.length, 1);
});

test('quota exhaustion preserves the final successful page and stops later requests', async () => {
    const harness = createHarness([page([question(1)], { quotaRemaining: 0, hasMore: true })]);
    const result = await scrapeStackExchange(
        normalizeInput({ searchQueries: ['x', 'y'], userIds: ['22656'], maxResults: 5 }),
        harness.dependencies,
    );
    assert.equal(result.status.status, 'stopped_quota');
    assert.equal(result.status.questionsSaved, 1);
    assert.equal(result.status.searchQueriesSkipped, 1);
    assert.equal(result.status.userIdsSkipped, 1);
    assert.equal(harness.paths.length, 1);
});

test('malformed API records fail visibly and publish failed diagnostics', async () => {
    const harness = createHarness([page([{ question_id: 1 }])]);
    await assert.rejects(
        scrapeStackExchange(normalizeInput({ searchQueries: ['x'] }), harness.dependencies),
        /invalid question record/,
    );
    assert.equal(harness.statuses.at(-1)?.status, 'failed');
    assert.match(harness.statuses.at(-1)?.failureMessage ?? '', /title is required/);
});

test('client failures are not converted into empty success', async () => {
    const statuses: StackExchangeRunStatus[] = [];
    const input = normalizeInput({ searchQueries: ['x'] });
    await assert.rejects(scrapeStackExchange(input, {
        client: { get: async () => { throw new Error('upstream unavailable'); } },
        pushData: async () => ({ chargedCount: 1, eventChargeLimitReached: false }),
        updateStatus: async (status) => { statuses.push(status); },
        log: silentLogger,
    }), /upstream unavailable/);
    assert.equal(statuses.at(-1)?.status, 'failed');
});

test('runtime guard stops before starting an API request', async () => {
    const harness = createHarness([]);
    const result = await scrapeStackExchange(
        normalizeInput({ searchQueries: ['x'], questionIds: ['42'], userIds: ['22656'] }),
        { ...harness.dependencies, runtimeLimitMs: 0 },
    );
    assert.equal(result.status.status, 'stopped_runtime_limit');
    assert.equal(result.status.apiRequests, 0);
    assert.equal(result.status.questionIdsSkipped, 1);
    assert.equal(result.status.userIdsSkipped, 1);
});

test('buildPath encodes query values without corrupting endpoint paths', () => {
    assert.equal(
        buildPath('/search/advanced', { q: 'c++ async', tagged: 'c++;language-lawyer' }),
        '/search/advanced?q=c%2B%2B+async&tagged=c%2B%2B%3Blanguage-lawyer',
    );
});

function createHarness(
    pages: StackExchangePage[],
    charge: (record: StackExchangeRecord, eventName: string) => Promise<ChargeResult> = async () => ({
        chargedCount: 1,
        eventChargeLimitReached: false,
    }),
): {
    dependencies: Parameters<typeof scrapeStackExchange>[1];
    paths: string[];
    records: StackExchangeRecord[];
    events: string[];
    statuses: StackExchangeRunStatus[];
} {
    const paths: string[] = [];
    const records: StackExchangeRecord[] = [];
    const events: string[] = [];
    const statuses: StackExchangeRunStatus[] = [];
    let pageIndex = 0;
    const client: StackExchangeApi = {
        get: async (path) => {
            paths.push(path);
            const result = pages[pageIndex];
            pageIndex += 1;
            if (!result) throw new Error(`No mock page available for ${path}.`);
            return result;
        },
    };
    return {
        dependencies: {
            client,
            pushData: async (record, eventName) => {
                records.push(record);
                events.push(eventName);
                return charge(record, eventName);
            },
            updateStatus: async (status) => { statuses.push(status); },
            log: silentLogger,
            isoNow: () => FIXED_TIME,
        },
        paths,
        records,
        events,
        statuses,
    };
}

function page(
    items: unknown[],
    overrides: Partial<StackExchangePage> = {},
): StackExchangePage {
    return {
        items,
        hasMore: false,
        quotaMax: 300,
        quotaRemaining: 299,
        backoffSeconds: 0,
        ...overrides,
    };
}

function question(id: number): Record<string, unknown> {
    return {
        question_id: id,
        title: `Question ${id}`,
        score: 1,
        answer_count: 2,
        view_count: 3,
        is_answered: true,
        tags: ['javascript'],
        creation_date: 1609459200,
        last_activity_date: 1609459300,
        link: `https://stackoverflow.com/questions/${id}/example`,
    };
}

function user(id: number): Record<string, unknown> {
    return {
        user_id: id,
        display_name: `User ${id}`,
        reputation: 100,
        badge_counts: { gold: 1, silver: 2, bronze: 3 },
        answer_count: 4,
        question_count: 5,
        creation_date: 1609459200,
        link: `https://stackoverflow.com/users/${id}/example`,
    };
}

const silentLogger = {
    info(): void {},
    warning(): void {},
};

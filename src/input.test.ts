import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeInput } from './input.js';

test('normalizeInput applies safe defaults and case-insensitive deduplication', () => {
    const input = normalizeInput({
        searchQueries: [' async   await ', 'ASYNC AWAIT'],
        tags: ['JavaScript', 'javascript'],
    });
    assert.deepEqual(input.searchQueries, ['async await']);
    assert.deepEqual(input.tags, ['javascript']);
    assert.equal(input.maxResults, 1);
    assert.equal(input.sort, 'votes');
    assert.equal(input.site, 'stackoverflow');
    assert.deepEqual(input.proxyConfiguration, { useApifyProxy: false });
});

test('normalizeInput accepts safe numeric IDs and normalizes the site', () => {
    const input = normalizeInput({
        searchQueries: [],
        questionIds: [11227809, '11227809', '42'],
        userIds: [22656, '22656'],
        site: ' StackOverflow ',
    });
    assert.deepEqual(input.questionIds, ['11227809', '42']);
    assert.deepEqual(input.userIds, ['22656']);
    assert.equal(input.site, 'stackoverflow');
});

test('normalizeInput rejects missing targets', () => {
    assert.throws(() => normalizeInput({ searchQueries: [], tags: [], questionIds: [], userIds: [] }), /Provide at least one/);
});

test('normalizeInput rejects malformed IDs', () => {
    assert.throws(() => normalizeInput({ searchQueries: [], questionIds: ['0'] }), /invalid ID/);
    assert.throws(() => normalizeInput({ searchQueries: [], userIds: ['abc'] }), /invalid ID/);
    assert.throws(() => normalizeInput({ searchQueries: [], questionIds: [Number.MAX_SAFE_INTEGER + 1] }), /invalid ID/);
});

test('normalizeInput rejects hot sort for keyword searches', () => {
    assert.throws(
        () => normalizeInput({ searchQueries: ['async await'], sort: 'hot' }),
        /hot sort is supported only for tag-only/,
    );
});

test('normalizeInput rejects relevance outside keyword-only question sources', () => {
    assert.throws(() => normalizeInput({ searchQueries: [], tags: ['javascript'], sort: 'relevance' }), /relevance sort/);
    assert.throws(
        () => normalizeInput({ searchQueries: ['async await'], questionIds: ['42'], sort: 'relevance' }),
        /relevance sort/,
    );
});

test('normalizeInput accepts endpoint-compatible hot and relevance sorts', () => {
    assert.equal(normalizeInput({ searchQueries: [], tags: ['javascript'], sort: 'hot' }).sort, 'hot');
    assert.equal(normalizeInput({ searchQueries: ['async await'], sort: 'relevance' }).sort, 'relevance');
});

test('normalizeInput enforces tag and scalar bounds', () => {
    assert.throws(
        () => normalizeInput({ searchQueries: [], tags: ['a', 'b', 'c', 'd', 'e', 'f'] }),
        /at most 5/,
    );
    assert.throws(() => normalizeInput({ searchQueries: ['x'], maxResults: 0 }), /maxResults/);
    assert.throws(() => normalizeInput({ searchQueries: ['x'], includeBody: 'yes' as unknown as boolean }), /includeBody/);
});

test('normalizeInput rejects invalid site and proxy shapes', () => {
    assert.throws(() => normalizeInput({ searchQueries: ['x'], site: 'https://stackoverflow.com' }), /site must be/);
    assert.throws(
        () => normalizeInput({ searchQueries: ['x'], proxyConfiguration: { proxyUrls: [123] as unknown as string[] } }),
        /proxyUrls/,
    );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapQuestion, mapUser, decodeEntities, validateStackExchangeRecord } from './routes.js';

test('decodeEntities decodes common and numeric HTML entities', () => {
    assert.equal(
        decodeEntities('Tom &amp; Jerry &quot;q&quot; &#39;x&#39; &lt;a&gt;'),
        'Tom & Jerry "q" \'x\' <a>',
    );
});

test('decodeEntities supports hexadecimal entities and normalizes whitespace', () => {
    assert.equal(decodeEntities('A&nbsp; B &#x26; C'), 'A B & C');
});

test('decodeEntities returns null for empty or non-string input', () => {
    assert.equal(decodeEntities(''), null);
    assert.equal(decodeEntities(123), null);
    assert.equal(decodeEntities(null), null);
});

test('mapQuestion converts unix seconds to ISO and decodes title/owner', () => {
    const q = mapQuestion({
        question_id: 42,
        title: 'What is &quot;this&quot;?',
        score: 10,
        answer_count: 2,
        view_count: 100,
        is_answered: true,
        tags: ['js', 'node'],
        owner: { display_name: 'A &amp; B', user_id: 7, reputation: 1234 },
        creation_date: 1609459200,
        link: 'https://stackoverflow.com/q/42',
        body: '<p>Hello <b>world</b></p>',
    }, 'stackoverflow', false);
    assert.equal(q.questionId, 42);
    assert.equal(q.entityType, 'question');
    assert.equal(q.title, 'What is "this"?');
    assert.equal(q.ownerName, 'A & B');
    assert.equal(q.createdAt, '2021-01-01T00:00:00.000Z');
    assert.deepEqual(q.tags, ['js', 'node']);
    assert.equal(q.body, null);
    assert.equal(q.site, 'stackoverflow');
});

test('mapQuestion strips HTML body only when includeBody is true', () => {
    const q = mapQuestion({ question_id: 1, body: '<p>Hello <b>world</b></p>' }, 'stackoverflow', true);
    assert.equal(q.body, 'Hello world');
});

test('mapQuestion defaults tags to [] and dates to null', () => {
    const q = mapQuestion({ question_id: 2 }, 'superuser', false);
    assert.deepEqual(q.tags, []);
    assert.equal(q.createdAt, null);
    assert.equal(q.title, null);
});

test('mapUser maps badge counts and decodes display name', () => {
    const u = mapUser({
        user_id: 9,
        display_name: 'Jon &amp; Co',
        reputation: 5000,
        badge_counts: { gold: 1, silver: 2, bronze: 3 },
        creation_date: 1609459200,
    }, 'stackoverflow');
    assert.equal(u.userId, 9);
    assert.equal(u.entityType, 'user');
    assert.equal(u.displayName, 'Jon & Co');
    assert.equal(u.badgeGold, 1);
    assert.equal(u.badgeBronze, 3);
    assert.equal(u.creationDate, '2021-01-01T00:00:00.000Z');
});

test('mappers keep only valid public URLs and string tags', () => {
    const q = mapQuestion({
        question_id: 1,
        title: 'Question',
        link: 'javascript:alert(1)',
        tags: ['javascript', 123, ' node '],
    }, 'stackoverflow', false, FIXED_TIME);
    assert.equal(q.link, null);
    assert.deepEqual(q.tags, ['javascript', 'node']);
});

test('record validation catches required identity and URL fields', () => {
    const invalidQuestion = mapQuestion({ question_id: 1 }, 'stackoverflow', false, FIXED_TIME);
    assert.deepEqual(validateStackExchangeRecord(invalidQuestion), [
        'title is required.',
        'link must be an HTTP(S) URL.',
    ]);
    const validUser = mapUser({
        user_id: 9,
        display_name: 'User',
        link: 'https://stackoverflow.com/users/9/user',
    }, 'stackoverflow', FIXED_TIME);
    assert.deepEqual(validateStackExchangeRecord(validUser), []);
});

const FIXED_TIME = '2026-07-15T00:00:00.000Z';

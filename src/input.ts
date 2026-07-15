import type { ActorInput, QuestionSort } from './types.js';

const MAX_SEARCH_QUERIES = 20;
const MAX_SEARCH_QUERY_LENGTH = 256;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 35;
const MAX_QUESTION_IDS = 10_000;
const MAX_USER_IDS = 1_000;
const MAX_RESULTS = 10_000;
const SITE_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const SORTS = new Set<QuestionSort>(['votes', 'activity', 'creation', 'hot', 'relevance']);

export interface NormalizedActorInput {
    searchQueries: string[];
    tags: string[];
    questionIds: string[];
    userIds: string[];
    sort: QuestionSort;
    includeBody: boolean;
    maxResults: number;
    site: string;
    apiKey: string;
    proxyConfiguration: NonNullable<ActorInput['proxyConfiguration']>;
}

export function normalizeInput(input: ActorInput): NormalizedActorInput {
    if (!isObject(input)) throw new Error('Input must be a JSON object.');

    const searchQueries = uniqueTextValues(
        stringArray(input.searchQueries, 'searchQueries', MAX_SEARCH_QUERIES),
        MAX_SEARCH_QUERY_LENGTH,
        'search query',
        false,
    );
    const tags = uniqueTextValues(
        stringArray(input.tags, 'tags', MAX_TAGS),
        MAX_TAG_LENGTH,
        'tag',
        true,
    );
    const questionIds = uniqueIds(input.questionIds, 'questionIds', MAX_QUESTION_IDS);
    const userIds = uniqueIds(input.userIds, 'userIds', MAX_USER_IDS);

    if (searchQueries.length === 0 && tags.length === 0 && questionIds.length === 0 && userIds.length === 0) {
        throw new Error('Provide at least one search query, tag, question ID, or user ID.');
    }

    const sort = input.sort ?? 'votes';
    if (typeof sort !== 'string' || !SORTS.has(sort as QuestionSort)) {
        throw new Error('sort must be votes, activity, creation, hot, or relevance.');
    }
    validateSortForSources(sort as QuestionSort, searchQueries, tags, questionIds);

    const rawSite = input.site ?? 'stackoverflow';
    if (typeof rawSite !== 'string') throw new Error('site must be a string.');
    const site = rawSite.trim().toLowerCase();
    if (!SITE_PATTERN.test(site)) {
        throw new Error('site must be a valid Stack Exchange API site parameter, such as stackoverflow or askubuntu.');
    }

    const rawApiKey = input.apiKey ?? '';
    if (typeof rawApiKey !== 'string') throw new Error('apiKey must be a string.');
    const apiKey = rawApiKey.trim();
    if (apiKey.length > 128) throw new Error('apiKey is unexpectedly long.');

    const proxyConfiguration = input.proxyConfiguration ?? { useApifyProxy: false };
    validateProxyConfiguration(proxyConfiguration);

    return {
        searchQueries,
        tags,
        questionIds,
        userIds,
        sort: sort as QuestionSort,
        includeBody: booleanValue(input.includeBody, false, 'includeBody'),
        maxResults: integerValue(input.maxResults, 1, 1, MAX_RESULTS, 'maxResults'),
        site,
        apiKey,
        proxyConfiguration,
    };
}

function validateSortForSources(
    sort: QuestionSort,
    searchQueries: string[],
    tags: string[],
    questionIds: string[],
): void {
    const hasQuestionSource = searchQueries.length > 0 || tags.length > 0 || questionIds.length > 0;
    if (!hasQuestionSource) return;

    if (sort === 'hot' && (searchQueries.length > 0 || questionIds.length > 0)) {
        throw new Error('hot sort is supported only for tag-only question listings. Use activity, creation, or votes for searches and question IDs.');
    }
    if (sort === 'relevance' && (searchQueries.length === 0 || questionIds.length > 0)) {
        throw new Error('relevance sort is supported only for keyword searches without exact question IDs.');
    }
}

function uniqueTextValues(
    values: string[],
    maximumLength: number,
    label: string,
    lowercase: boolean,
): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
        const compact = raw.replace(/\s+/g, ' ').trim();
        if (!compact) throw new Error(`${label}s cannot contain an empty value.`);
        if (compact.length > maximumLength) throw new Error(`Each ${label} must be at most ${maximumLength} characters.`);
        const value = lowercase ? compact.toLowerCase() : compact;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}

function uniqueIds(value: unknown, field: string, maximum: number): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${field} must be an array of positive integer IDs.`);
    if (value.length > maximum) throw new Error(`${field} supports at most ${maximum} entries per run.`);

    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        if (typeof raw !== 'string' && typeof raw !== 'number') {
            throw new Error(`${field} must contain only positive integer IDs.`);
        }
        const id = String(raw).trim();
        if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) {
            throw new Error(`${field} contains an invalid ID: ${JSON.stringify(raw)}.`);
        }
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

function stringArray(value: unknown, field: string, maximum: number): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
    if (value.length > maximum) throw new Error(`${field} supports at most ${maximum} entries per run.`);
    if (!value.every((item) => typeof item === 'string')) throw new Error(`${field} must contain only strings.`);
    return value as string[];
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || (resolved as number) < minimum || (resolved as number) > maximum) {
        throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
    }
    return resolved as number;
}

function booleanValue(value: unknown, fallback: boolean, field: string): boolean {
    const resolved = value ?? fallback;
    if (typeof resolved !== 'boolean') throw new Error(`${field} must be true or false.`);
    return resolved;
}

function validateProxyConfiguration(value: unknown): asserts value is NonNullable<ActorInput['proxyConfiguration']> {
    if (!isObject(value)) throw new Error('proxyConfiguration must be an object.');
    if (value.useApifyProxy !== undefined && typeof value.useApifyProxy !== 'boolean') {
        throw new Error('proxyConfiguration.useApifyProxy must be true or false.');
    }
    for (const field of ['apifyProxyGroups', 'proxyUrls'] as const) {
        const entries = value[field];
        if (entries !== undefined && (!Array.isArray(entries) || !entries.every((item) => typeof item === 'string'))) {
            throw new Error(`proxyConfiguration.${field} must be an array of strings.`);
        }
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

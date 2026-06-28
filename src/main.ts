import { Actor, log } from 'apify';
import { ProxyAgent } from 'undici';
import type { ActorInput } from './types.js';
import { mapQuestion, mapUser } from './routes.js';

await Actor.init();

const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;
const {
    searchQueries = [],
    tags = [],
    questionIds = [],
    userIds = [],
    sort = 'votes',
    includeBody = false,
    maxResults = 100,
    site = 'stackoverflow',
    apiKey = '',
    proxyConfiguration: proxyInput,
} = input;

const queries = [...new Set(searchQueries.map((s) => s.trim()).filter(Boolean))];
const tagList = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
const qIds = [...new Set(questionIds.map((s) => String(s).trim()).filter(Boolean))];
const uIds = [...new Set(userIds.map((s) => String(s).trim()).filter(Boolean))];
const siteParam = (site || 'stackoverflow').trim();
const filterBody = includeBody ? 'withbody' : 'default';

if (queries.length === 0 && tagList.length === 0 && qIds.length === 0 && uIds.length === 0) {
    log.error('No input. Provide searchQueries, tags, questionIds, or userIds.');
    await Actor.exit();
}

const proxyConfiguration = (proxyInput?.useApifyProxy || proxyInput?.proxyUrls?.length)
    ? await Actor.createProxyConfiguration(proxyInput)
    : undefined;

const BASE = 'https://api.stackexchange.com/2.3';
let questionCount = 0;
let userCount = 0;
let spendingLimitReached = false;
const seenQuestionIds = new Set<string>();

function withCommon(path: string): string {
    const sep = path.includes('?') ? '&' : '?';
    let url = `${BASE}${path}${sep}site=${encodeURIComponent(siteParam)}`;
    if (apiKey) url += `&key=${encodeURIComponent(apiKey.trim())}`;
    return url;
}

async function soFetch(path: string): Promise<any> {
    if (spendingLimitReached) return null;

    const url = withCommon(path);
    for (let attempt = 0; attempt < 5; attempt++) {
        if (spendingLimitReached) return null;

        let dispatcher: ProxyAgent | undefined;
        if (proxyConfiguration) {
            const purl = await proxyConfiguration.newUrl();
            if (purl) dispatcher = new ProxyAgent(purl);
        }
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'apify-stackoverflow-scraper', Accept: 'application/json' }, ...(dispatcher ? { dispatcher } : {}) } as any);
            const data = await res.json().catch(() => null);
            if (res.status === 429 || (data && data.error_id === 502)) {
                log.warning(`Throttled - attempt ${attempt + 1}`);
                if (!proxyConfiguration) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
                continue;
            }
            if (data?.backoff) {
                log.info(`API backoff ${data.backoff}s`);
                await new Promise((r) => setTimeout(r, (data.backoff + 1) * 1000));
            }
            if (!res.ok) {
                log.warning(`HTTP ${res.status} on ${path}: ${data?.error_message ?? ''}`);
                return null;
            }
            return data;
        } catch (e) {
            log.warning(`Request error on ${path}: ${(e as Error).message}`);
        }
    }
    return null;
}

async function pushQuestions(items: any[]): Promise<number> {
    let c = 0;
    for (const q of items) {
        if (spendingLimitReached || questionCount >= maxResults) break;

        const questionKey = String(q?.question_id ?? '');
        if (!questionKey || seenQuestionIds.has(questionKey)) continue;

        const chargeResult = await Actor.pushData(mapQuestion(q, siteParam, includeBody), 'question-scraped');
        const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
        if (recordWasSaved) {
            seenQuestionIds.add(questionKey);
            questionCount++;
            c++;
        }

        if (chargeResult.eventChargeLimitReached) {
            spendingLimitReached = true;
            const message = `Stopped at the user's spending limit after ${questionCount} question(s) and ${userCount} user(s).`;
            await Actor.setStatusMessage(message);
            log.warning(message);
            break;
        }
    }
    return c;
}

/** Paginate a questions/search endpoint up to maxResults. */
async function paginate(buildPath: (page: number) => string, label: string): Promise<void> {
    const pageSize = 100;
    let collected = 0;
    for (let page = 1; collected < maxResults && questionCount < maxResults; page++) {
        if (spendingLimitReached) break;

        const data = await soFetch(buildPath(page));
        const items: any[] = data?.items ?? [];
        if (items.length === 0) break;
        const slice = items.slice(0, maxResults - questionCount);
        collected += await pushQuestions(slice);
        log.info(`${label}: ${collected}/${maxResults} questions (page ${page})`);
        if (!data?.has_more || items.length < pageSize) break;
    }
}

// Search queries
for (const q of queries) {
    if (spendingLimitReached || questionCount >= maxResults) break;

    const tagParam = tagList.length ? `&tagged=${encodeURIComponent(tagList.join(';'))}` : '';
    await paginate((page) => `/search/advanced?q=${encodeURIComponent(q)}${tagParam}&order=desc&sort=${sort}&pagesize=100&page=${page}&filter=${filterBody}`, `search "${q}"`);
}

// Tags only (no query)
if (queries.length === 0 && tagList.length > 0) {
    await paginate((page) => `/questions?tagged=${encodeURIComponent(tagList.join(';'))}&order=desc&sort=${sort}&pagesize=100&page=${page}&filter=${filterBody}`, `tags ${tagList.join(',')}`);
}

// Specific question IDs (batched up to 100)
for (let i = 0; i < qIds.length;) {
    if (spendingLimitReached || questionCount >= maxResults) break;

    const batchSize = Math.min(100, maxResults - questionCount, qIds.length - i);
    const batch = qIds.slice(i, i + batchSize);
    i += batchSize;
    const data = await soFetch(`/questions/${batch.join(';')}?order=desc&sort=${sort}&pagesize=100&filter=${filterBody}`);
    if (data?.items) {
        await pushQuestions(data.items);
        log.info(`Fetched ${data.items.length} question(s) by ID`);
    }
}

// Users are stored in the default dataset so saving and PPE charging remain atomic.
if (uIds.length) {
    for (let i = 0; i < uIds.length; i += 100) {
        if (spendingLimitReached) break;

        const batch = uIds.slice(i, i + 100);
        const data = await soFetch(`/users/${batch.join(';')}?order=desc&sort=reputation&pagesize=100&filter=default`);
        for (const u of data?.items ?? []) {
            if (spendingLimitReached) break;

            const rec = mapUser(u, siteParam);
            const chargeResult = await Actor.pushData(rec, 'user-scraped');
            const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
            if (recordWasSaved) userCount++;

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                const message = `Stopped at the user's spending limit after ${questionCount} question(s) and ${userCount} user(s).`;
                await Actor.setStatusMessage(message);
                log.warning(message);
                break;
            }
        }
        log.info(`Fetched ${(data?.items ?? []).length} user(s)`);
    }
}

if (!spendingLimitReached) {
    await Actor.setStatusMessage(`Finished with ${questionCount} question(s) and ${userCount} user(s).`);
    log.info(`Stack Overflow scrape finished. ${questionCount} questions and ${userCount} users scraped.`);
}
await Actor.exit();

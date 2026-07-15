import type { NormalizedActorInput } from './input.js';
import type { StackExchangeApi, StackExchangePage } from './stackexchange-client.js';
import { mapQuestion, mapUser, validateStackExchangeRecord } from './routes.js';
import type { ChargeResult, StackExchangeRecord, StackExchangeRunStatus } from './types.js';

const QUESTION_EVENT = 'question-scraped';
const USER_EVENT = 'user-scraped';
const SAFE_RUNTIME_LIMIT_MS = 50 * 60 * 1_000;
const MAX_PAGES_PER_SOURCE = 25;

interface Logger {
    info(message: string, data?: Record<string, unknown>): void;
    warning(message: string, data?: Record<string, unknown>): void;
}

export interface ScrapeDependencies {
    client: StackExchangeApi;
    pushData: (record: StackExchangeRecord, eventName: string) => Promise<ChargeResult>;
    updateStatus: (status: StackExchangeRunStatus) => Promise<void>;
    log: Logger;
    now?: () => number;
    isoNow?: () => string;
    runtimeLimitMs?: number;
}

export interface StackExchangeScrapeResult {
    status: StackExchangeRunStatus;
    spendingLimitReached: boolean;
    quotaExhausted: boolean;
    runtimeLimitReached: boolean;
}

export async function scrapeStackExchange(
    input: NormalizedActorInput,
    dependencies: ScrapeDependencies,
): Promise<StackExchangeScrapeResult> {
    const now = dependencies.now ?? Date.now;
    const isoNow = dependencies.isoNow ?? (() => new Date().toISOString());
    const runtimeLimitMs = dependencies.runtimeLimitMs ?? SAFE_RUNTIME_LIMIT_MS;
    const startedAt = now();
    const counters = {
        recordsSaved: 0,
        questionsSaved: 0,
        usersSaved: 0,
        searchQueriesCompleted: 0,
        searchQueriesSkipped: 0,
        tagListingCompleted: false,
        questionIdsSkipped: 0,
        userIdsSkipped: 0,
        duplicateQuestionsSkipped: 0,
        duplicateUsersSkipped: 0,
        apiRequests: 0,
        apiBackoffSeconds: 0,
        quotaMax: null as number | null,
        quotaRemaining: null as number | null,
    };
    const seenQuestionIds = new Set<number>();
    const seenUserIds = new Set<number>();
    let spendingLimitReached = false;
    let quotaExhausted = false;
    let runtimeLimitReached = false;

    const buildStatus = (
        status: StackExchangeRunStatus['status'],
        failureMessage?: string,
    ): StackExchangeRunStatus => ({
        status,
        source: 'stack_exchange_api',
        ...counters,
        searchQueriesRequested: input.searchQueries.length,
        tagListingRequested: input.searchQueries.length === 0 && input.tags.length > 0,
        questionIdsRequested: input.questionIds.length,
        userIdsRequested: input.userIds.length,
        durationMs: Math.max(now() - startedAt, 0),
        ...(failureMessage ? { failureMessage } : {}),
    });
    const publishStatus = async (status: StackExchangeRunStatus['status'], failureMessage?: string) => {
        const document = buildStatus(status, failureMessage);
        await dependencies.updateStatus(document);
        return document;
    };
    const reachedRuntimeLimit = () => {
        if (now() - startedAt < runtimeLimitMs) return false;
        runtimeLimitReached = true;
        return true;
    };
    const shouldStop = () => spendingLimitReached || quotaExhausted || reachedRuntimeLimit();
    const shouldStopQuestions = () => counters.questionsSaved >= input.maxResults || shouldStop();

    const getPage = async (path: string): Promise<StackExchangePage> => {
        counters.apiRequests += 1;
        const page = await dependencies.client.get(path);
        counters.apiBackoffSeconds += page.backoffSeconds;
        if (page.quotaMax !== null) counters.quotaMax = page.quotaMax;
        if (page.quotaRemaining !== null) {
            counters.quotaRemaining = page.quotaRemaining;
            if (page.quotaRemaining === 0) quotaExhausted = true;
        }
        return page;
    };

    const pushQuestions = async (items: unknown[]): Promise<number> => {
        let saved = 0;
        for (const item of items) {
            if (counters.questionsSaved >= input.maxResults || spendingLimitReached || runtimeLimitReached) break;
            const record = mapQuestion(item, input.site, input.includeBody, isoNow());
            const errors = validateStackExchangeRecord(record);
            if (errors.length > 0) {
                throw new Error(`Stack Exchange returned an invalid question record: ${errors.join(' ')}`);
            }
            const questionId = record.questionId as number;
            if (seenQuestionIds.has(questionId)) {
                counters.duplicateQuestionsSkipped += 1;
                continue;
            }

            const chargeResult = await dependencies.pushData(record, QUESTION_EVENT);
            if (wasPushedRecordSaved(chargeResult)) {
                seenQuestionIds.add(questionId);
                counters.recordsSaved += 1;
                counters.questionsSaved += 1;
                saved += 1;
            }
            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                break;
            }
        }
        return saved;
    };

    const pushUsers = async (items: unknown[]): Promise<number> => {
        let saved = 0;
        for (const item of items) {
            if (spendingLimitReached || runtimeLimitReached) break;
            const record = mapUser(item, input.site, isoNow());
            const errors = validateStackExchangeRecord(record);
            if (errors.length > 0) {
                throw new Error(`Stack Exchange returned an invalid user record: ${errors.join(' ')}`);
            }
            const userId = record.userId as number;
            if (seenUserIds.has(userId)) {
                counters.duplicateUsersSkipped += 1;
                continue;
            }

            const chargeResult = await dependencies.pushData(record, USER_EVENT);
            if (wasPushedRecordSaved(chargeResult)) {
                seenUserIds.add(userId);
                counters.recordsSaved += 1;
                counters.usersSaved += 1;
                saved += 1;
            }
            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                break;
            }
        }
        return saved;
    };

    const paginateQuestions = async (
        endpoint: string,
        baseParams: Record<string, string>,
        label: string,
    ): Promise<void> => {
        let sourceSaved = 0;
        let page = 1;
        while (page <= MAX_PAGES_PER_SOURCE && !shouldStopQuestions()) {
            const pageSize = Math.min(100, input.maxResults - counters.questionsSaved);
            const path = buildPath(endpoint, {
                ...baseParams,
                page: String(page),
                pagesize: String(pageSize),
            });
            const result = await getPage(path);
            sourceSaved += await pushQuestions(result.items);
            dependencies.log.info(`${label}: saved ${sourceSaved} question(s) through page ${page}.`, {
                returned: result.items.length,
                hasMore: result.hasMore,
                quotaRemaining: result.quotaRemaining,
            });
            if (!result.hasMore || quotaExhausted || result.items.length === 0) break;
            page += 1;
        }
        if (page > MAX_PAGES_PER_SOURCE && !shouldStopQuestions()) {
            dependencies.log.warning(`${label} reached the ${MAX_PAGES_PER_SOURCE}-page safety limit.`);
        }
    };

    await dependencies.updateStatus(buildStatus('running'));

    try {
        for (const [index, query] of input.searchQueries.entries()) {
            if (shouldStopQuestions()) {
                counters.searchQueriesSkipped = input.searchQueries.length - index;
                break;
            }
            await paginateQuestions('/search/advanced', {
                q: query,
                ...(input.tags.length > 0 ? { tagged: input.tags.join(';') } : {}),
                order: 'desc',
                sort: input.sort,
                filter: input.includeBody ? 'withbody' : 'default',
            }, `search "${query}"`);
            counters.searchQueriesCompleted += 1;
        }

        if (input.searchQueries.length === 0 && input.tags.length > 0 && !shouldStopQuestions()) {
            await paginateQuestions('/questions', {
                tagged: input.tags.join(';'),
                order: 'desc',
                sort: input.sort,
                filter: input.includeBody ? 'withbody' : 'default',
            }, `tags ${input.tags.join(', ')}`);
            counters.tagListingCompleted = true;
        }

        let questionIndex = 0;
        while (questionIndex < input.questionIds.length && !shouldStopQuestions()) {
            const batchSize = Math.min(100, input.maxResults - counters.questionsSaved, input.questionIds.length - questionIndex);
            const batch = input.questionIds.slice(questionIndex, questionIndex + batchSize);
            questionIndex += batch.length;
            const result = await getPage(buildPath(`/questions/${batch.join(';')}`, {
                order: 'desc',
                sort: input.sort,
                pagesize: String(batch.length),
                filter: input.includeBody ? 'withbody' : 'default',
            }));
            await pushQuestions(result.items);
            dependencies.log.info(`Fetched ${result.items.length} question(s) for ${batch.length} exact ID(s).`, {
                quotaRemaining: result.quotaRemaining,
            });
        }
        counters.questionIdsSkipped = input.questionIds.length - questionIndex;

        let userIndex = 0;
        while (userIndex < input.userIds.length && !shouldStop()) {
            const batch = input.userIds.slice(userIndex, userIndex + 100);
            userIndex += batch.length;
            const result = await getPage(buildPath(`/users/${batch.join(';')}`, {
                order: 'desc',
                sort: 'reputation',
                pagesize: String(batch.length),
                filter: 'default',
            }));
            await pushUsers(result.items);
            dependencies.log.info(`Fetched ${result.items.length} user(s) for ${batch.length} exact ID(s).`, {
                quotaRemaining: result.quotaRemaining,
            });
        }
        counters.userIdsSkipped = input.userIds.length - userIndex;

        const outcome: StackExchangeRunStatus['status'] = spendingLimitReached
            ? 'stopped_spending_limit'
            : runtimeLimitReached
                ? 'stopped_runtime_limit'
                : quotaExhausted
                    ? 'stopped_quota'
                    : counters.recordsSaved === 0
                        ? 'empty'
                        : 'succeeded';
        const status = await publishStatus(outcome);
        return { status, spendingLimitReached, quotaExhausted, runtimeLimitReached };
    } catch (error) {
        await publishStatus('failed', safeErrorMessage(error));
        throw error;
    }
}

export function wasPushedRecordSaved(result: ChargeResult): boolean {
    return result.chargedCount > 0 || result.eventChargeLimitReached !== true;
}

export function buildPath(endpoint: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    return query ? `${endpoint}?${query}` : endpoint;
}

function safeErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/(https?:\/\/)[^/@\s]+(?::[^/@\s]*)?@/gi, '$1[redacted]@')
        .replace(/([?&](?:key|access_token)=)[^&\s]+/gi, '$1[redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

import { Actor, log } from 'apify';
import { normalizeInput, type NormalizedActorInput } from './input.js';
import { scrapeStackExchange } from './scraper.js';
import { createStackExchangeClient } from './stackexchange-client.js';
import type { ActorInput, StackExchangeRunStatus } from './types.js';

await Actor.main(async () => {
    const startedAt = Date.now();
    let input: NormalizedActorInput;
    try {
        input = normalizeInput((await Actor.getInput<ActorInput>()) ?? {});
    } catch (error) {
        await Actor.setValue('RUN_STATUS', failedInputStatus(startedAt, error));
        throw error;
    }

    try {
        const proxyConfiguration = input.proxyConfiguration.useApifyProxy || input.proxyConfiguration.proxyUrls?.length
            ? await Actor.createProxyConfiguration(input.proxyConfiguration as never)
            : undefined;

        if (!input.apiKey) {
            log.warning('No Stack Apps API key provided. The official unauthenticated quota is normally 300 requests per source IP per day.');
        }
        log.info('Starting official Stack Exchange API scrape.', {
            searchQueries: input.searchQueries.length,
            tags: input.tags.length,
            questionIds: input.questionIds.length,
            userIds: input.userIds.length,
            sort: input.sort,
            maxQuestions: input.maxResults,
            site: input.site,
            includeBody: input.includeBody,
            apiKeyProvided: Boolean(input.apiKey),
            proxyEnabled: Boolean(proxyConfiguration),
        });

        const client = createStackExchangeClient({
            site: input.site,
            apiKey: input.apiKey,
            proxyUrlProvider: proxyConfiguration
                ? async () => (await proxyConfiguration.newUrl()) ?? null
                : undefined,
        });

        const result = await scrapeStackExchange(input, {
            client,
            pushData: async (record, eventName) => Actor.pushData(record, eventName),
            updateStatus: async (status) => Actor.setValue('RUN_STATUS', status),
            log,
        });

        if (result.spendingLimitReached) {
            await Actor.setStatusMessage(`Stopped at the user's spending limit after ${result.status.recordsSaved} record(s).`);
        } else if (result.runtimeLimitReached) {
            await Actor.setStatusMessage(`Stopped at the safe runtime limit after ${result.status.recordsSaved} record(s).`);
        } else if (result.quotaExhausted) {
            await Actor.setStatusMessage(`Stack Exchange API quota exhausted after ${result.status.recordsSaved} record(s).`);
        } else if (result.status.recordsSaved === 0) {
            await Actor.setStatusMessage('No matching Stack Exchange questions or users were found.');
        } else {
            await Actor.setStatusMessage(`Finished with ${result.status.questionsSaved} question(s) and ${result.status.usersSaved} user(s).`);
        }

        log.info('Stack Exchange scrape finished.', {
            status: result.status.status,
            questionsSaved: result.status.questionsSaved,
            usersSaved: result.status.usersSaved,
            apiRequests: result.status.apiRequests,
            quotaRemaining: result.status.quotaRemaining,
            duplicateQuestionsSkipped: result.status.duplicateQuestionsSkipped,
        });
    } catch (error) {
        const current = await Actor.getValue<StackExchangeRunStatus>('RUN_STATUS');
        if (current?.status !== 'failed') {
            await Actor.setValue('RUN_STATUS', failedRunStatus(startedAt, current, error));
        }
        throw error;
    }
});

function failedInputStatus(startedAt: number, error: unknown): StackExchangeRunStatus {
    return {
        status: 'failed',
        source: 'stack_exchange_api',
        recordsSaved: 0,
        questionsSaved: 0,
        usersSaved: 0,
        searchQueriesRequested: 0,
        searchQueriesCompleted: 0,
        searchQueriesSkipped: 0,
        tagListingRequested: false,
        tagListingCompleted: false,
        questionIdsRequested: 0,
        questionIdsSkipped: 0,
        userIdsRequested: 0,
        userIdsSkipped: 0,
        duplicateQuestionsSkipped: 0,
        duplicateUsersSkipped: 0,
        apiRequests: 0,
        apiBackoffSeconds: 0,
        quotaMax: null,
        quotaRemaining: null,
        durationMs: Date.now() - startedAt,
        failureMessage: sanitizedErrorMessage(error),
    };
}

function failedRunStatus(
    startedAt: number,
    current: StackExchangeRunStatus | null,
    error: unknown,
): StackExchangeRunStatus {
    return {
        ...failedInputStatus(startedAt, error),
        ...(current ?? {}),
        status: 'failed',
        durationMs: Date.now() - startedAt,
        failureMessage: sanitizedErrorMessage(error),
    };
}

function sanitizedErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/(https?:\/\/)[^/@\s]+(?::[^/@\s]*)?@/gi, '$1[redacted]@')
        .replace(/([?&](?:key|access_token)=)[^&\s]+/gi, '$1[redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

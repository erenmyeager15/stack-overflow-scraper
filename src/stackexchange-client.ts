import { ProxyAgent } from 'undici';

const API_BASE = 'https://api.stackexchange.com/2.3';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_WAIT_MS = 30_000;

export interface StackExchangePage {
    items: unknown[];
    hasMore: boolean;
    quotaMax: number | null;
    quotaRemaining: number | null;
    backoffSeconds: number;
}

export interface StackExchangeApi {
    get(path: string): Promise<StackExchangePage>;
}

export type StackExchangeErrorKind =
    | 'authentication'
    | 'rate_limit'
    | 'invalid_request'
    | 'upstream'
    | 'timeout'
    | 'network'
    | 'invalid_response';

export class StackExchangeApiError extends Error {
    constructor(
        message: string,
        public readonly status: number | null,
        public readonly kind: StackExchangeErrorKind,
    ) {
        super(message);
        this.name = 'StackExchangeApiError';
    }
}

export interface StackExchangeClientOptions {
    site: string;
    apiKey?: string;
    proxyUrlProvider?: () => Promise<string | null>;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    timeoutMs?: number;
    maxAttempts?: number;
}

interface UndiciRequestInit extends RequestInit {
    dispatcher?: ProxyAgent;
}

interface ApiErrorDetails {
    id: number | null;
    name: string;
    message: string;
}

export function createStackExchangeClient(options: StackExchangeClientOptions): StackExchangeApi {
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 60_000, 'timeoutMs');
    const maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_ATTEMPTS, 1, 5, 'maxAttempts');
    const apiKey = options.apiKey?.trim() ?? '';

    return {
        async get(path: string): Promise<StackExchangePage> {
            if (!path.startsWith('/')) throw new Error('Stack Exchange API paths must start with /.');
            const url = new URL(`${API_BASE}${path}`);
            url.searchParams.set('site', options.site);
            if (apiKey) url.searchParams.set('key', apiKey);
            let lastError: StackExchangeApiError | null = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                let dispatcher: ProxyAgent | undefined;
                try {
                    const proxyUrl = await options.proxyUrlProvider?.();
                    if (proxyUrl) dispatcher = new ProxyAgent(proxyUrl);

                    const request: UndiciRequestInit = {
                        headers: {
                            'User-Agent': 'apify-stackoverflow-scraper',
                            Accept: 'application/json',
                            'Accept-Encoding': 'gzip, deflate',
                        },
                        redirect: 'follow',
                        signal: AbortSignal.timeout(timeoutMs),
                        ...(dispatcher ? { dispatcher } : {}),
                    };
                    const response = await fetchImpl(url, request);
                    const body = await response.text();
                    const parsed = parseJsonObject(body, path, response.status);
                    const apiError = parseApiError(parsed);

                    if (!response.ok || apiError) {
                        const error = classifyApiError(response.status, apiError, path);
                        const retryable = error.kind === 'rate_limit' || error.kind === 'upstream';
                        if (!retryable || attempt === maxAttempts) throw error;
                        lastError = error;
                        const waitMs = retryDelay(response.headers, attempt);
                        if (waitMs > MAX_WAIT_MS) throw error;
                        await sleep(waitMs);
                        continue;
                    }

                    const page = parsePage(parsed, path);
                    if (page.backoffSeconds > 0) {
                        const waitMs = page.backoffSeconds * 1_000;
                        if (waitMs > MAX_WAIT_MS) {
                            throw new StackExchangeApiError(
                                `Stack Exchange requested a ${page.backoffSeconds}-second backoff for ${path}; stop this run and retry later.`,
                                response.status,
                                'rate_limit',
                            );
                        }
                        await sleep(waitMs);
                    }
                    return page;
                } catch (error) {
                    if (error instanceof StackExchangeApiError) throw error;
                    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
                    const normalized = new StackExchangeApiError(
                        `${timedOut ? 'Stack Exchange request timed out' : 'Stack Exchange network request failed'} for ${path}: ${safeErrorMessage(error)}`,
                        null,
                        timedOut ? 'timeout' : 'network',
                    );
                    if (attempt === maxAttempts) throw normalized;
                    lastError = normalized;
                    await sleep(Math.min(500 * (2 ** (attempt - 1)), 4_000));
                } finally {
                    if (dispatcher) {
                        try {
                            await dispatcher.close();
                        } catch {
                            // Preserve the request result when proxy cleanup fails.
                        }
                    }
                }
            }

            throw lastError ?? new StackExchangeApiError(`Stack Exchange API request failed for ${path}.`, null, 'network');
        },
    };
}

function parseJsonObject(body: string, path: string, status: number): Record<string, unknown> {
    if (!body.trim()) {
        throw new StackExchangeApiError(`Stack Exchange returned an empty response for ${path}.`, status, 'invalid_response');
    }
    try {
        const parsed = JSON.parse(body) as unknown;
        if (!isObject(parsed)) throw new Error('not an object');
        return parsed;
    } catch {
        throw new StackExchangeApiError(`Stack Exchange returned invalid JSON for ${path}.`, status, 'invalid_response');
    }
}

function parseApiError(value: Record<string, unknown>): ApiErrorDetails | null {
    const id = finiteInteger(value.error_id);
    const name = cleanText(value.error_name);
    const message = cleanText(value.error_message);
    if (id === null && !name && !message) return null;
    return { id, name, message };
}

function classifyApiError(status: number, details: ApiErrorDetails | null, path: string): StackExchangeApiError {
    const id = details?.id ?? null;
    const name = details?.name ?? '';
    const detail = details?.message || name;
    const suffix = detail ? `: ${detail}` : '';

    if (status === 429 || id === 502 || name === 'throttle_violation') {
        return new StackExchangeApiError(`Stack Exchange API quota or throttle reached for ${path}${suffix}.`, status, 'rate_limit');
    }
    if (id === 503 || name === 'temporarily_unavailable' || id === 500 || name === 'internal_error' || status >= 500) {
        return new StackExchangeApiError(`Stack Exchange API is temporarily unavailable for ${path}${suffix}.`, status, 'upstream');
    }
    if (/(?:api )?key/i.test(detail)) {
        return new StackExchangeApiError('Stack Exchange rejected the API key. Remove it or provide a valid Stack Apps API key.', status, 'authentication');
    }
    return new StackExchangeApiError(`Stack Exchange rejected the request for ${path}${suffix}.`, status, 'invalid_request');
}

function parsePage(value: Record<string, unknown>, path: string): StackExchangePage {
    if (!Array.isArray(value.items)) {
        throw new StackExchangeApiError(`Stack Exchange response for ${path} did not contain an items array.`, 200, 'invalid_response');
    }
    const backoffSeconds = nonNegativeInteger(value.backoff) ?? 0;
    return {
        items: value.items,
        hasMore: value.has_more === true,
        quotaMax: nonNegativeInteger(value.quota_max),
        quotaRemaining: nonNegativeInteger(value.quota_remaining),
        backoffSeconds,
    };
}

function retryDelay(headers: Headers, attempt: number): number {
    const retryAfterHeader = headers.get('retry-after');
    const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1_000;
    return Math.min(1_000 * (2 ** (attempt - 1)), 8_000);
}

function nonNegativeInteger(value: unknown): number | null {
    return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}

function finiteInteger(value: unknown): number | null {
    return Number.isInteger(value) ? value as number : null;
}

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}

function safeErrorMessage(error: unknown): string {
    return cleanText(error instanceof Error ? error.message : String(error))
        .replace(/(https?:\/\/)[^/@\s]+(?::[^/@\s]*)?@/gi, '$1[redacted]@')
        .replace(/([?&](?:key|access_token)=)[^&\s]+/gi, '$1[redacted]');
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
    }
    return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

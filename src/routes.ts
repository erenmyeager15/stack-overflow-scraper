import type { QuestionRecord, StackExchangeRecord, UserRecord } from './types.js';

export function decodeEntities(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    const decoded = value
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(parseInt(decimal, 10)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
    return decoded || null;
}

export function mapQuestion(value: unknown, site: string, includeBody: boolean, scrapedAt = new Date().toISOString()): QuestionRecord {
    const question = asObject(value) ?? {};
    const owner = asObject(question.owner);
    return {
        entityType: 'question',
        questionId: numberValue(question.question_id),
        title: decodeEntities(question.title),
        score: numberValue(question.score),
        answerCount: numberValue(question.answer_count),
        viewCount: numberValue(question.view_count),
        isAnswered: question.is_answered === true,
        acceptedAnswerId: numberValue(question.accepted_answer_id),
        tags: stringValues(question.tags),
        ownerName: decodeEntities(owner?.display_name),
        ownerId: numberValue(owner?.user_id),
        ownerReputation: numberValue(owner?.reputation),
        createdAt: unixSecondsToIso(question.creation_date),
        lastActivityAt: unixSecondsToIso(question.last_activity_date),
        link: urlValue(question.link),
        body: includeBody ? stripHtml(question.body) : null,
        site,
        scrapedAt,
    };
}

export function mapUser(value: unknown, site: string, scrapedAt = new Date().toISOString()): UserRecord {
    const user = asObject(value) ?? {};
    const badges = asObject(user.badge_counts);
    return {
        entityType: 'user',
        userId: numberValue(user.user_id),
        displayName: decodeEntities(user.display_name),
        reputation: numberValue(user.reputation),
        location: decodeEntities(user.location),
        websiteUrl: urlValue(user.website_url),
        aboutMe: stripHtml(user.about_me),
        badgeGold: numberValue(badges?.gold),
        badgeSilver: numberValue(badges?.silver),
        badgeBronze: numberValue(badges?.bronze),
        answerCount: numberValue(user.answer_count),
        questionCount: numberValue(user.question_count),
        creationDate: unixSecondsToIso(user.creation_date),
        link: urlValue(user.link),
        site,
        scrapedAt,
    };
}

export function validateStackExchangeRecord(record: StackExchangeRecord): string[] {
    const errors: string[] = [];
    if (!validIso(record.scrapedAt)) errors.push('scrapedAt must be an ISO timestamp.');
    if (!record.site || record.site.length > 64) errors.push('site is missing or invalid.');

    if (record.entityType === 'question') {
        if (!positiveInteger(record.questionId)) errors.push('questionId must be a positive integer.');
        if (!record.title) errors.push('title is required.');
        if (!validUrl(record.link)) errors.push('link must be an HTTP(S) URL.');
        if (!nonNegativeOrNull(record.answerCount)) errors.push('answerCount must be non-negative.');
        if (!nonNegativeOrNull(record.viewCount)) errors.push('viewCount must be non-negative.');
        if (!nonNegativeOrNull(record.ownerReputation)) errors.push('ownerReputation must be non-negative.');
        if (!record.tags.every((tag) => typeof tag === 'string' && tag.length > 0)) errors.push('tags must contain non-empty strings.');
    } else {
        if (!positiveInteger(record.userId)) errors.push('userId must be a positive integer.');
        if (!record.displayName) errors.push('displayName is required.');
        if (!validUrl(record.link)) errors.push('link must be an HTTP(S) URL.');
        for (const [field, value] of [
            ['reputation', record.reputation],
            ['badgeGold', record.badgeGold],
            ['badgeSilver', record.badgeSilver],
            ['badgeBronze', record.badgeBronze],
            ['answerCount', record.answerCount],
            ['questionCount', record.questionCount],
        ] as const) {
            if (!nonNegativeOrNull(value)) errors.push(`${field} must be non-negative.`);
        }
    }
    return errors;
}

function stripHtml(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    const withoutMarkup = value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    return decodeEntities(withoutMarkup);
}

function stringValues(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unixSecondsToIso(value: unknown): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    const timestamp = new Date(value * 1_000);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function urlValue(value: unknown): string | null {
    return typeof value === 'string' && validUrl(value) ? value : null;
}

function validUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function validIso(value: string): boolean {
    return !Number.isNaN(Date.parse(value));
}

function positiveInteger(value: number | null): boolean {
    return Number.isInteger(value) && (value as number) > 0;
}

function nonNegativeOrNull(value: number | null): boolean {
    return value === null || (Number.isFinite(value) && value >= 0);
}

function safeCodePoint(value: number): string {
    try {
        return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    } catch {
        return '';
    }
}

function asObject(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

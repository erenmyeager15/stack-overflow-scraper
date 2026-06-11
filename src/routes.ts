import type { QuestionRecord, UserRecord } from './types.js';

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => (typeof v === 'number' && v > 0 ? new Date(v * 1000).toISOString() : null);

export function decodeEntities(s: unknown): string | null {
    if (typeof s !== 'string' || !s) return null;
    return s
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim() || null;
}

function stripHtml(s: unknown): string | null {
    if (typeof s !== 'string' || !s) return null;
    const out = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return decodeEntities(out);
}

export function mapQuestion(q: any, site: string, includeBody: boolean): QuestionRecord {
    return {
        questionId: n(q.question_id),
        title: decodeEntities(q.title),
        score: n(q.score),
        answerCount: n(q.answer_count),
        viewCount: n(q.view_count),
        isAnswered: !!q.is_answered,
        acceptedAnswerId: n(q.accepted_answer_id),
        tags: Array.isArray(q.tags) ? q.tags : [],
        ownerName: decodeEntities(q.owner?.display_name),
        ownerId: n(q.owner?.user_id),
        ownerReputation: n(q.owner?.reputation),
        createdAt: iso(q.creation_date),
        lastActivityAt: iso(q.last_activity_date),
        link: q.link ?? null,
        body: includeBody ? stripHtml(q.body) : null,
        site,
        scrapedAt: new Date().toISOString(),
    };
}

export function mapUser(u: any, site: string): UserRecord {
    return {
        userId: n(u.user_id),
        displayName: decodeEntities(u.display_name),
        reputation: n(u.reputation),
        location: decodeEntities(u.location),
        websiteUrl: u.website_url || null,
        aboutMe: stripHtml(u.about_me),
        badgeGold: n(u.badge_counts?.gold),
        badgeSilver: n(u.badge_counts?.silver),
        badgeBronze: n(u.badge_counts?.bronze),
        answerCount: n(u.answer_count),
        questionCount: n(u.question_count),
        creationDate: iso(u.creation_date),
        link: u.link ?? null,
        site,
        scrapedAt: new Date().toISOString(),
    };
}

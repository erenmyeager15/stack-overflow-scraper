export type QuestionSort = 'votes' | 'activity' | 'creation' | 'hot' | 'relevance';

export interface ActorInput {
    searchQueries?: string[];
    tags?: string[];
    questionIds?: Array<string | number>;
    userIds?: Array<string | number>;
    sort?: QuestionSort;
    includeBody?: boolean;
    maxResults?: number;
    site?: string;
    apiKey?: string;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        proxyUrls?: string[];
    };
}

export interface QuestionRecord {
    entityType: 'question';
    questionId: number | null;
    title: string | null;
    score: number | null;
    answerCount: number | null;
    viewCount: number | null;
    isAnswered: boolean;
    acceptedAnswerId: number | null;
    tags: string[];
    ownerName: string | null;
    ownerId: number | null;
    ownerReputation: number | null;
    createdAt: string | null;
    lastActivityAt: string | null;
    link: string | null;
    body: string | null;
    site: string;
    scrapedAt: string;
}

export interface UserRecord {
    entityType: 'user';
    userId: number | null;
    displayName: string | null;
    reputation: number | null;
    location: string | null;
    websiteUrl: string | null;
    aboutMe: string | null;
    badgeGold: number | null;
    badgeSilver: number | null;
    badgeBronze: number | null;
    answerCount: number | null;
    questionCount: number | null;
    creationDate: string | null;
    link: string | null;
    site: string;
    scrapedAt: string;
}

export type StackExchangeRecord = QuestionRecord | UserRecord;

export interface ChargeResult {
    chargedCount: number;
    eventChargeLimitReached: boolean;
}

export interface StackExchangeRunStatus {
    status: 'running' | 'succeeded' | 'empty' | 'stopped_spending_limit' | 'stopped_quota' | 'stopped_runtime_limit' | 'failed';
    source: 'stack_exchange_api';
    recordsSaved: number;
    questionsSaved: number;
    usersSaved: number;
    searchQueriesRequested: number;
    searchQueriesCompleted: number;
    searchQueriesSkipped: number;
    tagListingRequested: boolean;
    tagListingCompleted: boolean;
    questionIdsRequested: number;
    questionIdsSkipped: number;
    userIdsRequested: number;
    userIdsSkipped: number;
    duplicateQuestionsSkipped: number;
    duplicateUsersSkipped: number;
    apiRequests: number;
    apiBackoffSeconds: number;
    quotaMax: number | null;
    quotaRemaining: number | null;
    durationMs: number;
    failureMessage?: string;
}

export interface ActorInput {
    searchQueries?: string[];
    tags?: string[];
    questionIds?: string[];
    userIds?: string[];
    sort?: 'votes' | 'activity' | 'creation' | 'hot';
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

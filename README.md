# Stack Overflow Scraper - Questions & Public User Metadata

Scrape Stack Overflow and Stack Exchange question records through the official Stack Exchange API. The Actor can search questions by keyword, filter by tags, fetch exact question IDs, and optionally fetch public user profile metadata by user ID.

Use it for developer research, technical trend tracking, support knowledge-base discovery, and public Q&A analysis. No login is required. A Stack Apps API key is optional for higher quota.

## Quick Start

```json
{
  "searchQueries": ["async await"],
  "tags": ["javascript"],
  "questionIds": [],
  "userIds": [],
  "sort": "votes",
  "includeBody": false,
  "maxResults": 1,
  "site": "stackoverflow",
  "apiKey": "",
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

This collects one JavaScript `async await` question without full bodies or proxy usage.

## Input

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `searchQueries` | string array | `["async await"]` | Keyword searches for questions. |
| `tags` | string array | `[]` | Stack Exchange tags such as `javascript`, `python`, or `visual-studio-code`. |
| `questionIds` | string array | `[]` | Exact question IDs to fetch. |
| `userIds` | string array | `[]` | Exact public user IDs to fetch into the Users view. |
| `sort` | string | `votes` | `votes`, `activity`, or `creation`; `hot` is tag-only and `relevance` is search-only. |
| `includeBody` | boolean | `false` | Include plain-text question body when enabled. |
| `maxResults` | integer | `1` | Question cap across all question inputs; exact user IDs are separate. |
| `site` | string | `stackoverflow` | Any Stack Exchange API site, for example `superuser` or `askubuntu`. |
| `apiKey` | string | empty | Optional Stack Apps key for higher API quota. |
| `proxyConfiguration` | object | disabled | Usually not needed for small official API runs. |

## Output

The default dataset contains question rows and optional public user rows. Store views separate them into Questions and Users.

Question fields include:

| Field | Description |
| --- | --- |
| `questionId`, `title`, `link` | Stack Exchange question identity and URL. |
| `score`, `answerCount`, `viewCount`, `isAnswered` | Public engagement metrics. |
| `tags` | Question tags. |
| `ownerName`, `ownerId`, `ownerReputation` | Public owner metadata returned by the API. |
| `createdAt`, `lastActivityAt` | Question timestamps. |
| `body` | Plain-text question body when `includeBody` is enabled. |
| `site`, `scrapedAt` | Source site and scrape timestamp. |

User rows include public profile fields such as `displayName`, `reputation`, badge counts, optional `location`, optional `websiteUrl`, profile `link`, and `scrapedAt`.

Every row also contains `entityType` (`question` or `user`). The Output tab links to a
`RUN_STATUS` record with saved counts, source progress, duplicate counts, API backoff,
remaining quota, stop reason, and sanitized failure details.

## Verified Sample

An existing successful run returned this Stack Overflow question:

```json
{
  "questionId": 70201407,
  "title": "Making paragraphs for the outline in VS Code using comments",
  "score": 3,
  "answerCount": 4,
  "viewCount": 2574,
  "isAnswered": true,
  "tags": ["python", "visual-studio-code", "code-organization"],
  "ownerName": "Oily",
  "ownerReputation": 729,
  "createdAt": "2021-12-02T14:38:19.000Z",
  "lastActivityAt": "2026-06-22T06:54:16.000Z",
  "site": "stackoverflow"
}
```

## Pricing

Active pay-per-event pricing:

| Event | Price |
| --- | ---: |
| `question-scraped` | `$0.002` per question |
| `user-scraped` | `$0.002` per public user row |
| `apify-actor-start` | `$0.00005` per GB at run start |

Rows are saved and charged atomically. Duplicate questions are skipped, one global question cap is enforced, and later pages or batches stop when the user's spending limit is reached.

## Common Workflows

1. Track popular questions for a language, framework, or error pattern.
2. Build a public Q&A research dataset by tag and keyword.
3. Fetch exact question IDs for known Stack Overflow discussions.
4. Use `site` to collect from other Stack Exchange communities.
5. Export to CSV, Excel, JSON, HTML, or connect through the Apify API.

## Notes and Limits

- The Actor uses the official Stack Exchange API, so quotas and fields follow that API.
- Without a key, the official API normally reports a 300-request daily quota per source IP. A Stack Apps key can raise it to 10,000 requests.
- Official `backoff` instructions are honored before another request, and quota exhaustion is reported separately from an API failure.
- `hot` is valid only for tag-only `/questions` runs. Use `relevance` only for keyword searches without exact question IDs.
- `includeBody` increases response size. Keep it off unless body text is needed.
- Valid searches with no matches finish successfully as `empty`; invalid input and upstream/API failures fail visibly.
- Public user fields are optional and should be used for analysis, not spam or unsolicited outreach.

## Responsible Use

Use this Actor for lawful collection of public Stack Exchange data. Respect Stack Exchange terms, API rules, privacy laws, and any downstream restrictions for exported data.

## License

Apache-2.0

# Stack Overflow Scraper - Questions & Users

Scrape **Stack Overflow questions and users** via the official Stack Exchange API - no login required. Get titles, scores, answer/view counts, tags, question bodies, and user profiles (reputation, badges, location). Search by keyword, filter by tag, fetch by ID, and works across all Stack Exchange sites. Export to **JSON, CSV, Excel, or HTML**, or pull via the Apify API.

Perfect for **developer research, sentiment/trend analysis, tech support tooling, and recruiting**.

## Features

- ✅ **Official Stack Exchange API** - accurate, structured data
- ✅ **Questions and users** in one actor
- ✅ **Search, tag filter, or ID lookup**
- ✅ **Any Stack Exchange site** - Stack Overflow, Super User, Server Fault, Ask Ubuntu, etc.
- ✅ **Optional question bodies** and **user profiles** (nested in a separate dataset)
- ✅ **Optional API key** - 10,000 requests/day vs 300 without

## Input

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `searchQueries` | `string[]` | Keyword searches | `["async await"]` |
| `tags` | `string[]` | Tag filters (e.g. `"javascript"`) | `[]` |
| `questionIds` | `string[]` | Specific question IDs | `[]` |
| `userIds` | `string[]` | Specific user IDs (separate `users` dataset) | `[]` |
| `sort` | `string` | `votes`, `activity`, `creation`, `hot` | `votes` |
| `includeBody` | `boolean` | Include full question body | `false` |
| `maxResults` | `integer` | Max questions | `100` |
| `site` | `string` | Stack Exchange site | `stackoverflow` |
| `apiKey` | `string` (secret) | Optional Stack Apps key | — |
| `proxyConfiguration` | `object` | Proxy settings | Apify Proxy |

### Example input

```json
{
  "searchQueries": ["memory leak"],
  "tags": ["python"],
  "sort": "votes",
  "includeBody": true,
  "maxResults": 200
}
```

## Sample output

```json
{
  "questionId": 37576685,
  "title": "Using async/await with a forEach loop",
  "score": 3351,
  "answerCount": 35,
  "viewCount": 2476784,
  "isAnswered": true,
  "acceptedAnswerId": 37576787,
  "tags": ["javascript", "node.js", "promise", "async-await"],
  "ownerName": "Saad",
  "ownerReputation": 54989,
  "createdAt": "2016-06-01T18:55:58.000Z",
  "lastActivityAt": "2025-01-28T01:27:13.000Z",
  "link": "https://stackoverflow.com/questions/37576685/...",
  "site": "stackoverflow",
  "scrapedAt": "2026-06-11T10:00:00.000Z"
}
```

## Pricing

This Actor uses **pay-per-result** pricing:

| Event | Price |
|-------|-------|
| Per question scraped | **$0.002** ($2 / 1,000 questions) |
| Per user scraped | **$0.002** ($2 / 1,000 users) |

You are only charged for items actually returned. Apify platform usage is billed separately by Apify.

## Use cases

- **Developer research** - track popular questions, tags, and trends
- **Sentiment & topic analysis** - feed titles/bodies into NLP pipelines
- **Support tooling** - surface top Q&A for a technology
- **Recruiting** - find high-reputation users in a domain

## Tips

- Questions and users are kept in separate datasets so each stays clean.
- Add a free **Stack Apps API key** to lift the daily quota from 300 to 10,000 requests.
- Set `site` to scrape other Stack Exchange communities (e.g. `superuser`, `askubuntu`).

## License

Apache-2.0

# Limits that shape the design

Check the current numbers on each vendor's pricing and limits page before you rely on them; vendors change them.

| Limit | Value at the time of writing | What the hub does about it |
|---|---|---|
| Cloudflare Workers free plan: subrequests per invocation | 50 | one source per cron slot, so no single run makes more than about 20 calls |
| Workers free plan: CPU time per invocation | 10 ms CPU (network waits do not count) | parsing is linear, no heavy transforms in the worker |
| Workers free plan: cron triggers | 5 per account | exactly 5 slots: posthog, ga4, gsc, ads, report; another worker on the same free account with a cron will not fit |
| D1 free plan: rows written per day | 100,000 | delta writes: unchanged rows are skipped, so a daily re-pull of 3 days writes only what changed |
| D1 free plan: storage and reads | 500 MB per database, 5 million rows read per day | indexes on (source, day) and a 6 hour response cache keep dashboard reads low; long-format tables grow with pages times queries, so check the size in the Cloudflare dashboard after a month |
| PostHog query API | about 240 per minute, 3 concurrent, results default to 100 rows | explicit `LIMIT`, retries on 429 with `Retry-After` |
| Search Console API rows per request | 25,000 | the template asks for 5,000 per breakdown; larger sites raise it or page (see troubleshooting) |
| Search Console data | 16 months history, 2-3 day lag | the sync window ends 2 days back and the report labels the lag |
| GA4 Data API tokens | quota per property per day and hour | 8 small reports per run; raise windows only if the quota page shows room |
| Google Ads API | developer token access level decides which accounts you can read | read-only GAQL, one `searchStream` per query |

Sources for these numbers: Cloudflare Workers limits page, Cloudflare D1 pricing page, PostHog API docs (query endpoint), Google Search Console API docs (`searchAnalytics.query`), Google Analytics Data API quotas page, Google Ads API access levels page.

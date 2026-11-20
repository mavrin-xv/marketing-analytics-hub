# Data model

Full DDL with comments: `templates/worker/schema.sql`. Everything is long format: adding a metric or a breakdown is new rows, not a migration.

## Tables

| Table | Key | Holds |
|---|---|---|
| `daily_metrics` | day, source, host, metric | one number per day per source per host |
| `dim_daily` | day, source, host, dim, key, metric | breakdowns: channels, pages, queries, campaigns, referrers |
| `sync_log` | id | one row per pull: status, rows seen, rows written, message |
| `leads` | id | every webhook lead, with `delivered` and `test` flags |
| `kv` | key | response cache (`resp:` keys) and the last report |
| `annotations` | id | launches, outages, price changes, shown on the timeline |

`host` is the site hostname without `www.`, or `all` for Google Ads (an account has no host).

## Metrics by source

| Source | `daily_metrics.metric` |
|---|---|
| ga4 | `sessions`, `users`, `new_users`, `pageviews`, `engaged_sessions`, `key_events` |
| posthog | `pageviews`, `users`, `sessions`, and for each lead event `<event>` and `<event>_users` |
| gsc | `clicks`, `impressions`, `pos_x_impr` (position times impressions, so averages can be weighted) |
| ads | `spend`, `clicks`, `impressions`, `conversions`, `conv_value`, `search_is`, `lost_is_rank`, `lost_is_budget`, `eligible_impr` |

## Breakdowns by source

| Source | `dim_daily.dim` |
|---|---|
| ga4 | `channel`, `source_medium`, `landing`, `page`, `country`, `device`, `keyevent` |
| posthog | `page`, `lead_page`, `referrer`, `ai_ref`, `country` |
| gsc | `query`, `page`, `country`, `device` |
| ads | `campaign`, `bidding`, `term`, `conversion_action` |

## Reading the numbers right

- **Users summed over days are person-days.** GA4 and PostHog count distinct people per day. Seven days summed counts a person who came on three days three times. Use it for trends, not for "how many people".
- **Average position** for a period is `SUM(pos_x_impr) / SUM(impressions)`. A plain average of daily positions overweights quiet days.
- **Impression share** over a period is weighted by `eligible_impr`, the impressions the campaign could have had.
- **Ads zero days** are stored as explicit zero rows, so a paused day shows as 0 spend, not as a gap.
- **Rates** are people over people from one tool: `form_submitted_users / users` in PostHog.

## API

All endpoints except `/api/login`, `/api/health` and `/hook/lead` need the session cookie. Every response is `{ data, error }`.

| Endpoint | Params | Returns |
|---|---|---|
| `GET /api/overview` | `from`, `to`, `host` | sums per source for the window and the previous window of the same length; `prev` is null when not fully stored; a source is null when it has no data for the host |
| `GET /api/series` | `source`, `metric`, `from`, `to`, `host` | daily points |
| `GET /api/dim` | `source`, `dim`, `metric`, `from`, `to`, `host`, `limit` | top keys |
| `GET /api/status` | | configured sources, last 40 runs, the last report |
| `GET /api/report` | | `text` and `snapshot` for today's report |
| `POST /api/sync` | `source`, `from`, `to` | runs a sync or a backfill in 30-day slices |
| `POST /api/annotations` | JSON `{day, note, host}` | adds a note |
| `POST /hook/lead` | header `x-hook-secret` | `{id, delivered}` |

Default window: the 28 days ending yesterday. The longest window is 400 days.

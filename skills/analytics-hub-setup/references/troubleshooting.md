# Troubleshooting

Start from `/api/status`. Every run is in `sync_log` with status `ok`, `partial` (the API answered with zero rows), `error` (message stored) or `running`. A run stuck in `running` for 30 minutes is closed as `error` by the next run of that source.

## Numbers do not match the vendor UI

- **GA4 higher or lower by a few percent.** Normal: the UI applies thresholds and sampling in some reports, the API does not. Compare a single finished day, sessions only.
- **GA4 much lower.** `HOSTS` is missing a variant. The worker sends both `acme-coffee.com` and `www.acme-coffee.com`, but a separate shop subdomain must be listed on its own.
- **Search Console totals lower than the UI chart.** The UI total includes anonymised queries; rows broken down by query do not. The daily total (dimension `date` only) matches; the query table does not add up to it. That is by design at Google.
- **Ads spend off by a day.** The account time zone decides the day. The hub stores the day Google returns, so compare in the account's time zone.
- **PostHog pageviews far from GA4.** A spread of 0.6x to 1.5x is common (ad blockers, consent mode, bots). Outside that, something fires twice or is missing on some pages. `digest.py` flags it.

## Sync errors

| Message contains | Meaning | Fix |
|---|---|---|
| `403` from GA4 or Search Console | the service account has no access | add it as Viewer / user |
| `invalid_grant` | key revoked, or the machine clock is off (local dev) | create a new key |
| `DEVELOPER_TOKEN_NOT_APPROVED` | test token on a real account | apply for basic access |
| `USER_PERMISSION_DENIED` on Ads | manager account in between | set `ADS_LOGIN_CUSTOMER_ID` |
| `429` from PostHog | concurrent queries from somewhere else | the worker retries with backoff; move other jobs away from 06:00 |
| `too many subrequests` | a cron slot runs two sources, or the window is very large | keep one source per slot; backfill runs in 30-day slices |

## Data health rules the code follows

- An empty pull never deletes stored rows. It is logged as `partial`, and the old copy stays.
- After two failed runs in a row of one source, the hub sends one ops message to the report channels.
- A metric with no stored previous period shows no week-over-week change at all, instead of a fake +100%.
- A source with no rows for the selected host shows `n/a`, not 0.
- Undelivered leads are re-sent with the 08:00 report run for 3 days.

## Large sites

The template asks Search Console for up to 5,000 query rows and 5,000 page rows per request (the API allows 25,000). A site with more than that per sync window loses the long tail in the breakdowns. Raise `rowLimit` in `src/sources/gsc.js`, add `startRow` paging, or shorten the window. The daily totals come from a separate date-only request and are not affected.

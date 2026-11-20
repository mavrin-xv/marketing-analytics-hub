# Architecture

One Cloudflare Worker, one D1 database, five cron slots, one static dashboard. No server to keep alive and no paid plan for a small team.

```
 06:00 posthog ─┐
 06:30 ga4     ─┤   sync.js: pull window, fold duplicate keys,
 07:00 gsc     ─┼─► write only changed rows (delta) ──► D1: daily_metrics, dim_daily, sync_log
 07:30 ads     ─┘                                          │
                                                           ▼
 08:00 report ──► report.js: snapshot() ──► composeReport() ──► Telegram / Slack
                └► leads.js: replayUndelivered()

 browser ──► /            static dashboard (public/index.html)
         ──► /api/login   HMAC cookie, 30 days
         ──► /api/*       overview, series, dim, status, report, sync, annotations (reads D1 only)

 forms / CRM / PostHog ──► /hook/lead ──► store in D1 ──► Slack leads channel or Telegram
```

## Why one source per cron slot

A Worker invocation on the free plan can make 50 subrequests. GA4 alone uses 8 report calls plus the token exchange; PostHog uses about 6 HogQL queries; Search Console 5 per site. Running them all at once would hit the cap on a two-site setup. Separate slots also mean one broken source never blocks the others.

## Sync rules

- **Window.** Each source re-pulls a short trailing window every day (GA4 and PostHog the last 3 days, Search Console days 2 to 5 back because of its lag, Ads the last 3 days). Late data and GA4 reprocessing land on the next run.
- **Delta writes.** The worker reads the stored values for the window and writes only rows whose value changed. A quiet day writes almost nothing, which keeps D1 under its daily write cap.
- **Stale keys.** A breakdown key that disappeared from a fresh, non-empty pull is deleted for that window. An empty pull deletes nothing.
- **Status.** `ok`, `partial` (the API answered, zero rows), `error`. A run stuck in `running` for 30 minutes is closed. Two failures in a row send one ops alert.
- **Cache.** API responses are cached in the `kv` table for 6 hours under `resp:` keys and purged after every sync and every annotation.

## Why reads never call upstream APIs

The dashboard and the report read only D1. When Google or PostHog is down, the dashboard still shows the last good copy and the sync log says how old it is.

## Security

- The dashboard is behind a shared password and an HMAC-signed cookie. Static assets are served with `no-cache` so a logout or a new build takes effect at once.
- The lead webhook needs a shared secret, compared in constant time.
- Google keys are read-only scopes. The Ads integration only runs GAQL reads. Nothing in the hub writes to an ad account.
- Personal data from leads is stored in D1 and sent to the sales channel only. The report and the dashboard show lead counts, never contact details.

## Where to change things

| Change | File |
|---|---|
| Add a GA4 report or dimension | `templates/worker/src/sources/ga4.js` (`REPORTS`) |
| Add a PostHog query | `templates/worker/src/sources/posthog.js` |
| Change sync windows | `templates/worker/src/sync.js` (`WINDOWS`) |
| Change cron times | `wrangler.toml` crons and `SLOTS` in `src/index.js`, together |
| Change the report text | `templates/worker/src/report.js` (`composeReport`) |
| Add a lead field | `templates/worker/src/leads.js` (`normalizeLead`) |

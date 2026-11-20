---
name: analytics-hub-setup
description: Deploys the marketing hub (a Cloudflare Worker with a D1 database) that pulls GA4, Search Console, Google Ads and PostHog into one dashboard and a morning report, then backfills history and proves every source works. Use when the user says "set up the analytics hub", "connect GA4 / Search Console / Google Ads / PostHog", "one dashboard for site and ads", "deploy the marketing worker", "backfill", or when a source shows n/a or a sync error.
---

# Analytics hub setup

Get from zero to a deployed hub where every connected source has synced at least once, the history is backfilled, and the owner has seen one real morning report. Done means `check_config.py` exits 0 and `/api/status` shows `ok` for each source the owner wants.

## Inputs

Ask once, in one message, for whatever is missing:

| Need | Why |
|---|---|
| Site hostnames (`HOSTS`) | every source is filtered to them, so staging and other sites do not leak in |
| Which sources: GA4, Search Console, Google Ads, PostHog | unconfigured sources are skipped cleanly, so start with what exists |
| Report channel: Telegram, Slack or both | where the 08:00 report goes |
| Where sales wants lead alerts | `SLACK_LEADS_WEBHOOK_URL` or the same channel |
| Cloudflare account with Wrangler logged in | the free plan is enough for one small team (see `references/free-tier-limits.md`) |

Fill `templates/analytics-profile.md` with the answers if it does not exist yet. The other skills read it.

## Steps

1. **Copy the template.** `cp -r templates/worker my-hub && cd my-hub && cp wrangler.toml.example wrangler.toml`. Never edit the template in place.
2. **Create the database.** `npx wrangler d1 create marketing-hub`, paste the id into `wrangler.toml`, then `npm run db:init`.
3. **Set vars** in `[vars]`: `HOSTS`, `GA4_PROPERTY_ID`, `GSC_SITES`, `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `ADS_CUSTOMER_ID`, `REPORT_CHANNELS`, `LEAD_EVENTS`. Leave a source's vars empty to switch it off.
4. **Set secrets** one by one with `npx wrangler secret put NAME`. The list and where each value comes from is in `references/sources-setup.md`. Never paste a key into `wrangler.toml` or a chat log.
5. **Grant access.** The Google service account email must be added as a Viewer on the GA4 property and as a user on each Search Console property. This is the most common reason for a 403 on the first run.
6. **Check before deploy.** `python3 skills/analytics-hub-setup/scripts/check_config.py --toml my-hub/wrangler.toml --secrets my-hub/.dev.vars`. Fix every MISSING line. OFF is fine when the owner does not use that source.
7. **Test offline.** `npm test` runs the worker against a fake D1 and fake APIs. It must print `SMOKE OK`.
8. **Deploy.** `npx wrangler deploy`.
9. **Backfill.** Log in to the dashboard, then for each source call `POST /api/sync?source=ga4&from=2026-01-01` (the dashboard session cookie is required). It runs in 30-day slices. Search Console keeps 16 months; GA4 keeps what the property retention allows; PostHog depends on the plan.
10. **Verify.** `check_config.py --live <url>` must show 200 for health and 401 for status without a cookie. Then open `/api/status` logged in: every wanted source has an `ok` run with `rows_total > 0`. Open `/api/report` and read the text with the owner.
11. **Sanity check numbers** against each tool's own UI for one finished day: GA4 sessions within a few percent, Search Console clicks equal, Ads spend equal to the cent. A bigger gap means a host filter or time zone problem, see `references/troubleshooting.md`.

## Gates

- Do not deploy while `check_config.py` reports MISSING.
- Do not call setup done until one cron run per source has landed with status `ok`. A manual sync proves the keys; the cron proves the schedule.
- If a source returns `partial` (zero rows), say so. Zero rows from GA4 for a live site is a filter or access bug, never "no traffic".

## Output

A short status block for the owner:

```
Hub: https://marketing-hub.<account>.workers.dev
GA4        ok   backfilled 2026-01-01..2026-11-18, matches GA4 UI for 2026-11-17
Search     ok   lag 2-3 days, last day 2026-11-16
Ads        OFF  not used
PostHog    ok   staging hosts excluded: localhost, acme-coffee.webflow.io
Report     Telegram, first one sent 08:00 UTC
Leads      webhook live, test lead delivered to Slack
Not tested: nothing / <list>
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| GA4 403 | service account not added to the property | GA4 Admin > Property access management > add as Viewer |
| Search Console 403 | site URL mismatch | use exactly `sc-domain:example.com` or the URL prefix as listed |
| Ads `DEVELOPER_TOKEN_NOT_APPROVED` | test-level token | apply for basic access, or use a test account |
| PostHog 401 | project key used instead of a personal key | personal API key with `query:read` |
| Cron never runs | cron strings differ from `SLOTS` in `src/index.js` | `check_config.py` shows the mismatch |
| Numbers differ from GA4 UI | host filter missing `www.` or a different reporting time zone | see `references/troubleshooting.md` |

More: `references/sources-setup.md`, `references/free-tier-limits.md`, `references/troubleshooting.md`.

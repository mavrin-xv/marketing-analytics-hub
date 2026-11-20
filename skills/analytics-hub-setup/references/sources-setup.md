# Connecting each source

Every secret goes in with `npx wrangler secret put NAME`. For local runs, put the same names in `.dev.vars` (git-ignored).

## Google service account (GA4 and Search Console)

1. Google Cloud console: create a project, enable **Google Analytics Data API** and **Google Search Console API**.
2. IAM > Service accounts > create one, no roles needed at project level. Keys > Add key > JSON.
3. `npx wrangler secret put GOOGLE_SA_JSON < key.json`, then delete the local file.
4. GA4: Admin > Property access management > add the service account email as **Viewer**.
5. Search Console: Settings > Users and permissions > add the same email (Restricted is enough).
6. `GA4_PROPERTY_ID` is the numeric property id, not the `G-` measurement id.
7. `GSC_SITES` is a comma list, exactly as the property is named: `sc-domain:acme-coffee.com` for a domain property, `https://www.acme-coffee.com/` for a URL-prefix property.

The worker signs a JWT with the key (RS256 in WebCrypto) and trades it at `https://oauth2.googleapis.com/token` for an access token with the read-only scopes `analytics.readonly` and `webmasters.readonly`.

## Google Ads

Service accounts work only with a Workspace domain-wide setup, so the hub uses an OAuth refresh token instead.

1. Ads > Tools > API Center: get a **developer token**. Test access only reaches test accounts; apply for Basic access for real data.
2. Cloud console: create an OAuth client (type Desktop), note client id and secret.
3. Get a refresh token for a user who can see the account, with scope `https://www.googleapis.com/auth/adwords`. The Google Ads API docs describe the OAuth playground flow and the `generate_user_credentials` example script.
4. Secrets: `ADS_DEVELOPER_TOKEN`, `ADS_CLIENT_ID`, `ADS_CLIENT_SECRET`, `ADS_REFRESH_TOKEN`.
5. Vars: `ADS_CUSTOMER_ID` (10 digits, no dashes). If access is through a manager account, also `ADS_LOGIN_CUSTOMER_ID` (the manager id).
6. `ADS_API_VERSION` defaults to `v26`. Google retires old versions on a schedule; when the sync fails with `UNSUPPORTED_VERSION`, raise it.

The hub is read-only. It never changes bids, budgets or campaigns.

## PostHog

1. Personal settings > Personal API keys > create with scope `query:read` only, limited to the one project.
2. Secret `POSTHOG_API_KEY`. Vars `POSTHOG_HOST` (`https://us.posthog.com` or `https://eu.posthog.com`) and `POSTHOG_PROJECT_ID` (the number in the project URL).
3. `POSTHOG_EXCLUDE_HOSTS`: staging and preview hosts. PostHog's own "filter internal and test users" toggle does not apply to API queries, so the worker filters by hand.
4. `POSTHOG_INTERNAL_EMAIL_DOMAIN` (optional var): people whose `email` ends with it are dropped, so your own team does not count as leads.
5. `LEAD_EVENTS`: comma list of the custom events that mean intent, in order of importance. The first one gets a rate in the report.

Queries go to `POST /api/projects/{id}/query/` as HogQL. Every query carries an explicit `LIMIT`, since the default is 100 rows. The rate limit is about 240 queries a minute and 3 at a time, so one source per cron slot stays far below it.

## Report and alert channels

| Secret | Where |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather > /newbot |
| `TELEGRAM_CHAT_ID` | add the bot to the chat, send a message, read `getUpdates` |
| `SLACK_WEBHOOK_URL` | Slack app > Incoming Webhooks > channel for the report |
| `SLACK_LEADS_WEBHOOK_URL` | optional second webhook for the sales channel |
| `LEAD_HOOK_SECRET` | any random string; senders put it in the `x-hook-secret` header |
| `DASHBOARD_PASSWORD`, `SESSION_SECRET` | dashboard login; the session secret signs the cookie |

`REPORT_CHANNELS` (var) picks where the morning report goes: `telegram`, `slack` or `telegram,slack`. Ops alerts (two failed syncs in a row) follow the same channels.

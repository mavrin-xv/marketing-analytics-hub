---
name: marketing-report
description: Writes the daily or weekly marketing report for a small team from the hub's data, split into how many came (GA4), why they acted (PostHog), search (Search Console), ads (Google Ads) and leads, with checks that flag bad data before anyone reads a trend into it. Use when the user says "morning report", "marketing report", "how did the site do", "weekly numbers", "what happened with traffic yesterday", "send the report", or pastes a hub snapshot.
---

# Marketing report

One message a team can read in a minute and trust. It reports numbers with their source and period, compares like with like, and puts the reasons not to trust a number above the number.

## The split this report is built on

| Question | Source | Why this one |
|---|---|---|
| How many came, from which channel | GA4 | closest to what finance and ad platforms count; channel grouping is standard |
| What they did, why they converted | PostHog | person-level events, real funnels, the page where intent starts |
| How we show up in search | Search Console | the only source for queries, impressions and position; lags 2-3 days |
| What paid traffic cost | Google Ads | spend and impression share come only from here |
| Who wants to buy | lead webhook | the count sales actually received |

Never mix them in one ratio unless the step says so. "GA4 sessions / PostHog signups" divides two different ways of counting people.

## Inputs

- The hub snapshot: `GET /api/report` on the hub (logged in), field `snapshot`. Or a JSON file of the same shape, like `examples/acme-coffee/snapshot.json`.
- `templates/analytics-profile.md` (filled): goals, what counts as a lead, known tracking quirks, the audience for the report.
- Notes on the timeline: `POST /api/annotations` entries (launches, outages, price changes).

## Steps

1. **Get the data.** `python3 skills/marketing-report/scripts/digest.py --url <hub>` with `HUB_COOKIE` set, or `digest.py snapshot.json`. The script does the arithmetic; do not redo sums in your head.
2. **Read the flags first.** `digest.py --flags-only` exits 1 when any flag is `high`. A high flag goes to the top of the report with what to check. Do not explain a trend that a high flag may have caused.
3. **Periods.** Default: yesterday plus the last 7 full days against the 7 before. Search Console runs on its own window that ends 3 days back, and the report says so. For a weekly report use Monday to Sunday and say it.
4. **Rates.** People over people (PostHog `<event>_users` / `users`). Never events over sessions. Below 20 people in the numerator, show the count and skip the rate change.
5. **Changes.** Show week over week only when both weeks are fully stored. The script prints "(prev week incomplete)" otherwise; keep that text.
6. **One "so what".** At most three lines at the end: what changed, the likely reason with its evidence, and one next step with an owner. Use the `traffic-diagnosis` skill if a change needs explaining and the reason is not obvious from the notes.
7. **Send.** The worker sends its own report at 08:00 UTC. When a person asks for a report by hand, reply with it; send to a channel only when asked.

## Gates

- Every number has a source label and a period. "Traffic up 12%" fails. "GA4 sessions 7d: 2,874 (+6% wow)" passes.
- No metric is invented to fill a section. A source that is not connected prints "not connected or no data yet".
- A high flag is never dropped to make the report shorter.
- Unique users summed across days are person-days, not people. Label them as the script does or use the 7-day PostHog number.

## Output format

Plain text for chat, `--format md` for a doc, `--format slack` for Slack. The sample `examples/acme-coffee/morning-report.txt` shows every section, including the flags block. Sections, in order: HOW MANY (GA4), WHY (PostHog), SEARCH, ADS, LEADS, Notes, CHECK BEFORE YOU TRUST, dashboard link.

## Anomaly checks the script runs

See `references/anomaly-checks.md` for thresholds and the reasoning: last sync not ok, sessions per user above 3, a 40% weekly jump, PostHog vs GA4 pageview ratio outside 0.5x to 2x, staging referrers, Unassigned in the top channels, ad spend with zero conversions, impression share lost to budget or rank, too few people to read a rate, and the gap between PostHog lead events and leads that reached the webhook.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Every source "not connected" | the hub has not synced yet | run `analytics-hub-setup` step 9 |
| Huge +% on a metric | previous week partly missing | the script marks it; check `/api/status` coverage |
| Leads gap flag every day | the form fires the event before validation, or the webhook is not wired | `lead-alerts` skill, step 2 |
| Report too long for Telegram | many channels and notes | Telegram cuts at 4096 characters; the worker trims to 4000 |

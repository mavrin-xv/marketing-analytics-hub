# Analytics profile: <business name>

Fill this once. Every skill in the pack reads it before it answers. Keep it short and current; a wrong profile is worse than none.

## Business

- What we sell, to whom: <one line>
- The one outcome that pays the bills: <wholesale order / booked call / subscription / purchase>
- Typical monthly volume: <visitors, leads, orders, as the team knows them; write "unknown" if unknown>

## Sites and tools

| Site | GA4 property | Search Console property | PostHog project | Notes |
|---|---|---|---|---|
| <example.com> | <numeric id> | <sc-domain:example.com> | <project number> | <staging host, shop subdomain> |

- Google Ads account: <10 digits or "none">
- Report goes to: <Telegram chat / Slack channel>, read by: <who>
- Lead alerts go to: <channel>, answered by: <who>, target response time: <minutes>

## Decisions the numbers must support

1. <which channel brings the leads that buy>
2. <is the ad budget worth raising>
3. <which page loses people>

## What counts as a lead

- Primary lead event: `<form_submitted>`, fires on <server success / click>
- Secondary intent events: `<contact_clicked>`, `<pricing_viewed>`
- Not a lead: <newsletter signup, job applications, support requests>

## Tracking plan

| Event | Fires when | Properties | Answers | QA |
|---|---|---|---|---|
| | | | | |

## Known tracking quirks

Write every oddity here with its date, so nobody "discovers" it twice.

- <2026-11-12: consent banner changed, GA4 sessions -18% from this day, PostHog unchanged>
- <staging host acme-coffee.webflow.io excluded from PostHog since 2026-11-19>

## Recent changes

| Date | Change | Owner | Expected effect | Check on |
|---|---|---|---|---|
| | | | | |

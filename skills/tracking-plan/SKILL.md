---
name: tracking-plan
description: Writes and audits the tracking plan behind the hub, so the numbers mean something. Covers event names (object_action), which events count as leads, UTM rules for every link you pay for or send, Google Ads conversion actions, and a QA pass in PostHog and GA4 before a change ships. Includes a linter for links and event names. Use when the user says "tracking plan", "what events should we track", "UTM", "Unassigned traffic", "set up conversions", "check our tagging", "our numbers don't match", or before launching a campaign or a new form.
---

# Tracking plan

A short, written list of what the site measures and how, plus a check that the live site matches it. Most bad reports come from a tracking gap, so this skill runs before campaigns, before new forms, and whenever `marketing-report` flags a measurement problem.

## Inputs

- `templates/analytics-profile.md`: the business goal and what a lead is. If it is empty, fill the goals block with the owner first.
- The site's forms, buttons that start a conversation (call, chat, messenger), checkout, and signup.
- The current PostHog event list and GA4 key events (export, screenshot or API).
- Links in use: ads final URLs, newsletter links, social bios, partner listings. A CSV with a `url` column works.

## Steps

1. **Measurement breakage first.** Before adding anything, check that what exists works: the PostHog snippet and GA4 tag are on every template (compare page counts in both tools), each lead event fires once per real submit, and test traffic is excluded. Fix breakage before designing new events.
2. **List the decisions.** Write the 3 to 5 questions the team needs answered ("which channel brings wholesale leads", "where people drop in checkout"). Every event in the plan must serve one of them. Events nobody reads are cost without value.
3. **Name events.** `object_action`, snake_case, present tense: `form_submitted`, `contact_clicked`, `plan_selected`. Properties carry the detail (`form: wholesale`), not the name. Check with `python3 skills/tracking-plan/scripts/utm.py events <names>`. Rules and a starter plan: `references/event-naming.md`.
4. **Pick lead events.** One primary lead event, fired on the server-side success response, never on click. Secondary intent events (contact clicked, pricing viewed) are listed after it in `LEAD_EVENTS`. The webhook in `lead-alerts` receives the same submit.
5. **UTM rules.** Lowercase, no spaces, `utm_source` is the site that sends the click, `utm_medium` from GA4's default channel list, `utm_campaign` is `yyyy-mm-name`. Build links with `utm.py build` and lint every list with `utm.py lint --csv`. Never tag internal links. Let Google Ads auto-tagging (gclid) handle ad URLs. Details: `references/utm-rules.md`.
6. **Ads conversions.** In Google Ads, one primary conversion action per real business outcome. Secondary actions are observation only. Audit list: `references/ads-conversion-audit.md`.
7. **QA before shipping.** Submit the form once as a test (name starting with `TEST`), then confirm: one event in PostHog live events with the right properties, one key event in GA4 DebugView, one Ads conversion (after a delay, for an ad click), one alert from the lead webhook. Write the date and result in the plan.
8. **Write it down.** The plan lives in the profile file under "Tracking plan": event, trigger, properties, which question it serves, owner, last QA date.

## Gates

- No new event without a question it answers.
- No lead event that fires on click instead of on success.
- `utm.py lint` exits 0 on every link list before a campaign goes live.
- Every change ends with step 7, done on the live site, with the date recorded.

## Output

The tracking plan block, for example:

```
| Event | Fires when | Properties | Answers | QA |
|---|---|---|---|---|
| form_submitted | server confirms the wholesale form | form, plan | which channel brings wholesale leads | 2026-11-19 ok |
| contact_clicked | phone or chat link clicked | method | do people prefer calling | 2026-11-19 ok |
| plan_selected | a subscription plan is chosen | plan, price_band | which plan sells | not yet |
```

Plus the lint result on the team's link list, like `examples/acme-coffee/links-lint.txt`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| "Unassigned" grows in GA4 | untagged email or social links, custom mediums, AI referrals | step 5, lint the links; add a custom channel group for AI assistants if needed |
| Same source three times (fb, facebook, Facebook) | no shared convention | `utm.py build` normalises aliases |
| Leads in PostHog higher than in the CRM | event on click, double fire, test submits | step 4 and step 7 |
| Ads shows conversions nobody received | a page view counted as conversion | `references/ads-conversion-audit.md` |
| Event names drift (Contact Click, contact_click, clickContact) | no linter in the release routine | `utm.py events` before merging tracking changes |

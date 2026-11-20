# Anomaly checks

The thresholds are starting points for a small site, not laws. Change them in `scripts/digest.py` (function `flags`) and write the reason in `templates/analytics-profile.md` under "Known tracking quirks".

| Check | Severity | Threshold | Why |
|---|---|---|---|
| Last sync not ok | high | any status other than `ok` | the numbers may be a day or more old |
| GA4 sessions per user | high | above 3 in a week | real people rarely come back 3 times a week to a small marketing site; uptime monitors and scrapers do |
| GA4 sessions week over week | high | 40% or more up or down | moves this large are usually tracking (tag removed, consent banner changed, bot burst) before they are marketing |
| PostHog vs GA4 pageviews | high | ratio below 0.5 or above 2 | both tools see the same pages; the usual spread from ad blockers and consent is narrower |
| Staging or preview referrer | medium | host contains staging, preview, webflow.io, vercel.app, netlify.app, pages.dev, localhost | test traffic inflates people counts and fires test conversions |
| Unassigned in top channels | medium | in the top 4 | untagged email or social links, or AI assistants GA4 does not classify |
| Ad spend, zero conversions | high | any spend in 7 days and 0 conversions | either the campaign fails or the conversion action is broken; check the action first |
| Impression share lost to budget | medium | 15% or more | more budget buys more of the same auctions; a decision for the owner |
| Impression share lost to rank | medium | 30% or more | bids or ad quality; adding budget will not fix it |
| Small numbers | info | under 20 people for a lead event | a change from 6 to 9 is noise; use `traffic-diagnosis/scripts/compare.py` |
| Lead events vs webhook | high | 5+ people fired the first lead event, webhook got under half of that | leads may be lost between the form and sales |

## Why "people over people"

A rate is only stable when the numerator and the denominator count the same thing. PostHog's `<event>_users` counts distinct people who fired the event on a day; `users` counts distinct people who viewed a page. Sessions over events, or GA4 users over PostHog events, mix tools and units, and a change in either side's counting looks like a change in conversion.

## Why the report never prints a change against missing data

When the hub was set up five days ago, last week is mostly empty. A naive delta prints +400%. The report reader acts on the biggest number. So the hub drops the delta whenever either week has fewer than 7 stored days, and the dashboard drops it when the previous window starts before the first stored day.

# Hypothesis library

Start with these, by the metric that moved. Each row says what you would see if the cause is real.

## Sessions or users moved

| Cause | Confirm with | You would see |
|---|---|---|
| Tag removed or broken on some pages | GA4 landing pages vs PostHog pages | pages missing in one tool from a given date |
| Consent banner change | GA4 vs PostHog trend | GA4 drops, PostHog (cookieless or first-party) holds |
| Bot or monitor | sessions per user, country, device, hour | one country or device, flat hourly pattern, near-zero engagement |
| Search ranking change | Search Console clicks by query and page | specific queries lose clicks, impressions hold or fall |
| Search demand change | Search Console impressions for the top queries | impressions fall across many queries together, position holds |
| Paid budget or bid change | Ads spend, impression share lost to budget | spend down, Paid Search sessions down by a similar share |
| Email or social send | GA4 source/medium, annotations | one source spikes on the send date |
| AI assistant referrals | PostHog `ai_ref`, GA4 Referral | chatgpt.com or perplexity.ai rising, often filed as Referral or Unassigned in GA4 |
| Seasonality | same weeks last year | the same shape a year earlier |

## Leads or conversions moved

| Cause | Confirm with | You would see |
|---|---|---|
| Form or event broken | PostHog lead events vs webhook leads vs GA4 key events | one of the three drops to zero or diverges |
| Traffic mix shift | conversion rate by channel | overall rate drops, per-channel rates hold, low-intent channel grew |
| Landing page change | lead pages before and after | rate drops on the changed page only |
| Price or offer change | annotations, lead pages | rate change across all channels on one date |
| Spam or test leads | lead names, contacts, `test` flag | bursts from one source, nonsense messages |
| Ads conversion action change | Ads conversions by action | a new or removed action on the date of the move |

## Confidence

| Level | Requires |
|---|---|
| High | measurement checked and fine; the cause shows in the right breakdown and not in a control; the sample passes `compare.py` |
| Medium | measurement fine; the cause shows in the breakdown; no clean control, or the sample is borderline |
| Low | a plausible story, a date match, or a sample below what `compare.py` asks for |

## Sample size, in plain numbers

`compare.py` computes it, but the rule of thumb: to see a conversion rate move from 1% to 1.5% with ordinary confidence, you need a few thousand people on each side. Sites with a few hundred visitors a week should judge page changes over a month, or test bigger changes.

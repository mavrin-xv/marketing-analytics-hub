# Google Ads conversion audit

Run it before trusting cost per lead, and before letting smart bidding optimise for a conversion. Read-only: write down changes as proposals and let the account owner apply them.

## Checklist

1. **List actions.** Goals > Conversions > Summary. Write each action: name, source (website tag, GA4 import, offline), primary or secondary, counting (one or every), window.
2. **One primary per outcome.** Primary actions feed bidding. A page view, scroll or "contact page viewed" set as primary makes the bidder buy cheap clicks that never become leads. Make those secondary.
3. **Counting.** Leads: "one" per click. Purchases: "every".
4. **No double counting.** The same submit imported from GA4 and fired by the Ads tag counts twice. Keep one.
5. **Status.** Every primary action is "Recording conversions" or "Active". "No recent conversions" for a week on a live form means the tag broke.
6. **Compare with what sales received.** Ads conversions for 7 days against webhook leads from paid traffic (`utm_medium=cpc` or a gclid) for the same days. A ratio above 1.5 means Ads counts something that is not a lead.
7. **Enhanced conversions.** Optional, but it recovers conversions lost to cookie limits. Needs consent and hashed contact data; treat it as a privacy decision.

## Proposal format

```
Change: make "Contact page view" secondary
Why: 41 conversions in 7 days, 0 of them reached sales (webhook, utm_medium=cpc)
Risk: bidding learns again for about a week; conversion count in Ads will drop
Owner decision: yes / no
```

Write actions (bids, budgets, conversion settings) always go through the owner. This follows the propose-then-confirm pattern used by the Google Ads MCP server projects.

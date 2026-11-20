---
name: traffic-diagnosis
description: Finds out why traffic, leads or conversions moved, by ruling out broken measurement first, then testing a short list of hypotheses against GA4, PostHog, Search Console and Google Ads data, and ending with a verdict and a confidence level. Also reads A/B and before/after results honestly for small samples. Use when the user asks "why did traffic drop", "why are leads down", "conversions doubled, is it real", "did the new page work", "is this A/B test significant", or a report flag needs explaining.
---

# Traffic diagnosis

Answer "why did this number move" with evidence, in the order that finds the cause fastest. Most sudden moves on small sites are measurement, so that is checked first.

## Inputs

- The metric, the two periods, and the size of the move (from the report or the user).
- Hub API access: `/api/series`, `/api/dim`, `/api/overview` (see `docs/data-model.md`), or exports from the tools.
- `templates/analytics-profile.md`: goals, known tracking quirks, recent changes.
- The annotations timeline (launches, outages, price or budget changes).

## Steps

1. **Frame.** Write the move in one line with numbers: "PostHog form_submitted people, 12-18 Nov vs 5-11 Nov: 17 vs 14". If it is under 20 people on either side, run `scripts/compare.py` first. A LIKELY NOISE verdict ends the diagnosis here, and the answer is "not a real change yet; here is the sample you need".
2. **Measurement first.** Check, in order, and stop when one explains the move:
   - sync status for the period (`/api/status`): missing or partial days;
   - the same metric in a second tool (GA4 vs PostHog pageviews, Ads clicks vs GA4 Paid Search sessions);
   - a tag, consent banner, or form change on the date the line breaks (annotations, deploy log);
   - bots: sessions per user, one country or device spiking, one referrer spiking;
   - staging or internal traffic in referrers or hosts.
3. **Hypotheses.** Write 3 to 5 candidate causes before you look further, each with the data that would confirm or kill it. Use `references/hypothesis-library.md` for the usual ones by metric.
4. **Triangulate.** For each hypothesis, pull the breakdown that tests it: channel, landing page, query, campaign, device, country, lead page. A cause must show up in the breakdown where it should and be absent where it should not. Example: a ranking loss shows in Search Console clicks for specific queries and in GA4 Organic Search, and not in Direct.
5. **Verdict.** For each hypothesis: confirmed, ruled out, or open, with the numbers. Assign the overall confidence with the table in `references/hypothesis-library.md`.
6. **Next step.** One action with an owner. If confidence is low, the next step is the measurement that would raise it, not a fix.

## Gates

- Measurement is checked before any marketing explanation is offered.
- Every claim cites a number from a named source and period.
- A change under the sample size `compare.py` reports is never called a win or a loss.
- Correlation with a launch date is "consistent with", not "caused by", unless a control (an unchanged page, channel or country) did not move.

## Output format

```
Move: <metric, periods, numbers>
Measurement: <ok / problem found: ...>
Hypotheses:
  1. <cause>: confirmed / ruled out / open. Evidence: <numbers, source>
  2. ...
Verdict: <one sentence>. Confidence: high / medium / low (<why>)
Next step: <action>, owner <name>, check again on <date>
```

A filled sample on invented data: `examples/acme-coffee/diagnosis.md`. A small-sample readout: `examples/acme-coffee/ab-readout.txt`.

## Failure modes

| Trap | What it looks like | Instead |
|---|---|---|
| Storytelling first | "Leads dropped because of the holiday" with no breakdown | step 2, then step 4 |
| Mixed units | GA4 sessions as the denominator of PostHog conversions | people over people, one tool per ratio |
| Survivorship | only looking at pages that still get traffic | compare the full landing page list for both periods |
| Average position read alone | "position improved from 9 to 6" while clicks fell | weighted position moves when low-ranked queries drop out; check clicks per query |
| Calling a test early | p = 0.1 after a week | `compare.py` gives the people needed per side |

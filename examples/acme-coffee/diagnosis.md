# Diagnosis: "the new wholesale page doubled leads"

Invented example for Acme Coffee. Input: the claim in the team chat on 2026-11-19, the snapshot in `snapshot.json`, and the A/B file `ab-test.csv`.

```
Move: wholesale page split test since 14 Nov (ab-test.csv), PostHog form_submitted people: old page 9 of 1,204, new page 17 of 1,188.
Measurement: one problem found. PostHog counted 17 people who submitted the form in the 7 days, the lead webhook received 6 (snapshot, leads.cur).
  The form fires form_submitted on click, before validation, so failed submits count as leads.
  Also: acme-coffee.webflow.io sent 23 people (staging preview), now excluded.
Hypotheses:
  1. The new page converts better: open. 0.75% vs 1.43%, p = 0.107, about 3,620 people per side needed (compare.py). Verdict TOO EARLY.
  2. The event fires on failed submits: confirmed. 17 events vs 6 webhook leads in the same 7 days.
  3. Traffic mix shifted toward higher intent: ruled out. Paid Search sessions 455 vs 441, Organic Search share unchanged (GA4 channel).
  4. Staging traffic inflated the new page: partly. 23 preview visitors, 2 test submits on 13 Nov.
Verdict: the "doubling" is mostly the event firing before validation plus staging tests; the page itself may be better, but the sample cannot tell yet.
Confidence: medium (measurement problem confirmed with two sources; page effect not measurable at this sample).
Next step: move form_submitted to the server-side success response, owner web developer, then re-read on 2026-12-17 with compare.py.
```

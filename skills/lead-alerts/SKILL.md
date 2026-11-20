---
name: lead-alerts
description: Wires new-lead alerts from site forms, a CRM or PostHog to the sales channel in Slack or Telegram within seconds, through the hub's /hook/lead webhook, which stores every lead before delivery and re-sends undelivered ones. Covers payload shapes, the shared secret, test leads, and a check that every form submit reaches sales. Use when the user says "lead alert", "notify sales", "new lead to Slack", "form to Telegram", "we are missing leads", "webhook for the contact form", or when the report flags a gap between lead events and leads received.
---

# Lead alerts

Every real lead reaches a person in sales in seconds, and none is lost when Slack or Telegram is down. Done means a test lead from every form arrives in the sales channel, and the 7-day count of PostHog lead events and webhook leads agree within the gap you can explain.

## Inputs

- The hub URL and `LEAD_HOOK_SECRET` (set in `analytics-hub-setup`).
- Where sales reads: `SLACK_LEADS_WEBHOOK_URL`, or the report channels.
- The list of forms and where each one can send a webhook: the form builder, the site backend, the CRM, or a PostHog destination.

## Steps

1. **Pick the sender per form.** Best: the site backend after it saves the submit (it knows the submit succeeded). Next: the form builder's webhook setting. Last: a PostHog webhook destination on the lead event, which works when you cannot touch the form. Shapes for each: `references/payloads.md`.
2. **Point it at the hub.** `POST https://<hub>/hook/lead` with header `x-hook-secret: <LEAD_HOOK_SECRET>`. JSON or form-encoded bodies both work. When a tool cannot set headers, `?secret=` in the URL works, but the secret then appears in that tool's logs; rotate it if the tool is shared.
3. **Preview first.** `python3 skills/lead-alerts/scripts/send_test_lead.py --payload <your sample.json> --dry-run` prints the message sales will see. Check the name, contact and source fields map correctly. The mapping rules are in `references/payloads.md`.
4. **Send a test lead.** `LEAD_HOOK_SECRET=... python3 skills/lead-alerts/scripts/send_test_lead.py --url <hub>`. The name starts with `TEST` and the payload has `test: true`, so sales sees "TEST New lead" and the report does not count it. Exit 0 means delivered, 2 means stored but not delivered (check the channel secret).
5. **Submit each real form once** with a name starting with `TEST`. One alert per submit. Two alerts means two senders are wired; remove one.
6. **Reconcile after a week.** Compare PostHog people who fired the primary lead event with webhook leads (`marketing-report` flags a gap under 50%). Explain the gap: spam filtered by the form, failed validation counted by an on-click event, or a form that still posts nowhere.

## Gates

- No form goes live without step 5 done on the live site.
- Personal data goes only to the sales channel. It never goes into analytics event properties and never into the morning report (the report shows counts only).
- The secret is never committed, pasted in a ticket or put in front-end code. Browser forms post to your backend or the form builder, which calls the hub.

## How delivery works

The worker writes the lead to D1 first, then sends it. If no channel accepts it, the row stays `delivered = 0`, and the 08:00 report run re-sends leads from the last 3 days with a "(delayed)" prefix. Leads without a contact and without a message are rejected with 422, which drops most empty bot submits.

## Output

The alert text, as in `examples/acme-coffee/lead-alert-preview.txt`:

```
TEST New lead from wholesale-form
Name: TEST Priya Shah
Contact: +1 555 0142
Message: We run two cafes in Portland and want to try your house blend for wholesale.
Came from: source=google medium=cpc campaign=wholesale-portland
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 401 | wrong or missing secret | header name is `x-hook-secret` |
| 503 "LEAD_HOOK_SECRET is not set" | secret not configured on the worker | `npx wrangler secret put LEAD_HOOK_SECRET` |
| 422 | the sender's field names are not mapped | rename fields, or add the name to `normalizeLead` in `src/leads.js` |
| Stored, not delivered (exit 2) | Slack webhook revoked, bot not in the Telegram chat | fix the channel; the next report run re-sends |
| Spam floods the channel | open form without a captcha | add the form builder's spam check before the webhook, not after |
| Source shows "form" for every lead | the sender does not pass `form`, `source` or the page | add a hidden `form` field per form |

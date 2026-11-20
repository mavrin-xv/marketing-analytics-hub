# Event naming

## Rules

- `object_action` in snake_case: the thing, then what happened to it. `form_submitted`, not `submit_form` or `FormSubmit`.
- A past participle for the action, as in the examples (`submitted`, `clicked`, `viewed`, `selected`). Keep one style across the plan.
- At most 40 characters (GA4 limit for event names).
- Do not reuse reserved names: GA4 reserves `first_visit`, `session_start`, `user_engagement`, `page_view`, `scroll`, `click`, `file_download` and others; PostHog reserves names that start with `$`.
- Variants go in properties: `form_submitted` with `form: wholesale`, not `wholesale_form_submitted`. Ten forms make ten properties values, not ten events.
- Never put personal data (email, phone, full name) in event properties. Send it only to the lead webhook, which goes to sales.

## Starter plan for a small service or product site

| Event | Trigger | Properties |
|---|---|---|
| `form_submitted` | server confirms a form | `form`, `plan` |
| `contact_clicked` | phone, chat or messenger link | `method` |
| `pricing_viewed` | pricing section scrolled into view or pricing page | `page` |
| `plan_selected` | a plan or package chosen | `plan` |
| `checkout_started` | checkout opens | `plan`, `value_band` |
| `purchase_completed` | payment confirmed (server) | `plan`, `value` |
| `signup_completed` | account created (server) | `method` |

Pageviews come automatically from both tools; do not add a custom pageview event.

## Linter

```
python3 skills/tracking-plan/scripts/utm.py events form_submitted "Contact Click" signupComplete
```

Errors: not snake_case object_action, or a reserved name. Warning: the name does not end in a past-tense verb (`submit_form`).

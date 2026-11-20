# Lead payloads

The webhook accepts two shapes and maps fields in this order. The first non-empty value wins.

| Field in the alert | Looked up in |
|---|---|
| Name | `name`, `full_name`, `first_name` |
| Contact | `email`, `phone`, `contact`, `telegram` |
| Message | `message`, `comment`, `text` |
| Source | `source`, `form`, `$pathname`, `page`; else `posthog` or `form` |
| Came from | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, or the `$initial_` versions PostHog stores |
| Test | `test: true`, or a name that starts with `TEST` |

Each key is looked up at the top level, then in `event.properties` (or `properties`), then in `person.properties`. Values are cut to safe lengths and control characters are removed.

## Flat (backend, form builders)

```json
{
  "name": "TEST Dana Ortiz",
  "phone": "+1 555 0100",
  "message": "Wholesale for one cafe",
  "form": "wholesale-form",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "wholesale",
  "test": true
}
```

Form-encoded bodies with the same field names work too.

## PostHog webhook destination

In PostHog, Data pipeline > Destinations > Webhook, filtered to the primary lead event. Set the URL to the hub and add the `x-hook-secret` header. The default body includes `event` and `person`:

```json
{
  "event": { "event": "form_submitted", "properties": { "$pathname": "/wholesale", "form": "wholesale-form" } },
  "person": { "properties": { "name": "TEST Sam Lee", "phone": "+1 555 0101", "$initial_utm_source": "newsletter" } }
}
```

This route only knows what PostHog knows about the person. If the form does not call `posthog.identify` or set person properties, the alert has no contact, and the hub rejects it with 422. Prefer the flat route from the backend when you can.

## Testing

```
python3 skills/lead-alerts/scripts/send_test_lead.py --dry-run
python3 skills/lead-alerts/scripts/send_test_lead.py --posthog --dry-run
python3 skills/lead-alerts/scripts/send_test_lead.py --payload examples/acme-coffee/lead.json --dry-run
```

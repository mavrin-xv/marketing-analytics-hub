#!/usr/bin/env python3
"""Send a test lead to the hub's /hook/lead endpoint, or preview the message without sending.

The test lead is marked test=true and its name starts with "TEST", so sales sees it as a test and
the morning report does not count it.

Usage:
  python3 send_test_lead.py --dry-run                                  # print payload and the alert text, send nothing
  python3 send_test_lead.py --payload examples/acme-coffee/lead.json --dry-run
  python3 send_test_lead.py --url https://marketing-hub.example.workers.dev   # needs LEAD_HOOK_SECRET env var
  python3 send_test_lead.py --url ... --posthog                       # send the PostHog webhook shape instead

Exit 0 when the hub answers delivered=true, 2 when it stored the lead but delivery failed, 1 on error.
Stdlib only.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

FLAT = {
    "name": "TEST Dana Ortiz",
    "phone": "+1 555 0100",
    "company": "Northwind Cafe",
    "message": "Test lead from send_test_lead.py. Need 40 kg of beans a month.",
    "page": "https://acme-coffee.com/wholesale",
    "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "wholesale",
    "test": True,
}
POSTHOG = {
    "event": {"event": "form_submitted", "properties": {"$current_url": "https://acme-coffee.com/wholesale", "utm_source": "newsletter", "utm_medium": "email"}},
    "person": {"properties": {"name": "TEST Sam Lee", "phone": "+1 555 0101", "$initial_utm_source": "google", "$initial_utm_medium": "cpc"}},
    "test": True,
}


def preview(p):
    """Mirror of normalizeLead + formatLead in src/leads.js, so the dry run shows what sales will see."""
    props = (p.get("event") or {}).get("properties") or p.get("properties") or {}
    person = (p.get("person") or {}).get("properties") or {}

    def pick(*keys):
        for k in keys:
            for src in (p, props, person):
                v = src.get(k)
                if v not in (None, ""):
                    return v
        return ""

    name = pick("name", "full_name", "first_name")
    source = pick("source", "form", "$pathname", "page") or ("posthog" if "event" in p else "form")
    test = bool(p.get("test")) or str(name).lower().startswith("test")
    lines = [f"{'TEST ' if test else ''}New lead from {source}",
             f"Name: {name or '(not given)'}",
             f"Contact: {pick('email', 'phone', 'contact', 'telegram') or '(not given)'}"]
    msg = pick("message", "comment", "text")
    if msg:
        lines.append(f"Message: {msg}")
    utm = []
    for k in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        v = pick(k, "$initial_" + k)
        if v:
            utm.append(f"{k.replace('utm_', '')}={v}")
    if utm:
        lines.append("Came from: " + " ".join(utm))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="hub base URL")
    ap.add_argument("--payload", help="JSON file to send instead of the built-in test lead")
    ap.add_argument("--posthog", action="store_true", help="use the PostHog webhook shape")
    ap.add_argument("--dry-run", action="store_true", help="print, do not send")
    a = ap.parse_args()
    if a.payload:
        with open(a.payload, encoding="utf-8") as f:
            payload = json.load(f)
        payload.setdefault("test", True)
    else:
        payload = POSTHOG if a.posthog else FLAT
    if a.dry_run or not a.url:
        print("payload:\n" + json.dumps(payload, indent=2))
        print("\nalert preview:\n" + preview(payload))
        if not a.url:
            print("\n(no --url given: nothing sent)")
        return
    secret = os.environ.get("LEAD_HOOK_SECRET")
    if not secret:
        sys.exit("Set LEAD_HOOK_SECRET in the environment (the same value as the worker secret).")
    req = urllib.request.Request(a.url.rstrip("/") + "/hook/lead", data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "x-hook-secret": secret}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"hub answered {e.code}: {e.read().decode(errors='replace')[:300]}")
    except Exception as e:
        sys.exit(f"could not reach the hub: {e}")
    print(json.dumps(body, indent=2))
    data = body.get("data") or {}
    sys.exit(0 if data.get("delivered") else 2)


if __name__ == "__main__":
    main()

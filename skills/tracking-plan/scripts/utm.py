#!/usr/bin/env python3
"""Build tagged links and lint a list of links or event names before they ship.

Untagged and inconsistently tagged links are the main reason GA4 shows "Unassigned" and why the
same newsletter appears as three sources. This script enforces one convention:
lowercase, no spaces, utm_source = the site that sends the click, utm_medium from a fixed list.

Usage:
  python3 utm.py build --url https://acme-coffee.com/wholesale --source newsletter --medium email --campaign 2026-11-wholesale
  python3 utm.py lint --csv examples/acme-coffee/links.csv          # column "url"
  python3 utm.py events form_submitted "Contact Click" signupComplete  # check event names
  python3 utm.py lint --csv links.csv --json

lint and events exit 1 when any row has an error. Stdlib only.
"""
import argparse
import csv
import json
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# GA4 default channel grouping recognises these mediums. Anything else lands in Unassigned or Referral.
MEDIUMS = {"cpc", "ppc", "paid", "paidsearch", "display", "banner", "email", "social", "paid_social", "organic_social",
           "affiliate", "referral", "sms", "push", "video", "audio", "qr", "partner"}
SOURCE_ALIASES = {"fb": "facebook", "ig": "instagram", "li": "linkedin", "tw": "x", "twitter": "x", "yt": "youtube", "google_ads": "google", "adwords": "google"}
RESERVED_EVENTS = {"click", "page_view", "session_start", "first_visit", "user_engagement", "scroll", "file_download"}
SNAKE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)+$")
TOKEN = re.compile(r"^[a-z0-9][a-z0-9_\-\.]*$")


def build(url, source, medium, campaign, content=None, term=None):
    parts = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(parts.query) if not k.startswith("utm_")]
    tags = {"utm_source": source, "utm_medium": medium, "utm_campaign": campaign, "utm_content": content, "utm_term": term}
    q += [(k, v.strip().lower().replace(" ", "-")) for k, v in tags.items() if v]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))


def lint_url(url):
    errs, warns = [], []
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        errs.append("not an http(s) URL")
        return errs, warns
    if parts.scheme == "http":
        warns.append("http link: the redirect to https can drop the query string on some hosts")
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    utm = {k: v for k, v in q.items() if k.lower().startswith("utm_")}
    if not utm:
        warns.append("no UTM tags: fine for organic links, wrong for anything you paid for or emailed")
        return errs, warns
    for k, v in utm.items():
        if k != k.lower():
            errs.append(f"{k}: parameter names must be lowercase (GA4 treats utm_Source as a different key)")
        if not v:
            errs.append(f"{k} is empty")
        elif not TOKEN.match(v):
            errs.append(f"{k}={v!r}: use lowercase letters, digits, - _ . only (no spaces or capitals)")
    for need in ("utm_source", "utm_medium", "utm_campaign"):
        if need not in {k.lower() for k in utm}:
            errs.append(f"missing {need}")
    src = q.get("utm_source", "").lower()
    if src in SOURCE_ALIASES:
        errs.append(f"utm_source={src}: use '{SOURCE_ALIASES[src]}' so it does not split from the same source tagged elsewhere")
    med = q.get("utm_medium", "").lower()
    if med and med not in MEDIUMS:
        warns.append(f"utm_medium={med}: not one GA4's default channels recognise; it will show as Unassigned unless you add a custom channel group")
    if "gclid" in q and utm:
        warns.append("gclid and UTMs together: let Google Ads auto-tagging win, drop the manual UTMs on ad URLs")
    if parts.netloc.endswith(("bit.ly", "t.co", "lnkd.in")):
        warns.append("shortener: lint the destination URL, not the short link")
    return errs, warns


def lint_event(name):
    errs, warns = [], []
    if name in RESERVED_EVENTS:
        errs.append("reserved or automatically collected name; pick object_action like contact_clicked")
    elif not SNAKE.match(name):
        errs.append("use snake_case object_action, e.g. form_submitted, plan_selected")
    if len(name) > 40:
        errs.append("over 40 characters (GA4 limit)")
    if SNAKE.match(name) and not re.search(r"_(viewed|clicked|submitted|started|completed|selected|opened|added|removed|created|sent|failed|downloaded|booked|paid|cancelled|upgraded)$", name):
        warns.append("no past-tense action verb at the end; object_action reads better in funnels (pricing_viewed)")
    return errs, warns


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="make one tagged URL")
    b.add_argument("--url", required=True)
    b.add_argument("--source", required=True)
    b.add_argument("--medium", required=True)
    b.add_argument("--campaign", required=True)
    b.add_argument("--content")
    b.add_argument("--term")
    l = sub.add_parser("lint", help="lint URLs from a CSV (column url) or arguments")
    l.add_argument("urls", nargs="*")
    l.add_argument("--csv")
    l.add_argument("--json", action="store_true")
    e = sub.add_parser("events", help="lint event names")
    e.add_argument("names", nargs="+")
    e.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.cmd == "build":
        src = SOURCE_ALIASES.get(a.source.lower(), a.source.lower())
        url = build(a.url, src, a.medium.lower(), a.campaign, a.content, a.term)
        errs, warns = lint_url(url)
        print(url)
        for w in errs + warns:
            print("  note: " + w, file=sys.stderr)
        sys.exit(1 if errs else 0)

    items = []
    if a.cmd == "lint":
        urls = list(a.urls)
        if a.csv:
            with open(a.csv, encoding="utf-8") as f:
                urls += [r["url"] for r in csv.DictReader(f) if r.get("url")]
        if not urls:
            ap.error("give URLs or --csv")
        items = [(u, *lint_url(u)) for u in urls]
    else:
        items = [(n, *lint_event(n)) for n in a.names]

    if a.json:
        print(json.dumps([{"item": i, "errors": er, "warnings": w} for i, er, w in items], indent=2))
    else:
        for i, er, w in items:
            print(("FAIL " if er else "WARN " if w else "OK   ") + i)
            for x in er:
                print("     error: " + x)
            for x in w:
                print("     warn:  " + x)
        bad = sum(1 for _i, er, _w in items if er)
        print(f"\n{len(items)} checked, {bad} with errors")
    sys.exit(1 if any(er for _i, er, _w in items) else 0)


if __name__ == "__main__":
    main()

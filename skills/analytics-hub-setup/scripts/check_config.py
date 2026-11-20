#!/usr/bin/env python3
"""Check a marketing hub config before you deploy, so the first cron run does not fail at 06:00.

Reads wrangler.toml (vars, crons, D1 binding) and a secrets file or the environment, then reports
per source: READY, MISSING (with the exact thing to add) or OFF (not configured, will be skipped).
Nothing is sent anywhere. With --live it also asks /api/health and /api/status of a deployed hub.

Usage:
  python3 check_config.py --toml templates/worker/wrangler.toml.example
  python3 check_config.py --toml wrangler.toml --secrets .dev.vars
  python3 check_config.py --toml wrangler.toml --live https://marketing-hub.example.workers.dev
  python3 check_config.py --toml wrangler.toml --json

Exit code 1 when a source is half configured (some keys set, some missing) or the crons do not
match the worker's slots. Stdlib only (tomllib needs Python 3.11+; older Pythons use a tiny parser).
"""
import argparse
import json
import os
import re
import sys
import urllib.request

SLOTS = {"0 6 * * *": "posthog", "30 6 * * *": "ga4", "0 7 * * *": "gsc", "30 7 * * *": "ads", "0 8 * * *": "report"}

# source -> (vars needed, secrets needed)
NEEDS = {
    "ga4": (["GA4_PROPERTY_ID", "HOSTS"], ["GOOGLE_SA_JSON"]),
    "gsc": (["GSC_SITES"], ["GOOGLE_SA_JSON"]),
    "posthog": (["POSTHOG_HOST", "POSTHOG_PROJECT_ID", "HOSTS"], ["POSTHOG_API_KEY"]),
    "ads": (["ADS_CUSTOMER_ID"], ["ADS_DEVELOPER_TOKEN", "ADS_CLIENT_ID", "ADS_CLIENT_SECRET", "ADS_REFRESH_TOKEN"]),
    "dashboard": ([], ["DASHBOARD_PASSWORD", "SESSION_SECRET"]),
    "telegram": ([], ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]),
    "slack": ([], ["SLACK_WEBHOOK_URL"]),
    "lead_hook": ([], ["LEAD_HOOK_SECRET"]),
}
# The var whose absence means "this source is switched off" rather than "half configured".
KEY_VAR = {"ga4": "GA4_PROPERTY_ID", "gsc": "GSC_SITES", "posthog": "POSTHOG_PROJECT_ID", "ads": "ADS_CUSTOMER_ID"}
HINTS = {
    "GA4_PROPERTY_ID": "numeric id from GA4 Admin > Property details (not the G- measurement id)",
    "GSC_SITES": "sc-domain:example.com or https://www.example.com/ exactly as Search Console lists it",
    "GOOGLE_SA_JSON": "wrangler secret put GOOGLE_SA_JSON < key.json; add the service account email as a GA4 Viewer and a Search Console user",
    "POSTHOG_API_KEY": "personal API key with query:read scope (not the phc_ project key)",
    "POSTHOG_PROJECT_ID": "number in the PostHog URL /project/<id>",
    "ADS_CUSTOMER_ID": "10 digits, no dashes",
    "ADS_DEVELOPER_TOKEN": "Google Ads API Center; basic access is enough for your own accounts",
    "ADS_REFRESH_TOKEN": "OAuth refresh token for a user with access to the account (see references/sources-setup.md)",
    "SESSION_SECRET": "32+ random characters, e.g. python3 -c \"import secrets;print(secrets.token_urlsafe(32))\"",
    "LEAD_HOOK_SECRET": "random string; the form or PostHog webhook sends it as x-hook-secret",
}


def parse_toml(text):
    try:
        import tomllib
        return tomllib.loads(text)
    except ImportError:
        pass
    # Minimal fallback: [vars] key = "value", crons = [...], database_id.
    out = {"vars": {}, "triggers": {}, "d1_databases": [{}]}
    section = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.match(r"^\[\[?([\w.]+)\]?\]$", line)
        if m:
            section = m.group(1)
            continue
        m = re.match(r'^(\w+)\s*=\s*(.+)$', line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        val = json.loads(v) if v.startswith(("[", '"')) else v
        if section == "vars":
            out["vars"][k] = val
        elif section == "triggers":
            out["triggers"][k] = val
        elif section == "d1_databases":
            out["d1_databases"][0][k] = val
    return out


def read_secrets(path):
    found = {}
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)$", line)
                if m and m.group(2).strip().strip('"'):
                    found[m.group(1)] = True
    for k in os.environ:
        found.setdefault(k, True)
    return found


def check(cfg, secrets):
    v = {k: str(val).strip() for k, val in (cfg.get("vars") or {}).items()}
    rows, problems = [], []
    for src, (need_vars, need_secrets) in NEEDS.items():
        missing = [k for k in need_vars if not v.get(k)] + [k for k in need_secrets if not secrets.get(k)]
        have = len(need_vars) + len(need_secrets) - len(missing)
        if not missing:
            state = "READY"
        elif have == 0 or (src in KEY_VAR and not v.get(KEY_VAR[src])):
            state = "OFF"
        else:
            state = "MISSING"
            problems.append(src)
        rows.append({"source": src, "state": state, "missing": [{"key": k, "how": HINTS.get(k, "")} for k in missing]})
    crons = (cfg.get("triggers") or {}).get("crons") or []
    unknown = [c for c in crons if c not in SLOTS]
    absent = [c for c in SLOTS if c not in crons]
    if unknown or absent:
        problems.append("crons")
    db = (cfg.get("d1_databases") or [{}])[0]
    db_id = str(db.get("database_id", ""))
    notes = []
    if not db_id or set(db_id.replace("-", "")) <= {"0"}:
        notes.append("D1 database_id is still the placeholder: run `npx wrangler d1 create marketing-hub` and paste the id.")
    channels = [c.strip() for c in v.get("REPORT_CHANNELS", "").split(",") if c.strip()]
    for c in channels:
        st = next((r for r in rows if r["source"] == c), None)
        if st and st["state"] != "READY":
            notes.append(f"REPORT_CHANNELS lists '{c}' but it is {st['state']}: the morning report will not reach it.")
    if v.get("POSTHOG_HOST") and not v["POSTHOG_HOST"].startswith("https://"):
        notes.append("POSTHOG_HOST must be the full https:// URL of your region (us or eu).")
    if v.get("ADS_CUSTOMER_ID") and not re.fullmatch(r"\d{10}", v["ADS_CUSTOMER_ID"]):
        notes.append("ADS_CUSTOMER_ID must be 10 digits without dashes.")
        problems.append("ads")
    return {"sources": rows, "crons": {"unknown": unknown, "missing": absent}, "notes": notes, "problems": problems}


def live(url):
    out = {}
    for path in ("/api/health", "/api/status"):
        try:
            with urllib.request.urlopen(url.rstrip("/") + path, timeout=20) as r:
                out[path] = r.status
        except urllib.error.HTTPError as e:
            out[path] = e.code
        except Exception as e:  # network, DNS
            out[path] = f"error: {e}"
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--toml", required=True, help="path to wrangler.toml (or the .example)")
    ap.add_argument("--secrets", help="a .dev.vars style KEY=value file; the environment is read too")
    ap.add_argument("--live", help="base URL of a deployed hub to ping")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    with open(a.toml, encoding="utf-8") as f:
        cfg = parse_toml(f.read())
    res = check(cfg, read_secrets(a.secrets))
    if a.live:
        res["live"] = live(a.live)
    if a.json:
        print(json.dumps(res, indent=2))
    else:
        for r in res["sources"]:
            print(f"{r['state']:8} {r['source']}")
            for m in r["missing"]:
                print(f"         - {m['key']}: {m['how']}" if m["how"] else f"         - {m['key']}")
        if res["crons"]["unknown"] or res["crons"]["missing"]:
            print(f"CRONS    unknown {res['crons']['unknown']} missing {res['crons']['missing']} (must match SLOTS in src/index.js)")
        else:
            print("OK       crons match the worker slots")
        for n in res["notes"]:
            print("NOTE     " + n)
        if a.live:
            for p, s in res["live"].items():
                print(f"LIVE     {p} -> {s}  (expect 200 for health, 401 for status without a cookie)")
    sys.exit(1 if res["problems"] else 0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Turn a hub snapshot into a morning report, with anomaly flags.

Input is the JSON the worker returns from GET /api/report (field "snapshot"), or a file of the
same shape (see examples/acme-coffee/snapshot.json). Output is plain text for Telegram, markdown,
or Slack mrkdwn. The flags are the checks a careful analyst runs before trusting a number.

Usage:
  python3 digest.py snapshot.json                 # text report + flags
  python3 digest.py snapshot.json --format md     # markdown (for a doc or a PR comment)
  python3 digest.py snapshot.json --flags-only    # only the anomaly list, exit 1 if any are high
  python3 digest.py --url https://hub.example.workers.dev   # fetch live, needs HUB_COOKIE env var

Stdlib only.
"""
import argparse
import json
import os
import sys
import urllib.request

STAGING_HINTS = ("localhost", "127.0.0.1", "webflow.io", "vercel.app", "netlify.app", "pages.dev", "staging", "preview")
AI_HOSTS = ("chatgpt.com", "chat.openai.com", "perplexity.ai", "claude.ai", "gemini.google.com", "copilot.microsoft.com")


def fmt(v, d=0):
    if v is None:
        return "n/a"
    return f"{v:,.{d}f}"


def delta(cur, prev, cur_days=7, prev_days=7):
    """Week over week. No previous data means no delta, never a fake +1800%."""
    if cur is None or not prev:
        return ""
    if cur_days < 7 or prev_days < 7:
        return " (prev week incomplete)"
    pct = (cur - prev) / prev * 100
    if abs(pct) < 0.5:
        return " (flat)"
    return f" ({'+' if pct > 0 else ''}{pct:.0f}% wow)"


def block(snap, src):
    s = (snap.get("sources") or {}).get(src)
    if not s or not (s.get("cur") or {}).get("_days"):
        return None
    return s


def line(label, s, metric, d=0):
    cur = s["cur"].get(metric)
    return f"{label}: {fmt(cur, d)}{delta(cur, s['prev'].get(metric), s['cur'].get('_days', 0), s['prev'].get('_days', 0))}"


def flags(snap):
    """Return a list of (severity, text). high = do not trust the headline until checked."""
    out = []
    ga4, ph, gsc, ads = (block(snap, k) for k in ("ga4", "posthog", "gsc", "ads"))
    for name, b in (("ga4", ga4), ("posthog", ph), ("gsc", gsc), ("ads", ads)):
        if b is None:
            out.append(("info", f"{name}: no data in the window (not connected, or the sync is failing)."))
    for src, run in (snap.get("sync") or {}).items():
        if run.get("status") != "ok":
            out.append(("high", f"{src}: last sync is '{run.get('status')}' ({(run.get('message') or '')[:120]}). Its numbers may be stale."))
    if ga4:
        c = ga4["cur"]
        if c.get("users") and c.get("sessions", 0) / c["users"] > 3:
            out.append(("high", f"GA4 sessions per user is {c['sessions'] / c['users']:.1f}. Above 3 usually means a bot or a monitor, check device and country breakdowns."))
        p = ga4["prev"]
        if p.get("sessions") and c.get("sessions") is not None:
            ch = (c["sessions"] - p["sessions"]) / p["sessions"]
            if abs(ch) >= 0.4:
                out.append(("high", f"GA4 sessions moved {ch * 100:+.0f}% week over week. Check tracking before you explain it (tag removed, consent banner change, bot burst)."))
    if ga4 and ph:
        g, h = ga4["cur"].get("pageviews"), ph["cur"].get("pageviews")
        if g and h:
            ratio = h / g
            if ratio < 0.5 or ratio > 2:
                out.append(("high", f"PostHog pageviews are {ratio:.1f}x GA4 pageviews. Normal spread is 0.6 to 1.5x (ad blockers, consent). Something is double-firing or missing on one side."))
    for key, _v in (snap.get("top") or {}).get("referrers", []):
        if any(hint in str(key) for hint in STAGING_HINTS):
            out.append(("medium", f"Referrer '{key}' looks like staging or a preview build. Exclude it in POSTHOG_EXCLUDE_HOSTS."))
    for key, _v in (snap.get("top") or {}).get("channels", []):
        if str(key).lower() in ("unassigned", "(not set)"):
            out.append(("medium", f"GA4 channel '{key}' is in the top channels. Usually untagged links or AI-assistant referrals; add UTMs or a custom channel group."))
    ai = (snap.get("top") or {}).get("aiRefs", [])
    if ai:
        total = sum(v for _k, v in ai)
        out.append(("info", f"AI assistants sent {fmt(total)} people this week ({', '.join(k for k, _ in ai)}). GA4 often files them under Referral or Unassigned."))
    if ads:
        a = ads["cur"]
        if a.get("spend") and not a.get("conversions"):
            out.append(("high", f"Ads spent {fmt(a['spend'], 2)} with zero recorded conversions. Either it is not working or the conversion action is broken; check the tracking-plan skill first."))
        share = snap.get("impressionShare") or {}
        if share.get("lost_budget", 0) >= 0.15:
            out.append(("medium", f"Lost {share['lost_budget'] * 100:.0f}% of impression share to budget. More budget would buy more of the same traffic."))
        if share.get("lost_rank", 0) >= 0.3:
            out.append(("medium", f"Lost {share['lost_rank'] * 100:.0f}% to rank. Fix ad rank (quality, bids) before adding budget."))
    if ph:
        for ev in snap.get("leadEvents", []):
            n = ph["cur"].get(f"{ev}_users")
            if n is not None and 0 < n < 20:
                out.append(("info", f"{ev}: {fmt(n)} people this week. Too few to read a rate change; compare over 4+ weeks."))
    leads = snap.get("leads") or {}
    if ph and snap.get("leadEvents"):
        first = snap["leadEvents"][0]
        ev_people = ph["cur"].get(f"{first}_users") or 0
        hook = leads.get("cur", 0)
        if ev_people >= 5 and hook < ev_people * 0.5:
            out.append(("high", f"PostHog saw {fmt(ev_people)} people fire {first}, the lead webhook received {hook}. Leads may be getting lost between the form and sales."))
    return out


def compose(snap, fmt_name="text"):
    L = []
    h = (lambda t: f"## {t}") if fmt_name == "md" else (lambda t: f"*{t}*") if fmt_name == "slack" else (lambda t: t)
    L.append(f"Marketing report for {snap['day']}. Last 7 days vs the 7 before.")
    ga4, ph, gsc, ads = (block(snap, k) for k in ("ga4", "posthog", "gsc", "ads"))
    top = snap.get("top") or {}

    L += ["", h("HOW MANY (GA4)")]
    if ga4:
        y = ga4.get("yesterday") or {}
        L.append(f"Yesterday: {fmt(y.get('sessions'))} sessions, {fmt(y.get('key_events'))} key events")
        L += [line("Sessions 7d", ga4, "sessions"), line("Users 7d", ga4, "users"), line("Key events 7d", ga4, "key_events")]
        if top.get("channels"):
            L.append("Channels: " + ", ".join(f"{k} {fmt(v)}" for k, v in top["channels"]))
    else:
        L.append("not connected or no data yet")

    L += ["", h("WHY (PostHog)")]
    if ph:
        for ev in snap.get("leadEvents", []):
            if f"{ev}_users" in ph["cur"]:
                L.append(line(f"{ev} people 7d", ph, f"{ev}_users"))
        first = (snap.get("leadEvents") or [None])[0]
        if first and ph["cur"].get("users") and f"{first}_users" in ph["cur"]:
            L.append(f"{first} rate: {ph['cur'][first + '_users'] / ph['cur']['users'] * 100:.2f}% of people (people over people)")
        if top.get("leadPages"):
            L.append("Leads start on: " + ", ".join(f"{k} ({fmt(v)})" for k, v in top["leadPages"]))
        if top.get("aiRefs"):
            L.append("AI assistants sent: " + ", ".join(f"{k} {fmt(v)}" for k, v in top["aiRefs"]))
    else:
        L.append("not connected or no data yet")

    w = (snap.get("windows") or {}).get("gscCur") or {}
    L += ["", h(f"SEARCH (Search Console, {w.get('from', '?')}..{w.get('to', '?')}, data lags 2-3 days)")]
    if gsc:
        L += [line("Clicks", gsc, "clicks"), line("Impressions", gsc, "impressions")]
        imp = gsc["cur"].get("impressions")
        L.append(f"Avg position: {fmt(gsc['cur']['pos_x_impr'] / imp, 1) if imp else 'n/a'} (impression-weighted)")
        if top.get("queries"):
            L.append("Top queries: " + ", ".join(f'"{k}" {fmt(v)}' for k, v in top["queries"]))
    else:
        L.append("not connected or no data yet")

    L += ["", h("ADS (Google Ads)")]
    if ads:
        a = ads["cur"]
        L += [line("Spend 7d", ads, "spend", 2), line("Conversions 7d", ads, "conversions", 1)]
        L.append(f"Cost per conversion: {fmt(a['spend'] / a['conversions'], 2) if a.get('conversions') else 'n/a (no conversions)'}")
        s = snap.get("impressionShare")
        if s:
            L.append(f"Search impression share {s['search_is'] * 100:.0f}%, lost to rank {s['lost_rank'] * 100:.0f}%, lost to budget {s['lost_budget'] * 100:.0f}%")
        if top.get("campaigns"):
            L.append("Top spend: " + ", ".join(f"{k} {fmt(v, 2)}" for k, v in top["campaigns"]))
    else:
        L.append("not connected or no data yet")

    leads = snap.get("leads") or {}
    L += ["", f"LEADS: {leads.get('yesterday', 0)} yesterday, {leads.get('cur', 0)} in 7 days (webhook, tests excluded)"]
    if snap.get("notes"):
        L.append("Notes: " + "; ".join(f"{n['day']} {n['note']}" for n in snap["notes"]))
    fl = flags(snap)
    if fl:
        L += ["", h("CHECK BEFORE YOU TRUST")]
        order = {"high": 0, "medium": 1, "info": 2}
        L += [f"[{sev}] {text}" for sev, text in sorted(fl, key=lambda x: order[x[0]])]
    if snap.get("dashboard"):
        L += ["", snap["dashboard"]]
    return "\n".join(L)


def load(args):
    if args.url:
        cookie = os.environ.get("HUB_COOKIE")
        if not cookie:
            sys.exit("Set HUB_COOKIE to the hub_session cookie value (copy it from the browser after login).")
        req = urllib.request.Request(args.url.rstrip("/") + "/api/report", headers={"cookie": f"hub_session={cookie}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)["data"]["snapshot"]
    with open(args.file, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("snapshot", data)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help="snapshot JSON file")
    ap.add_argument("--url", help="hub base URL to fetch /api/report from")
    ap.add_argument("--format", choices=["text", "md", "slack"], default="text")
    ap.add_argument("--flags-only", action="store_true", help="print only the anomaly flags; exit 1 if any is high")
    args = ap.parse_args()
    if not args.file and not args.url:
        ap.error("give a snapshot file or --url")
    snap = load(args)
    if args.flags_only:
        fl = flags(snap)
        for sev, text in fl:
            print(f"[{sev}] {text}")
        sys.exit(1 if any(sev == "high" for sev, _ in fl) else 0)
    print(compose(snap, args.format))


if __name__ == "__main__":
    main()

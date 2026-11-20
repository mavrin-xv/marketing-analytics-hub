#!/usr/bin/env python3
"""Is this change real? Compare two rates (week vs week, variant vs control) and get a plain verdict.

Two-proportion z-test with a Wilson interval, plus the sample you would need to detect the change
you are claiming. Built for small sites where "conversions doubled" often means 3 became 6.

Usage:
  python3 compare.py --a 3/410 --b 6/395                    # conversions/people, A = before or control
  python3 compare.py --a 3/410 --b 6/395 --label-a "week 45" --label-b "week 46"
  python3 compare.py --csv examples/acme-coffee/ab-test.csv  # columns: label,conversions,people
  python3 compare.py --a 40/2000 --b 52/2010 --json

Verdicts: REAL (p < 0.05 and enough sample), LIKELY NOISE (p >= 0.2), TOO EARLY (in between or
below the sample needed). Use people, not sessions, on both sides. Stdlib only.
"""
import argparse
import csv
import json
import math
import sys


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def needed_per_group(p1, p2, alpha=0.05, power=0.8):
    """People per group to detect p1 -> p2 with a two-sided test."""
    if p1 == p2:
        return None
    za, zb = 1.959964, 0.841621  # alpha 0.05 two-sided, power 0.8
    pbar = (p1 + p2) / 2
    num = (za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2
    return math.ceil(num / (p1 - p2) ** 2)


def compare(ka, na, kb, nb):
    if na <= 0 or nb <= 0:
        raise ValueError("people must be > 0 on both sides")
    if ka > na or kb > nb:
        raise ValueError("conversions cannot exceed people (did you mix sessions and people?)")
    pa, pb = ka / na, kb / nb
    pool = (ka + kb) / (na + nb)
    se = math.sqrt(pool * (1 - pool) * (1 / na + 1 / nb)) if 0 < pool < 1 else 0
    z = (pb - pa) / se if se else 0.0
    p = 2 * (1 - norm_cdf(abs(z))) if se else 1.0
    need = needed_per_group(pa, pb) if pa != pb else None
    enough = need is not None and min(na, nb) >= need
    if p < 0.05 and enough:
        verdict = "REAL"
    elif p >= 0.2:
        verdict = "LIKELY NOISE"
    else:
        verdict = "TOO EARLY"
    small = min(ka, kb) < 10
    return {
        "a": {"conversions": ka, "people": na, "rate": pa, "ci95": wilson(ka, na)},
        "b": {"conversions": kb, "people": nb, "rate": pb, "ci95": wilson(kb, nb)},
        "relative_change": (pb - pa) / pa if pa else None,
        "z": z, "p_value": p, "needed_per_group": need, "verdict": verdict,
        "warning": "fewer than 10 conversions on one side: treat any rate as a rough guess" if small else None,
    }


def parse_pair(s):
    k, n = s.split("/")
    return int(float(k)), int(float(n))


def show(r, la, lb):
    pct = lambda x: f"{x * 100:.2f}%"
    ci = lambda c: f"{pct(c[0])} to {pct(c[1])}"
    print(f"{la}: {r['a']['conversions']}/{r['a']['people']} = {pct(r['a']['rate'])} (95% range {ci(r['a']['ci95'])})")
    print(f"{lb}: {r['b']['conversions']}/{r['b']['people']} = {pct(r['b']['rate'])} (95% range {ci(r['b']['ci95'])})")
    if r["relative_change"] is not None:
        print(f"Change: {r['relative_change'] * 100:+.0f}% relative, p = {r['p_value']:.3f}")
    if r["needed_per_group"]:
        print(f"To trust a change this size you need about {r['needed_per_group']:,} people per side.")
    print(f"Verdict: {r['verdict']}")
    if r["warning"]:
        print("Warning: " + r["warning"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", help="conversions/people for A (before, control)")
    ap.add_argument("--b", help="conversions/people for B (after, variant)")
    ap.add_argument("--label-a", default="A")
    ap.add_argument("--label-b", default="B")
    ap.add_argument("--csv", help="file with label,conversions,people rows; first row is A, others are compared to it")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    pairs = []
    if a.csv:
        with open(a.csv, encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        if len(rows) < 2:
            ap.error("csv needs at least two rows")
        base = rows[0]
        for r in rows[1:]:
            pairs.append((base["label"], int(base["conversions"]), int(base["people"]), r["label"], int(r["conversions"]), int(r["people"])))
    elif a.a and a.b:
        ka, na = parse_pair(a.a)
        kb, nb = parse_pair(a.b)
        pairs.append((a.label_a, ka, na, a.label_b, kb, nb))
    else:
        ap.error("give --a and --b, or --csv")
    out = []
    for la, ka, na, lb, kb, nb in pairs:
        try:
            r = compare(ka, na, kb, nb)
        except ValueError as e:
            sys.exit(f"error: {e}")
        r["label_a"], r["label_b"] = la, lb
        out.append(r)
        if not a.json:
            show(r, la, lb)
            print()
    if a.json:
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

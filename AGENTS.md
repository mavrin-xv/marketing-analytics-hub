# AGENTS.md

Guidance for an AI agent working with or on this repo.

## Using the pack
- Skills: `analytics-hub-setup`, `marketing-report`, `traffic-diagnosis`, `tracking-plan`, `lead-alerts`. Each `SKILL.md` lists its inputs, gates and output.
- Read the filled copy of `templates/analytics-profile.md` before answering; it holds the goals, the lead definition and known tracking quirks.
- Scripts are Python 3.11+, standard library only, each with `--help`. Run them for arithmetic and checks; do not redo sums in the prompt.
- The hub only reads from Google Ads, GA4, Search Console and PostHog. Never write to an ad account; propose changes and let the owner apply them.
- Lead contact details go to the sales channel only, never into reports, examples or issues.

## Changing the pack
- Keep `SKILL.md` under 500 lines; detail goes in `references/`.
- Worker changes must pass the offline test: `cd templates/worker && npm test` (Node 22+, prints `SMOKE OK`).
- Script changes: re-run the examples and update the outputs in `examples/acme-coffee/`:
  ```
  python3 skills/marketing-report/scripts/digest.py examples/acme-coffee/snapshot.json
  python3 skills/tracking-plan/scripts/utm.py lint --csv examples/acme-coffee/links.csv
  python3 skills/traffic-diagnosis/scripts/compare.py --csv examples/acme-coffee/ab-test.csv
  python3 skills/lead-alerts/scripts/send_test_lead.py --payload examples/acme-coffee/lead.json --dry-run
  python3 skills/analytics-hub-setup/scripts/check_config.py --toml templates/worker/wrangler.toml.example
  ```
- Fail visibly: a new source must write its status to `sync_log` and show in the report.

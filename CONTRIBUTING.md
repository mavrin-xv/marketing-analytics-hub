# Contributing

Issues and pull requests are welcome.

- **Bug:** include the `sync_log` row from `/api/status` and the error message, with ids and keys removed.
- **New source** (Meta Ads, Bing, Plausible): add `src/sources/<name>.js` returning `{metrics, dims}` in the long format, a cron slot, a mock in `test/smoke.mjs`, and a section in `skills/analytics-hub-setup/references/sources-setup.md`.
- **Report or flag changes:** show before and after on `examples/acme-coffee/snapshot.json`.
- Scripts stay standard-library only. The worker has no runtime dependencies.
- Plain English in docs. No invented benchmarks; example companies are fictional.

By contributing you agree your work is released under the MIT license.

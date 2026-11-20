# UTM rules

| Parameter | Rule | Example |
|---|---|---|
| `utm_source` | the site or list that sends the click, lowercase | `newsletter`, `facebook`, `linkedin`, `partner-directory` |
| `utm_medium` | one of GA4's default channel mediums | `email`, `cpc`, `paid_social`, `social`, `referral`, `affiliate`, `display` |
| `utm_campaign` | `yyyy-mm-name` | `2026-11-wholesale` |
| `utm_content` | optional: which link or creative | `hero-button`, `video-a` |
| `utm_term` | optional: paid keyword, usually filled by the ad platform | |

## Why these rules

- GA4 matches values case-sensitively. `Facebook` and `facebook` become two sources.
- GA4 assigns a channel from `utm_medium`. A medium it does not know (`bio`, `post`, `Paid Social` with a space) lands in Unassigned. Check GA4's "default channel group" documentation for the current list.
- Google Ads auto-tagging (gclid) is more accurate than manual UTMs for Ads traffic. Manual UTMs on ad URLs can override it and break the Ads to GA4 link.
- Internal links with UTMs start a new session and overwrite the real source. Never tag links between your own pages.
- Link shorteners and http links can drop the query string on redirect.

## Aliases the linter normalises

`fb` becomes `facebook`; `ig` becomes `instagram`; `li` becomes `linkedin`; `tw` and `twitter` become `x`; `yt` becomes `youtube`; `google_ads` and `adwords` become `google`. The accepted mediums are in `MEDIUMS`. Edit `SOURCE_ALIASES` and `MEDIUMS` in `scripts/utm.py` to match your team.

## Build a link

```
python3 skills/tracking-plan/scripts/utm.py build --url https://acme-coffee.com/wholesale --source newsletter --medium email --campaign 2026-11-wholesale
```

## Lint a list

```
python3 skills/tracking-plan/scripts/utm.py lint --csv examples/acme-coffee/links.csv
```

The sample output is `examples/acme-coffee/links-lint.txt`.

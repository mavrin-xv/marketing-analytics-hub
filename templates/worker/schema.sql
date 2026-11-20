-- marketing-analytics-hub D1 schema.
-- Long format on purpose: adding a metric or a dimension is a new row, never a migration.
-- Apply with: npx wrangler d1 execute <db-name> --remote --file=schema.sql

-- One number per day, source, host and metric. host = 'all' for account-wide sources (Google Ads).
CREATE TABLE IF NOT EXISTS daily_metrics (
  day    TEXT NOT NULL,          -- YYYY-MM-DD, UTC for PostHog, property time zone for GA4/GSC/Ads
  source TEXT NOT NULL,          -- ga4 | gsc | posthog | ads
  host   TEXT NOT NULL,          -- example.com, or 'all'
  metric TEXT NOT NULL,          -- sessions, users, clicks, spend, leads, ...
  value  REAL NOT NULL,
  PRIMARY KEY (day, source, host, metric)
);
-- Every read filters on source and a day range. Without these indexes D1 scans the table on each
-- dashboard load and you hit the free-plan read cap (5M rows/day) within weeks.
CREATE INDEX IF NOT EXISTS idx_dm_source_day_host ON daily_metrics (source, day, host);

-- Breakdowns: top pages, queries, channels, countries, campaigns, events.
CREATE TABLE IF NOT EXISTS dim_daily (
  day    TEXT NOT NULL,
  source TEXT NOT NULL,
  host   TEXT NOT NULL,
  dim    TEXT NOT NULL,          -- page | query | channel | country | device | campaign | event | referrer | ai_ref
  key    TEXT NOT NULL,          -- the dimension value, e.g. '/pricing' or 'organic search'
  metric TEXT NOT NULL,
  value  REAL NOT NULL,
  PRIMARY KEY (day, source, host, dim, key, metric)
);
CREATE INDEX IF NOT EXISTS idx_dd_source_dim_day ON dim_daily (source, dim, day);

-- One row per pull. 'partial' means the API answered but returned nothing for a range that should
-- have data: the most common silent failure (expired grant, wrong property id, filter typo).
CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  status     TEXT NOT NULL,      -- running | ok | partial | error
  range_from TEXT,
  range_to   TEXT,
  rows_total INTEGER DEFAULT 0,
  rows_written INTEGER DEFAULT 0,
  message    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_source_started ON sync_log (source, started_at);

-- Leads received on /hook/lead. Kept so the morning report can count them and so a failed
-- Slack/Telegram post can be replayed.
CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  source      TEXT,              -- form id, page path, or 'posthog'
  name        TEXT,
  contact     TEXT,
  message     TEXT,
  utm         TEXT,              -- JSON string of utm_* fields
  delivered   INTEGER DEFAULT 0, -- 1 once at least one channel accepted it
  test        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leads_received ON leads (received_at);

-- Small key/value store: response cache (key prefix 'resp:'), last report sent, settings.
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER             -- unix seconds, NULL = never
);

-- Free-text notes that the report and the dashboard show next to a day ("new pricing page live").
CREATE TABLE IF NOT EXISTS annotations (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  day  TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'all',
  note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_day ON annotations (day);

// Pull -> delta write -> log. Every run leaves one sync_log row, and every failure is loud.
import { pullAds } from './sources/ads.js';
import { pullGA4 } from './sources/ga4.js';
import { pullGSC } from './sources/gsc.js';
import { pullPostHog } from './sources/posthog.js';
import { notify } from './report.js';
import { addDays, chunk, hosts, SEP, todayUTC } from './util.js';

// Which days each source re-pulls on the daily run. GA4, PostHog and Ads revise the last couple of
// days; Search Console publishes with a 2-3 day lag, so its window starts later and ends earlier.
export const WINDOWS = {
  posthog: { from: -3, to: -1 },
  ga4: { from: -3, to: -1 },
  gsc: { from: -5, to: -2 },
  ads: { from: -3, to: -1 },
};

export function configured(env, source) {
  if (source === 'ga4') return Boolean(env.GA4_PROPERTY_ID && env.GOOGLE_SA_JSON);
  if (source === 'gsc') return Boolean(env.GSC_SITES && env.GOOGLE_SA_JSON);
  if (source === 'posthog') return Boolean(env.POSTHOG_PROJECT_ID && env.POSTHOG_API_KEY);
  if (source === 'ads') return Boolean(env.ADS_CUSTOMER_ID && env.ADS_DEVELOPER_TOKEN && env.ADS_REFRESH_TOKEN);
  return false;
}

const PULL = {
  ga4: (env, f, t) => pullGA4(env, f, t, hosts(env)),
  gsc: (env, f, t) => pullGSC(env, f, t),
  posthog: (env, f, t) => pullPostHog(env, f, t, hosts(env)),
  ads: (env, f, t) => pullAds(env, f, t),
};

const mKey = (r) => [r.day, r.source, r.host, r.metric].join(SEP);
const dKey = (r) => [r.day, r.source, r.host, r.dim, r.key, r.metric].join(SEP);

// The same primary key can show up twice in one pull (GA4 "www." and bare host fold into one).
// Sum them: both are slices of the same day.
export function fold(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const hit = map.get(k);
    if (hit) hit.value += r.value;
    else map.set(k, { ...r });
  }
  return [...map.values()];
}

async function existing(db, table, source, from, to) {
  const res = await db.prepare(`SELECT * FROM ${table} WHERE source = ? AND day >= ? AND day <= ?`).bind(source, from, to).all();
  return res.results || [];
}

// Delta write: read what is stored, write only rows whose value changed, delete keys that a complete
// pull no longer returns. The free plan allows 100k row writes a day; rewriting everything every
// morning eats that in a few weeks of history.
export async function writeDelta(db, table, source, from, to, rows) {
  const keyFn = table === 'daily_metrics' ? mKey : dKey;
  const cols = table === 'daily_metrics' ? ['day', 'source', 'host', 'metric', 'value'] : ['day', 'source', 'host', 'dim', 'key', 'metric', 'value'];
  const old = new Map((await existing(db, table, source, from, to)).map((r) => [keyFn(r), r.value]));
  const fresh = fold(rows, keyFn);
  const changed = fresh.filter((r) => {
    const prev = old.get(keyFn(r));
    return prev === undefined || Math.abs(prev - r.value) > 1e-9;
  });
  const freshKeys = new Set(fresh.map(keyFn));
  // An empty pull never deletes: that is the 'partial' case and the stored data is the last good copy.
  const stale = fresh.length ? [...old.keys()].filter((k) => !freshKeys.has(k)) : [];
  const pk = cols.filter((c) => c !== 'value');

  const upsert = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
    ON CONFLICT (${pk.join(',')}) DO UPDATE SET value = excluded.value`;
  for (const part of chunk(changed, 80)) {
    await db.batch(part.map((r) => db.prepare(upsert).bind(...cols.map((c) => r[c]))));
  }
  const del = `DELETE FROM ${table} WHERE ${pk.map((c) => `${c} = ?`).join(' AND ')}`;
  for (const part of chunk(stale, 80)) {
    await db.batch(part.map((k) => db.prepare(del).bind(...k.split(SEP))));
  }
  return { total: fresh.length, written: changed.length, deleted: stale.length };
}

async function logStart(db, source, from, to) {
  const r = await db.prepare(`INSERT INTO sync_log (source, started_at, status, range_from, range_to) VALUES (?, ?, 'running', ?, ?) RETURNING id`)
    .bind(source, new Date().toISOString(), from, to).first();
  return r.id;
}

async function logEnd(db, id, status, total, written, message) {
  await db.prepare(`UPDATE sync_log SET ended_at = ?, status = ?, rows_total = ?, rows_written = ?, message = ? WHERE id = ?`)
    .bind(new Date().toISOString(), status, total, written, message || null, id).run();
}

// A Worker killed mid-run (CPU limit, deploy) leaves 'running' rows forever. Close them as errors.
export async function sweepStuck(db) {
  const cutoff = new Date(Date.now() - 30 * 60000).toISOString();
  const res = await db.prepare(`UPDATE sync_log SET status = 'error', ended_at = ?, message = 'stuck in running for 30+ min, closed by sweep'
    WHERE status = 'running' AND started_at < ? RETURNING source`).bind(new Date().toISOString(), cutoff).all();
  return (res.results || []).map((r) => r.source);
}

// Alert on the second failure in a row, not the first: APIs blip, and an alert that cries wolf
// every week gets muted.
async function maybeAlert(env, source) {
  const res = await env.DB.prepare(`SELECT status, message FROM sync_log WHERE source = ? AND status != 'running' ORDER BY id DESC LIMIT 2`).bind(source).all();
  const last = res.results || [];
  if (last.length === 2 && last.every((r) => r.status !== 'ok')) {
    await notify(env, `Sync problem: ${source} failed twice in a row.\nLast: ${last[0].status}: ${String(last[0].message || '').slice(0, 300)}`, { kind: 'ops' });
  }
}

export async function pullSource(env, source, from, to) {
  if (!configured(env, source)) return { source, status: 'skipped', message: 'not configured' };
  const id = await logStart(env.DB, source, from, to);
  try {
    const { metrics, dims } = await PULL[source](env, from, to);
    const m = await writeDelta(env.DB, 'daily_metrics', source, from, to, metrics);
    const d = await writeDelta(env.DB, 'dim_daily', source, from, to, dims);
    const total = m.total + d.total;
    // Zero rows for a range that should have data is a failure that looks like success.
    const status = m.total === 0 ? 'partial' : 'ok';
    const message = status === 'partial' ? 'API answered with zero rows for the range' : `deleted ${m.deleted + d.deleted} stale`;
    await logEnd(env.DB, id, status, total, m.written + d.written, message);
    if (status !== 'ok') await maybeAlert(env, source);
    return { source, status, total, written: m.written + d.written };
  } catch (e) {
    await logEnd(env.DB, id, 'error', 0, 0, String(e.message || e).slice(0, 1000));
    await maybeAlert(env, source);
    return { source, status: 'error', message: String(e.message || e) };
  }
}

export async function purgeResponseCache(db) {
  await db.prepare(`DELETE FROM kv WHERE key >= 'resp:' AND key < 'resp;'`).run();
}

export async function runDailySource(env, source, today = todayUTC()) {
  const w = WINDOWS[source];
  const swept = await sweepStuck(env.DB);
  if (swept.length) await notify(env, `Closed stuck sync runs: ${swept.join(', ')}`, { kind: 'ops' });
  const r = await pullSource(env, source, addDays(today, w.from), addDays(today, w.to));
  await purgeResponseCache(env.DB);
  return r;
}

// Backfill in 30-day slices so each call stays under the subrequest cap. Call it once per slice
// from /api/sync?source=ga4&from=...&to=..., or with scripts in the setup skill.
export async function runBackfill(env, source, from, to) {
  const out = [];
  for (let f = from; f <= to; f = addDays(f, 30)) {
    const t = addDays(f, 29) < to ? addDays(f, 29) : to;
    out.push(await pullSource(env, source, f, t));
  }
  await purgeResponseCache(env.DB);
  return out;
}

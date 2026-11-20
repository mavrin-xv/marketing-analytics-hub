// JSON API for the dashboard. Every handler returns { data, error }. Reads come only from D1, so
// the dashboard stays up when an upstream API is down; it shows the last good copy.
import { composeReport, snapshot } from './report.js';
import { configured, runBackfill, WINDOWS } from './sync.js';
import { addDays, daysBetween, json, todayUTC } from './util.js';

const SOURCES = ['ga4', 'posthog', 'gsc', 'ads'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL = 6 * 3600; // seconds; every sync purges it anyway

export function period(url) {
  const to = url.searchParams.get('to') || addDays(todayUTC(), -1);
  const from = url.searchParams.get('from') || addDays(to, -27);
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new Error('bad date range');
  if (daysBetween(from, to) > 400) throw new Error('range too long (max 400 days)');
  const len = daysBetween(from, to);
  return { from, to, prevFrom: addDays(from, -len), prevTo: addDays(from, -1), host: url.searchParams.get('host') || 'all' };
}

// Response cache in D1. Keys start with 'resp:' so one range delete clears them all.
async function cached(env, key, fn) {
  const k = 'resp:' + key;
  const hit = await env.DB.prepare('SELECT value FROM kv WHERE key = ? AND expires_at > ?').bind(k, Math.floor(Date.now() / 1000)).first();
  if (hit) return JSON.parse(hit.value);
  const value = await fn();
  await env.DB.prepare('INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
    .bind(k, JSON.stringify(value), Math.floor(Date.now() / 1000) + CACHE_TTL).run();
  return value;
}

// Which sources have data for this host at all. Ads is account-wide (host 'all').
async function coverage(db, host) {
  const out = {};
  for (const s of SOURCES) {
    const h = s === 'ads' ? 'all' : host;
    const sql = h === 'all'
      ? 'SELECT MIN(day) AS first, MAX(day) AS last FROM daily_metrics WHERE source = ?'
      : 'SELECT MIN(day) AS first, MAX(day) AS last FROM daily_metrics WHERE source = ? AND host = ?';
    const r = await db.prepare(sql).bind(...(h === 'all' ? [s] : [s, h])).first();
    out[s] = r && r.first ? r : null;
  }
  return out;
}

async function sums(db, source, from, to, host) {
  const useHost = host !== 'all' && source !== 'ads';
  const res = await db.prepare(`SELECT metric, SUM(value) AS v FROM daily_metrics WHERE source = ? AND day >= ? AND day <= ?${useHost ? ' AND host = ?' : ''} GROUP BY metric`)
    .bind(...(useHost ? [source, from, to, host] : [source, from, to])).all();
  return Object.fromEntries((res.results || []).map((r) => [r.metric, r.v]));
}

export async function overview(env, url) {
  const p = period(url);
  return cached(env, `overview:${p.from}:${p.to}:${p.host}`, async () => {
    const cov = await coverage(env.DB, p.host);
    const out = { ...p, coverage: cov, sources: {} };
    for (const s of SOURCES) {
      // A source with no data for this host renders n/a, never 0.
      if (!cov[s]) { out.sources[s] = null; continue; }
      const cur = await sums(env.DB, s, p.from, p.to, p.host);
      // Drop the comparison when the previous window starts before the first stored day.
      const prevCovered = cov[s].first <= p.prevFrom;
      out.sources[s] = { cur, prev: prevCovered ? await sums(env.DB, s, p.prevFrom, p.prevTo, p.host) : null };
    }
    return out;
  });
}

export async function seriesH(env, url) {
  const p = period(url);
  const source = url.searchParams.get('source');
  const metric = url.searchParams.get('metric');
  if (!SOURCES.includes(source) || !/^[a-z0-9_$]+$/i.test(metric || '')) throw new Error('bad source or metric');
  const useHost = p.host !== 'all' && source !== 'ads';
  const res = await env.DB.prepare(`SELECT day, SUM(value) AS v FROM daily_metrics WHERE source = ? AND metric = ? AND day >= ? AND day <= ?${useHost ? ' AND host = ?' : ''} GROUP BY day ORDER BY day`)
    .bind(...(useHost ? [source, metric, p.from, p.to, p.host] : [source, metric, p.from, p.to])).all();
  return { ...p, source, metric, points: res.results || [] };
}

export async function dim(env, url) {
  const p = period(url);
  const source = url.searchParams.get('source');
  const d = url.searchParams.get('dim');
  const metric = url.searchParams.get('metric');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 200);
  if (!SOURCES.includes(source) || !/^[a-z_]+$/.test(d || '') || !/^[a-z0-9_]+$/.test(metric || '')) throw new Error('bad params');
  return cached(env, `dim:${source}:${d}:${metric}:${p.from}:${p.to}:${p.host}:${limit}`, async () => {
    const useHost = p.host !== 'all' && source !== 'ads';
    const res = await env.DB.prepare(`SELECT key, SUM(value) AS v FROM dim_daily WHERE source = ? AND dim = ? AND metric = ? AND day >= ? AND day <= ?${useHost ? ' AND host = ?' : ''} GROUP BY key ORDER BY v DESC LIMIT ?`)
      .bind(...(useHost ? [source, d, metric, p.from, p.to, p.host, limit] : [source, d, metric, p.from, p.to, limit])).all();
    return { ...p, source, dim: d, metric, rows: res.results || [] };
  });
}

export async function status(env) {
  const res = await env.DB.prepare(`SELECT source, status, started_at, ended_at, rows_total, rows_written, message FROM sync_log ORDER BY id DESC LIMIT 40`).all();
  const configuredMap = Object.fromEntries(SOURCES.map((s) => [s, configured(env, s)]));
  const last = await env.DB.prepare("SELECT value FROM kv WHERE key = 'last_report'").first();
  return { configured: configuredMap, windows: WINDOWS, runs: res.results || [], lastReport: last ? JSON.parse(last.value) : null };
}

export async function reportPreview(env) {
  const snap = await snapshot(env);
  return { text: composeReport(snap), snapshot: snap };
}

export async function syncNow(env, url) {
  const source = url.searchParams.get('source');
  if (!SOURCES.includes(source)) throw new Error('source must be one of ' + SOURCES.join(', '));
  const to = url.searchParams.get('to') || addDays(todayUTC(), WINDOWS[source].to);
  const from = url.searchParams.get('from') || addDays(todayUTC(), WINDOWS[source].from);
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw new Error('bad date');
  return { results: await runBackfill(env, source, from, to) };
}

export async function annotate(env, req) {
  const body = await req.json().catch(() => ({}));
  if (!DAY_RE.test(body.day || '') || !body.note) throw new Error('need day (YYYY-MM-DD) and note');
  await env.DB.prepare('INSERT INTO annotations (day, host, note) VALUES (?, ?, ?)').bind(body.day, body.host || 'all', String(body.note).slice(0, 300)).run();
  await env.DB.prepare(`DELETE FROM kv WHERE key >= 'resp:' AND key < 'resp;'`).run();
  return { ok: true };
}

export async function route(req, env, url) {
  try {
    const p = url.pathname;
    let data;
    if (p === '/api/overview') data = await overview(env, url);
    else if (p === '/api/series') data = await seriesH(env, url);
    else if (p === '/api/dim') data = await dim(env, url);
    else if (p === '/api/status') data = await status(env);
    else if (p === '/api/report') data = await reportPreview(env);
    else if (p === '/api/sync' && req.method === 'POST') data = await syncNow(env, url);
    else if (p === '/api/annotations' && req.method === 'POST') data = await annotate(env, req);
    else return json({ data: null, error: 'not found' }, 404);
    return json({ data, error: null });
  } catch (e) {
    return json({ data: null, error: String(e.message || e) }, 400);
  }
}

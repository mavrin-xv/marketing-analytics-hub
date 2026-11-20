// Morning report: one message, read in under a minute, same layout every day.
// "How many" comes from GA4, "why" from PostHog, search from Search Console, money from Google Ads.
import { addDays, hosts, todayUTC } from './util.js';

const TG_LIMIT = 4000; // Telegram rejects messages over 4096 characters

// ---------- delivery ----------

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const body = text.length > TG_LIMIT ? text.slice(0, TG_LIMIT - 20) + '\n[cut: too long]' : text;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: body, disable_web_page_preview: true }),
  });
  return res.ok;
}

async function sendSlack(url, text) {
  if (!url) return false;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  return res.ok;
}

// kind: 'report' | 'ops' | 'lead'. Leads prefer the sales webhook when one is set.
export async function notify(env, text, { kind = 'report' } = {}) {
  const channels = String(env.REPORT_CHANNELS || 'telegram').split(',').map((s) => s.trim());
  const results = [];
  if (channels.includes('telegram')) results.push(await sendTelegram(env, text).catch(() => false));
  if (channels.includes('slack') || kind === 'lead') {
    const url = kind === 'lead' ? env.SLACK_LEADS_WEBHOOK_URL || env.SLACK_WEBHOOK_URL : env.SLACK_WEBHOOK_URL;
    results.push(await sendSlack(url, text).catch(() => false));
  }
  return results.some(Boolean);
}

// ---------- data ----------

async function sums(db, source, from, to, host) {
  const hostSQL = host === 'all' ? '' : ' AND host = ?';
  const args = host === 'all' ? [source, from, to] : [source, from, to, host];
  const res = await db.prepare(`SELECT metric, SUM(value) AS v, COUNT(DISTINCT day) AS days FROM daily_metrics
    WHERE source = ? AND day >= ? AND day <= ?${hostSQL} GROUP BY metric`).bind(...args).all();
  const out = { _days: 0 };
  for (const r of res.results || []) {
    out[r.metric] = r.v;
    out._days = Math.max(out._days, r.days);
  }
  return out;
}

async function top(db, source, dim, metric, from, to, limit = 3) {
  const res = await db.prepare(`SELECT key, SUM(value) AS v FROM dim_daily WHERE source = ? AND dim = ? AND metric = ?
    AND day >= ? AND day <= ? GROUP BY key ORDER BY v DESC LIMIT ?`).bind(source, dim, metric, from, to, limit).all();
  return (res.results || []).map((r) => [r.key, r.v]);
}

async function lastSync(db) {
  const res = await db.prepare(`SELECT source, status, ended_at, message FROM sync_log WHERE id IN
    (SELECT MAX(id) FROM sync_log WHERE status != 'running' GROUP BY source)`).all();
  return Object.fromEntries((res.results || []).map((r) => [r.source, r]));
}

// Collects everything the report needs into one plain object. Pure data, so it can be tested,
// returned from /api/report.json and formatted by scripts/digest.py the same way.
export async function snapshot(env, today = todayUTC()) {
  const db = env.DB;
  const day = addDays(today, -1);
  const cur = { from: addDays(day, -6), to: day };
  const prev = { from: addDays(day, -13), to: addDays(day, -7) };
  const gscTo = addDays(today, -3);
  const gscCur = { from: addDays(gscTo, -6), to: gscTo };
  const gscPrev = { from: addDays(gscTo, -13), to: addDays(gscTo, -7) };
  const sources = ['ga4', 'posthog', 'gsc', 'ads'];
  const out = { day, hosts: hosts(env), windows: { cur, prev, gscCur, gscPrev }, sources: {}, sync: await lastSync(db) };
  for (const s of sources) {
    const c = s === 'gsc' ? gscCur : cur;
    const p = s === 'gsc' ? gscPrev : prev;
    out.sources[s] = {
      yesterday: s === 'gsc' ? null : await sums(db, s, day, day, 'all'),
      cur: await sums(db, s, c.from, c.to, 'all'),
      prev: await sums(db, s, p.from, p.to, 'all'),
    };
  }
  out.top = {
    channels: await top(db, 'ga4', 'channel', 'sessions', cur.from, cur.to, 4),
    leadPages: await top(db, 'posthog', 'lead_page', 'users', cur.from, cur.to, 3),
    aiRefs: await top(db, 'posthog', 'ai_ref', 'users', cur.from, cur.to, 3),
    referrers: await top(db, 'posthog', 'referrer', 'users', cur.from, cur.to, 5),
    queries: await top(db, 'gsc', 'query', 'clicks', gscCur.from, gscCur.to, 3),
    campaigns: await top(db, 'ads', 'campaign', 'spend', cur.from, cur.to, 3),
  };
  const leads = await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE test = 0 AND substr(received_at, 1, 10) = ?`).bind(day).first();
  const leads7 = await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE test = 0 AND substr(received_at, 1, 10) >= ? AND substr(received_at, 1, 10) <= ?`).bind(cur.from, cur.to).first();
  // Impression share is a share, never a sum: weight each day by its eligible impressions.
  const isRow = await db.prepare(`SELECT SUM(s.value * e.value) / SUM(e.value) AS search_is,
      SUM(r.value * e.value) / SUM(e.value) AS lost_rank, SUM(b.value * e.value) / SUM(e.value) AS lost_budget
    FROM daily_metrics e
    JOIN daily_metrics s ON s.day = e.day AND s.source = 'ads' AND s.metric = 'search_is'
    JOIN daily_metrics r ON r.day = e.day AND r.source = 'ads' AND r.metric = 'lost_is_rank'
    JOIN daily_metrics b ON b.day = e.day AND b.source = 'ads' AND b.metric = 'lost_is_budget'
    WHERE e.source = 'ads' AND e.metric = 'eligible_impr' AND e.day >= ? AND e.day <= ?`).bind(cur.from, cur.to).first();
  out.impressionShare = isRow && isRow.search_is !== null ? isRow : null;
  out.leads = { yesterday: leads?.n || 0, cur: leads7?.n || 0 };
  out.leadEvents = String(env.LEAD_EVENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  out.dashboard = env.DASHBOARD_URL || '';
  const notes = await db.prepare(`SELECT day, note FROM annotations WHERE day >= ? AND day <= ? ORDER BY day`).bind(cur.from, cur.to).all();
  out.notes = notes.results || [];
  return out;
}

// ---------- formatting ----------

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));

// Week-over-week change. No previous data (new source, gap) means no delta: printing +1800%
// because last week was empty is the fastest way to lose a reader's trust.
export function delta(cur, prev, curDays = 7, prevDays = 7) {
  if (cur === undefined || prev === undefined || prev === null || prev === 0) return '';
  if (prevDays < 7 || curDays < 7) return ' (prev week incomplete)';
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return ' (flat)';
  return ` (${pct > 0 ? '+' : ''}${pct.toFixed(0)}% wow)`;
}

function line(label, s, metric, d = 0) {
  const v = s.cur[metric];
  return `${label}: ${fmt(v, d)}${delta(v, s.prev[metric], s.cur._days, s.prev._days)}`;
}

export function composeReport(snap) {
  const L = [];
  const S = snap.sources;
  const connected = (k) => S[k] && S[k].cur._days > 0;
  L.push(`Marketing report for ${snap.day}. Last 7 days vs the 7 before.`);

  L.push('', 'HOW MANY (GA4)');
  if (connected('ga4')) {
    L.push(`Yesterday: ${fmt(S.ga4.yesterday.sessions)} sessions, ${fmt(S.ga4.yesterday.key_events)} key events`);
    L.push(line('Sessions 7d', S.ga4, 'sessions'), line('Users 7d', S.ga4, 'users'), line('Key events 7d', S.ga4, 'key_events'));
    if (snap.top.channels.length) L.push('Channels: ' + snap.top.channels.map(([k, v]) => `${k} ${fmt(v)}`).join(', '));
  } else L.push('not connected or no data yet');

  L.push('', 'WHY (PostHog)');
  if (connected('posthog')) {
    for (const ev of snap.leadEvents) {
      if (S.posthog.cur[`${ev}_users`] !== undefined) L.push(line(`${ev} people 7d`, S.posthog, `${ev}_users`));
    }
    const people = S.posthog.cur.users;
    const first = snap.leadEvents[0];
    const leadPeople = first ? S.posthog.cur[`${first}_users`] : undefined;
    if (people && leadPeople !== undefined) L.push(`${first} rate: ${fmt((leadPeople / people) * 100, 2)}% of people (people over people)`);
    if (snap.top.leadPages.length) L.push('Leads start on: ' + snap.top.leadPages.map(([k, v]) => `${k} (${fmt(v)})`).join(', '));
    if (snap.top.aiRefs.length) L.push('AI assistants sent: ' + snap.top.aiRefs.map(([k, v]) => `${k} ${fmt(v)}`).join(', '));
  } else L.push('not connected or no data yet');

  L.push('', `SEARCH (Search Console, ${snap.windows.gscCur.from}..${snap.windows.gscCur.to}, data lags 2-3 days)`);
  if (connected('gsc')) {
    L.push(line('Clicks', S.gsc, 'clicks'), line('Impressions', S.gsc, 'impressions'));
    const pos = S.gsc.cur.impressions ? S.gsc.cur.pos_x_impr / S.gsc.cur.impressions : null;
    L.push(`Avg position: ${fmt(pos, 1)} (impression-weighted)`);
    if (snap.top.queries.length) L.push('Top queries: ' + snap.top.queries.map(([k, v]) => `"${k}" ${fmt(v)}`).join(', '));
  } else L.push('not connected or no data yet');

  L.push('', 'ADS (Google Ads)');
  if (connected('ads')) {
    const a = S.ads.cur;
    L.push(line('Spend 7d', S.ads, 'spend', 2), line('Conversions 7d', S.ads, 'conversions', 1));
    L.push(`Cost per conversion: ${a.conversions ? fmt(a.spend / a.conversions, 2) : 'n/a (no conversions)'}`);
    const is = snap.impressionShare;
    if (is) {
      const pct = (v) => `${fmt(v * 100)}%`;
      L.push(`Search impression share ${pct(is.search_is)}, lost to rank ${pct(is.lost_rank)}, lost to budget ${pct(is.lost_budget)}`);
    }
    if (snap.top.campaigns.length) L.push('Top spend: ' + snap.top.campaigns.map(([k, v]) => `${k} ${fmt(v, 2)}`).join(', '));
  } else L.push('not connected or no data yet');

  L.push('', `LEADS: ${snap.leads.yesterday} yesterday, ${snap.leads.cur} in 7 days (webhook, tests excluded)`);
  if (snap.notes.length) L.push('Notes: ' + snap.notes.map((n) => `${n.day} ${n.note}`).join('; '));

  const bad = Object.values(snap.sync).filter((r) => r.status !== 'ok');
  if (bad.length) L.push('', 'DATA HEALTH: ' + bad.map((r) => `${r.source} ${r.status}`).join(', ') + '. Numbers above may be stale for these.');
  if (snap.dashboard) L.push('', snap.dashboard);
  return L.join('\n');
}

export async function sendMorningReport(env, today = todayUTC()) {
  const snap = await snapshot(env, today);
  const text = composeReport(snap);
  const sent = await notify(env, text, { kind: 'report' });
  await env.DB.prepare(`INSERT INTO kv (key, value) VALUES ('last_report', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(JSON.stringify({ at: new Date().toISOString(), sent })).run();
  return { sent, text };
}

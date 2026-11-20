// Offline smoke test: runs the real worker code against an in-memory SQLite (shaped like D1) and a
// fake fetch that answers like GA4, Search Console, Google Ads, PostHog, Telegram and Slack.
// No network, no keys. Run: node --experimental-sqlite test/smoke.mjs   (Node 22+)
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

import worker, { runSlot } from '../src/index.js';
import { makeCookie } from '../src/auth.js';
import { writeDelta } from '../src/sync.js';
import { addDays, todayUTC } from '../src/util.js';

// ---------- D1 shim ----------
function d1(sqlite) {
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  return { prepare: (sql) => wrap(sql), batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) };
}
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const DB = d1(sqlite);

// ---------- env ----------
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  DB,
  ASSETS: { fetch: async () => new Response('<html>dashboard</html>', { headers: { 'content-type': 'text/html' } }) },
  HOSTS: 'acme-coffee.com',
  REPORT_CHANNELS: 'telegram,slack',
  GA4_PROPERTY_ID: '123456789',
  GSC_SITES: 'sc-domain:acme-coffee.com',
  POSTHOG_HOST: 'https://eu.posthog.com', POSTHOG_PROJECT_ID: '1', POSTHOG_API_KEY: 'phx_test',
  POSTHOG_EXCLUDE_HOSTS: 'localhost',
  ADS_CUSTOMER_ID: '1112223333', ADS_DEVELOPER_TOKEN: 'dev', ADS_CLIENT_ID: 'c', ADS_CLIENT_SECRET: 's', ADS_REFRESH_TOKEN: 'r',
  LEAD_EVENTS: 'form_submitted,contact_clicked',
  GOOGLE_SA_JSON: JSON.stringify({ client_email: 'hub-reader', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
  TELEGRAM_BOT_TOKEN: '1:test', TELEGRAM_CHAT_ID: '42',
  SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x',
  LEAD_HOOK_SECRET: 'hook-secret', DASHBOARD_PASSWORD: 'pw', SESSION_SECRET: 'x'.repeat(32),
};

// ---------- fake upstream APIs ----------
const today = todayUTC();
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const sent = [];
const calls = {};
const count = (k) => { calls[k] = (calls[k] || 0) + 1; };

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : {};
  const ok = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) { count('token'); return ok({ access_token: 'tok', expires_in: 3600 }); }
  if (url.includes('analyticsdata.googleapis.com')) {
    count('ga4');
    const { startDate, endDate } = body.dateRanges[0];
    const extra = body.dimensions.slice(2).map((d) => d.name)[0];
    const keys = { sessionDefaultChannelGroup: ['Organic Search', 'Direct', 'Paid Search'], eventName: ['generate_lead'] }[extra] || (extra ? ['/'] : [null]);
    const rows = [];
    for (const d of days(startDate, endDate)) for (const k of keys) {
      rows.push({ dimensionValues: [{ value: d.replace(/-/g, '') }, { value: 'www.acme-coffee.com' }, ...(k ? [{ value: k }] : [])],
        metricValues: body.metrics.map((m, i) => ({ value: String(100 + i * 10) })) });
    }
    return ok({ rows });
  }
  if (url.includes('searchAnalytics/query')) {
    count('gsc');
    const rows = days(body.startDate, body.endDate).map((d) => ({ keys: body.dimensions.length > 1 ? [d, 'cold brew subscription'] : [d], clicks: 40, impressions: 900, position: 7.5 }));
    return ok({ rows });
  }
  if (url.includes('googleads.googleapis.com')) {
    count('ads');
    assert.equal(init.headers['developer-token'], 'dev');
    const q = body.query;
    const [, from, to] = q.match(/BETWEEN '([\d-]+)' AND '([\d-]+)'/);
    const ds = days(from, to).slice(0, -1); // last day has no spend: zeros must still be written
    if (q.includes('FROM campaign') && q.includes('search_impression_share')) {
      return ok([{ results: ds.map((d) => ({ segments: { date: d }, campaign: { name: 'Brand', biddingStrategyType: 'TARGET_SPEND' },
        metrics: { impressions: '800', clicks: '60', costMicros: '45500000', conversions: 3, conversionsValue: 0, searchImpressionShare: 0.8, searchRankLostImpressionShare: 0.15, searchBudgetLostImpressionShare: 0.05 } })) }]);
    }
    if (q.includes('search_term_view')) return ok([{ results: ds.map((d) => ({ segments: { date: d }, searchTermView: { searchTerm: 'acme coffee beans' }, metrics: { clicks: '20', costMicros: '9000000', conversions: 1 } })) }]);
    return ok([{ results: ds.map((d) => ({ segments: { date: d, conversionActionName: 'Lead form' }, metrics: { conversions: 3 } })) }]);
  }
  if (url.includes('posthog.com')) {
    count('posthog');
    const q = body.query.query;
    assert.match(q, /LIMIT \d+\s*$/, 'every HogQL query must carry a LIMIT');
    assert.match(q, /properties\.\$host NOT IN \('localhost'\)/, 'staging hosts must be excluded by hand');
    const [, from] = q.match(/toDateTime\('([\d-]+) 00:00:00'\)/);
    const ds = days(from, addDays(today, -1));
    let results = [];
    if (q.includes("event = '$pageview'") && q.includes('count(DISTINCT $session_id)')) results = ds.map((d) => [d, 'www.acme-coffee.com', 300, 120, 140]);
    else if (q.includes('GROUP BY d, h, event')) results = ds.flatMap((d) => [[d, 'acme-coffee.com', 'form_submitted', 5, 4], [d, 'acme-coffee.com', 'contact_clicked', 12, 9]]);
    else if (q.includes('lead_page') || (q.includes('$pathname') && q.includes('event IN'))) results = ds.map((d) => [d, 'acme-coffee.com', '/wholesale', 4]);
    else if (q.includes('$pathname')) results = ds.map((d) => [d, 'acme-coffee.com', '/', 200, 90]);
    else if (q.includes('$referring_domain')) results = ds.flatMap((d) => [[d, 'acme-coffee.com', 'www.google.com', 60], [d, 'acme-coffee.com', 'chatgpt.com', 6]]);
    else if (q.includes('geoip')) results = ds.map((d) => [d, 'acme-coffee.com', 'US', 70]);
    return ok({ results });
  }
  if (url.startsWith('https://api.telegram.org/')) { sent.push({ to: 'telegram', text: body.text }); return ok({ ok: true }); }
  if (url.startsWith('https://hooks.slack.com/')) { sent.push({ to: 'slack', text: body.text }); return ok({ ok: true }); }
  throw new Error('unexpected fetch ' + url);
};

// ---------- run ----------
for (const job of ['posthog', 'ga4', 'gsc', 'ads']) {
  const r = await runSlot(env, job);
  assert.equal(r.status, 'ok', `${job} sync should be ok, got ${JSON.stringify(r)}`);
}
const runs = sqlite.prepare('SELECT source, status, rows_total, rows_written FROM sync_log').all();
console.log('sync_log:', runs.map((r) => `${r.source}=${r.status} rows=${r.rows_total} written=${r.rows_written}`).join(' | '));

// Second run over the same window must write nothing: delta writes.
const again = await runSlot(env, 'ga4');
assert.equal(again.written, 0, 'unchanged data must not be rewritten');
console.log('delta write on unchanged re-pull: written =', again.written);

// Ads days without spend still get explicit zeros.
const zero = sqlite.prepare("SELECT value FROM daily_metrics WHERE source='ads' AND metric='spend' AND day=?").get(addDays(today, -1));
assert.equal(zero?.value, 0, 'no-spend day must store 0, not be missing');

// An empty pull is 'partial' and keeps the stored rows.
const before = sqlite.prepare("SELECT COUNT(*) AS n FROM daily_metrics WHERE source='gsc'").get().n;
const w = await writeDelta(DB, 'daily_metrics', 'gsc', addDays(today, -5), addDays(today, -2), []);
assert.equal(w.deleted, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM daily_metrics WHERE source='gsc'").get().n, before);

// Lead webhook: wrong secret refused, right secret stored and delivered.
const leadReq = (secret, payload) => new Request('https://hub.example/hook/lead', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hook-secret': secret }, body: JSON.stringify(payload) });
assert.equal((await worker.fetch(leadReq('nope', { contact: 'x' }), env, {})).status, 401);
const lr = await (await worker.fetch(leadReq('hook-secret', { name: 'Dana Ortiz', phone: '+1 555 0100', message: 'Need 40 kg of beans a month for our cafe', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'wholesale' }), env, {})).json();
assert.equal(lr.data.delivered, true);
assert.ok(sent.some((s) => s.to === 'slack' && s.text.startsWith('New lead from')), 'lead goes to Slack');

// API needs the cookie.
assert.equal((await worker.fetch(new Request('https://hub.example/api/overview'), env, {})).status, 401);
const cookie = (await makeCookie(env)).split(';')[0];
const ov = await (await worker.fetch(new Request('https://hub.example/api/overview', { headers: { cookie } }), env, {})).json();
assert.equal(ov.error, null);
assert.ok(ov.data.sources.ga4.cur.sessions > 0);
// The previous 28-day window is not stored, so no fake comparison.
assert.equal(ov.data.sources.ga4.prev, null, 'uncovered previous window must not produce a delta');

// Morning report.
const rep = await runSlot(env, 'report');
assert.ok(rep.sent);
console.log('\n--- morning report as sent ---\n' + rep.text + '\n---');
console.log('\nupstream calls:', JSON.stringify(calls));
console.log('SMOKE OK');

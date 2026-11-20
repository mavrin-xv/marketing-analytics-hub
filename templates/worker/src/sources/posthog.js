// PostHog HogQL: the "why" source. Which pages people read, what they clicked, which referrers
// (AI assistants included) send people who act.
import { fetchJSON, normHost, num, withRetry } from '../util.js';

// Referrer hosts of AI assistants. Extend as new ones show up in your referrer table.
export const AI_REFERRERS = ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'claude.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'you.com', 'phind.com', 'chat.deepseek.com', 'grok.com', 'meta.ai'];

// Headless browsers and monitors that PostHog's own bot filter can miss.
const BOT_UA = '(?i)(headless|bot|crawler|spider|lighthouse|pingdom|preview|slurp|python-requests|curl)';
const HOST = "replaceRegexpOne(properties.$host, '^www\\\\.', '')";

export function sqlList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(',');
}

export async function hogql(env, query) {
  // HogQL returns at most 100 rows when the query has no LIMIT, without saying so. Always set one.
  const q = /\blimit\s+\d+\s*$/i.test(query.trim()) ? query.trim() : `${query.trim()}\nLIMIT 10000`;
  const res = await withRetry(() => fetchJSON(`${env.POSTHOG_HOST}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.POSTHOG_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: q }, name: 'marketing-hub' }),
  }, 'posthog'), { tries: 4 });
  return res.results || [];
}

// The query API does not apply the project's "filter out internal and test users" toggle.
// Every query goes through this WHERE clause instead.
export function baseWhere(env, from, to, hostList) {
  const exclude = String(env.POSTHOG_EXCLUDE_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const parts = [
    `timestamp >= toDateTime('${from} 00:00:00')`,
    `timestamp < toDateTime('${to} 00:00:00') + INTERVAL 1 DAY`,
    `NOT match(coalesce(properties.$raw_user_agent, ''), '${BOT_UA}')`,
  ];
  if (hostList.length) parts.push(`${HOST} IN (${sqlList(hostList)})`);
  if (exclude.length) parts.push(`properties.$host NOT IN (${sqlList(exclude)})`);
  if (env.POSTHOG_INTERNAL_EMAIL_DOMAIN) {
    parts.push(`NOT endsWith(coalesce(person.properties.email, ''), ${sqlList([env.POSTHOG_INTERNAL_EMAIL_DOMAIN])})`);
  }
  return parts.join(' AND ');
}

const dayOf = (d) => String(d).slice(0, 10);

export async function pullPostHog(env, from, to, hostList) {
  const where = baseWhere(env, from, to, hostList);
  const leadEvents = String(env.LEAD_EVENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const metrics = [];
  const dims = [];

  const traffic = await hogql(env, `
    SELECT toDate(timestamp) AS d, ${HOST} AS h, count() AS pv, count(DISTINCT person_id) AS u, count(DISTINCT $session_id) AS s
    FROM events WHERE event = '$pageview' AND ${where} GROUP BY d, h`);
  for (const [d, h, pv, u, s] of traffic) {
    const day = dayOf(d);
    const host = normHost(h);
    metrics.push(
      { day, source: 'posthog', host, metric: 'pageviews', value: num(pv) },
      { day, source: 'posthog', host, metric: 'users', value: num(u) },
      { day, source: 'posthog', host, metric: 'sessions', value: num(s) },
    );
  }

  if (leadEvents.length) {
    // Events and distinct people. A rate is people over people: never divide events by users.
    const ev = await hogql(env, `
      SELECT toDate(timestamp) AS d, ${HOST} AS h, event, count() AS n, count(DISTINCT person_id) AS u
      FROM events WHERE event IN (${sqlList(leadEvents)}) AND ${where} GROUP BY d, h, event`);
    for (const [d, h, event, n, u] of ev) {
      const day = dayOf(d);
      const host = normHost(h);
      metrics.push(
        { day, source: 'posthog', host, metric: event, value: num(n) },
        { day, source: 'posthog', host, metric: `${event}_users`, value: num(u) },
      );
    }
    const evPage = await hogql(env, `
      SELECT toDate(timestamp) AS d, ${HOST} AS h, properties.$pathname AS p, count(DISTINCT person_id) AS u
      FROM events WHERE event IN (${sqlList(leadEvents)}) AND ${where} GROUP BY d, h, p ORDER BY u DESC LIMIT 5000`);
    for (const [d, h, p, u] of evPage) {
      dims.push({ day: dayOf(d), source: 'posthog', host: normHost(h), dim: 'lead_page', key: p || '/', metric: 'users', value: num(u) });
    }
  }

  const pages = await hogql(env, `
    SELECT toDate(timestamp) AS d, ${HOST} AS h, properties.$pathname AS p, count() AS pv, count(DISTINCT person_id) AS u
    FROM events WHERE event = '$pageview' AND ${where} GROUP BY d, h, p ORDER BY pv DESC LIMIT 8000`);
  for (const [d, h, p, pv, u] of pages) {
    const day = dayOf(d);
    const host = normHost(h);
    dims.push(
      { day, source: 'posthog', host, dim: 'page', key: p || '/', metric: 'pageviews', value: num(pv) },
      { day, source: 'posthog', host, dim: 'page', key: p || '/', metric: 'users', value: num(u) },
    );
  }

  const refs = await hogql(env, `
    SELECT toDate(timestamp) AS d, ${HOST} AS h, coalesce(properties.$referring_domain, '$direct') AS r, count(DISTINCT person_id) AS u
    FROM events WHERE event = '$pageview' AND ${where} GROUP BY d, h, r ORDER BY u DESC LIMIT 5000`);
  for (const [d, h, r, u] of refs) {
    const day = dayOf(d);
    const host = normHost(h);
    const ref = r === '$direct' ? '$direct' : normHost(r);
    dims.push({ day, source: 'posthog', host, dim: 'referrer', key: ref, metric: 'users', value: num(u) });
    if (AI_REFERRERS.some((a) => ref === a || ref.endsWith('.' + a))) {
      dims.push({ day, source: 'posthog', host, dim: 'ai_ref', key: ref, metric: 'users', value: num(u) });
    }
  }

  const geo = await hogql(env, `
    SELECT toDate(timestamp) AS d, ${HOST} AS h, coalesce(properties.$geoip_country_code, '??') AS c, count(DISTINCT person_id) AS u
    FROM events WHERE event = '$pageview' AND ${where} GROUP BY d, h, c`);
  for (const [d, h, c, u] of geo) {
    dims.push({ day: dayOf(d), source: 'posthog', host: normHost(h), dim: 'country', key: c, metric: 'users', value: num(u) });
  }
  return { metrics, dims };
}

// GA4 Data API: the "how many" source. Sessions, users, channels, pages, countries, key events.
import { googleToken, SCOPES } from '../google.js';
import { fetchJSON, ga4Day, normHost, num, withRetry } from '../util.js';

const API = 'https://analyticsdata.googleapis.com/v1beta';

// name -> report definition. 'dim' = null means totals per day and host.
export const REPORTS = {
  totals: { dims: [], metrics: ['sessions', 'totalUsers', 'newUsers', 'screenPageViews', 'engagedSessions', 'keyEvents'] },
  channel: { dims: ['sessionDefaultChannelGroup'], metrics: ['sessions', 'keyEvents'], dim: 'channel', limit: 50 },
  source: { dims: ['sessionSourceMedium'], metrics: ['sessions', 'keyEvents'], dim: 'source_medium', limit: 200 },
  landing: { dims: ['landingPagePlusQueryString'], metrics: ['sessions', 'keyEvents'], dim: 'landing', limit: 300 },
  page: { dims: ['pagePath'], metrics: ['screenPageViews', 'totalUsers'], dim: 'page', limit: 300 },
  country: { dims: ['country'], metrics: ['sessions'], dim: 'country', limit: 60 },
  device: { dims: ['deviceCategory'], metrics: ['sessions'], dim: 'device', limit: 10 },
  keyevent: { dims: ['eventName'], metrics: ['keyEvents'], dim: 'keyevent', limit: 50, keepPositive: 'keyEvents' },
};

const METRIC_NAME = {
  sessions: 'sessions', totalUsers: 'users', newUsers: 'new_users', screenPageViews: 'pageviews',
  engagedSessions: 'engaged_sessions', keyEvents: 'key_events',
};

async function runReport(env, token, body) {
  return withRetry(() => fetchJSON(`${API}/properties/${env.GA4_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, 'ga4'));
}

// Returns { metrics: [...rows for daily_metrics], dims: [...rows for dim_daily] }
export async function pullGA4(env, from, to, hostList) {
  const token = await googleToken(env, SCOPES.ga4);
  const metrics = [];
  const dims = [];
  for (const [name, r] of Object.entries(REPORTS)) {
    const body = {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: 'date' }, { name: 'hostName' }, ...r.dims.map((d) => ({ name: d }))],
      metrics: r.metrics.map((m) => ({ name: m })),
      limit: r.limit ? r.limit * 40 : 10000,
      keepEmptyRows: false,
    };
    if (hostList.length) {
      body.dimensionFilter = { filter: { fieldName: 'hostName', inListFilter: { values: hostList.flatMap((h) => [h, 'www.' + h]) } } };
    }
    const res = await runReport(env, token, body);
    for (const row of res.rows || []) {
      const [d, h, key] = row.dimensionValues.map((v) => v.value);
      const day = ga4Day(d);
      const host = normHost(h);
      row.metricValues.forEach((mv, i) => {
        const m = METRIC_NAME[r.metrics[i]];
        const value = num(mv.value);
        if (!r.dim) metrics.push({ day, source: 'ga4', host, metric: m, value });
        else if (!r.keepPositive || (r.metrics[i] === r.keepPositive && value > 0)) {
          dims.push({ day, source: 'ga4', host, dim: r.dim, key: key || '(not set)', metric: m, value });
        }
      });
    }
  }
  return { metrics, dims };
}

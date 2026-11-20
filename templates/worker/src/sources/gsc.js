// Search Console: clicks, impressions and position for Google Search.
// Data lags 2-3 days, so the daily pull asks for days -5..-2 and the report labels it that way.
import { googleToken, SCOPES } from '../google.js';
import { fetchJSON, normHost, num, withRetry } from '../util.js';

const API = 'https://www.googleapis.com/webmasters/v3/sites';

const QUERIES = [
  { dims: ['date'], dim: null },
  { dims: ['date', 'query'], dim: 'query', rowLimit: 5000 },
  { dims: ['date', 'page'], dim: 'page', rowLimit: 5000 },
  { dims: ['date', 'country'], dim: 'country', rowLimit: 1000 },
  { dims: ['date', 'device'], dim: 'device', rowLimit: 100 },
];

function siteHost(site) {
  return normHost(site.replace(/^sc-domain:/, ''));
}

// Position is an average. Store position * impressions so a period average can be weighted
// correctly later: sum(pos_x_impr) / sum(impressions). Averaging daily positions is wrong.
function rowMetrics(r) {
  return { clicks: num(r.clicks), impressions: num(r.impressions), pos_x_impr: num(r.position) * num(r.impressions) };
}

export async function pullGSC(env, from, to) {
  const sites = String(env.GSC_SITES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const token = await googleToken(env, SCOPES.gsc);
  const metrics = [];
  const dims = [];
  for (const site of sites) {
    const host = siteHost(site);
    for (const q of QUERIES) {
      const res = await withRetry(() => fetchJSON(`${API}/${encodeURIComponent(site)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: from, endDate: to, dimensions: q.dims, rowLimit: q.rowLimit || 1000, type: 'web', dataState: 'final' }),
      }, 'gsc'));
      for (const r of res.rows || []) {
        const [day, key] = r.keys;
        for (const [metric, value] of Object.entries(rowMetrics(r))) {
          if (!q.dim) metrics.push({ day, source: 'gsc', host, metric, value });
          else dims.push({ day, source: 'gsc', host, dim: q.dim, key, metric, value });
        }
      }
    }
  }
  return { metrics, dims };
}

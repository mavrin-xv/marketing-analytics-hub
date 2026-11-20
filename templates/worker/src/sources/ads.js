// Google Ads via GAQL searchStream (REST, works from a Worker; gRPC does not).
// Account-wide source: rows use host = 'all'.
import { addDays, fetchJSON, num, withRetry } from '../util.js';

async function adsToken(env) {
  const res = await fetchJSON('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.ADS_CLIENT_ID,
      client_secret: env.ADS_CLIENT_SECRET,
      refresh_token: env.ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  }, 'ads token');
  return res.access_token;
}

async function gaql(env, token, query) {
  const v = env.ADS_API_VERSION || 'v26';
  const headers = {
    authorization: `Bearer ${token}`,
    'developer-token': env.ADS_DEVELOPER_TOKEN,
    'content-type': 'application/json',
  };
  if (env.ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(env.ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');
  const cid = String(env.ADS_CUSTOMER_ID).replace(/-/g, '');
  const batches = await withRetry(() => fetchJSON(
    `https://googleads.googleapis.com/${v}/customers/${cid}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }) },
    'ads',
  ));
  // searchStream returns an array of batches, each with .results. Field names come back camelCase.
  return (Array.isArray(batches) ? batches : [batches]).flatMap((b) => b.results || []);
}

export async function pullAds(env, from, to) {
  const token = await adsToken(env);
  const metrics = [];
  const dims = [];
  const range = `segments.date BETWEEN '${from}' AND '${to}'`;

  const camp = await gaql(env, token, `
    SELECT segments.date, campaign.name, campaign.bidding_strategy_type,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
           metrics.conversions_value, metrics.search_impression_share,
           metrics.search_rank_lost_impression_share, metrics.search_budget_lost_impression_share
    FROM campaign WHERE ${range} AND campaign.status != 'REMOVED'`);

  const perDay = new Map();
  for (const r of camp) {
    const day = r.segments.date;
    const m = r.metrics || {};
    const spend = num(m.costMicros) / 1e6; // cost comes in micros of the account currency
    const impr = num(m.impressions);
    const t = perDay.get(day) || { spend: 0, clicks: 0, impressions: 0, conversions: 0, conv_value: 0, eligible: 0, isW: 0, rankW: 0, budgetW: 0 };
    t.spend += spend;
    t.clicks += num(m.clicks);
    t.impressions += impr;
    t.conversions += num(m.conversions);
    t.conv_value += num(m.conversionsValue);
    // Impression share is 0..1 per campaign. Weight by eligible impressions (impr / IS), never sum.
    const is = num(m.searchImpressionShare);
    if (is > 0) {
      const eligible = impr / is;
      t.eligible += eligible;
      t.isW += is * eligible;
      t.rankW += num(m.searchRankLostImpressionShare) * eligible;
      t.budgetW += num(m.searchBudgetLostImpressionShare) * eligible;
    }
    perDay.set(day, t);
    const key = r.campaign.name;
    for (const [metric, value] of [['spend', spend], ['clicks', num(m.clicks)], ['conversions', num(m.conversions)]]) {
      dims.push({ day, source: 'ads', host: 'all', dim: 'campaign', key, metric, value });
    }
    // Read the bid strategy by enum name: TARGET_SPEND is "Maximize clicks", not a target.
    dims.push({ day, source: 'ads', host: 'all', dim: 'bidding', key, metric: r.campaign.biddingStrategyType || 'UNKNOWN', value: 1 });
  }

  // Explicit zeros for days without spend, so "no data" and "spent nothing" look different.
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const t = perDay.get(d) || { spend: 0, clicks: 0, impressions: 0, conversions: 0, conv_value: 0, eligible: 0 };
    metrics.push(
      { day: d, source: 'ads', host: 'all', metric: 'spend', value: t.spend },
      { day: d, source: 'ads', host: 'all', metric: 'clicks', value: t.clicks },
      { day: d, source: 'ads', host: 'all', metric: 'impressions', value: t.impressions },
      { day: d, source: 'ads', host: 'all', metric: 'conversions', value: t.conversions },
      { day: d, source: 'ads', host: 'all', metric: 'conv_value', value: t.conv_value },
    );
    if (t.eligible > 0) {
      metrics.push(
        { day: d, source: 'ads', host: 'all', metric: 'search_is', value: t.isW / t.eligible },
        { day: d, source: 'ads', host: 'all', metric: 'lost_is_rank', value: t.rankW / t.eligible },
        { day: d, source: 'ads', host: 'all', metric: 'lost_is_budget', value: t.budgetW / t.eligible },
        { day: d, source: 'ads', host: 'all', metric: 'eligible_impr', value: t.eligible },
      );
    }
  }

  const terms = await gaql(env, token, `
    SELECT segments.date, search_term_view.search_term, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM search_term_view WHERE ${range} AND metrics.clicks > 0`);
  for (const r of terms) {
    const key = r.searchTermView.searchTerm;
    const day = r.segments.date;
    dims.push(
      { day, source: 'ads', host: 'all', dim: 'term', key, metric: 'clicks', value: num(r.metrics.clicks) },
      { day, source: 'ads', host: 'all', dim: 'term', key, metric: 'spend', value: num(r.metrics.costMicros) / 1e6 },
      { day, source: 'ads', host: 'all', dim: 'term', key, metric: 'conversions', value: num(r.metrics.conversions) },
    );
  }

  const conv = await gaql(env, token, `
    SELECT segments.date, segments.conversion_action_name, metrics.conversions
    FROM campaign WHERE ${range} AND metrics.conversions > 0`);
  for (const r of conv) {
    dims.push({ day: r.segments.date, source: 'ads', host: 'all', dim: 'conversion_action', key: r.segments.conversionActionName, metric: 'conversions', value: num(r.metrics.conversions) });
  }
  return { metrics, dims };
}

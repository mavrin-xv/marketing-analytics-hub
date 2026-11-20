// Small helpers shared by every module. No dependencies.

export const SEP = String.fromCharCode(31); // unit separator: safe inside map keys, never in real data

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Inclusive day count: daysBetween('2026-01-01', '2026-01-01') === 1
export function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
}

// GA4 returns dates as 20260131
export function ga4Day(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function normHost(h) {
  return String(h || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function hosts(env) {
  return String(env.HOSTS || '').split(',').map(normHost).filter(Boolean);
}

// Retry on 429 and 5xx with backoff. Honors Retry-After when the API sends it (PostHog does).
export async function withRetry(fn, { tries = 3, baseMs = 800 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600) || e.name === 'TypeError';
      if (!retryable || i === tries - 1) break;
      const wait = e.retryAfter ? e.retryAfter * 1000 : baseMs * 2 ** i;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export async function fetchJSON(url, init, label) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${label} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    const ra = Number(res.headers.get('retry-after'));
    if (Number.isFinite(ra) && ra > 0) err.retryAfter = ra;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

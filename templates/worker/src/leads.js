// POST /hook/lead: a form, a CRM, or a PostHog destination posts here; sales gets a message in
// seconds. The lead is stored first, then delivered, so a Slack outage never loses one.
import { timingSafeEqual } from './auth.js';
import { notify } from './report.js';
import { json } from './util.js';

const MAX = { name: 120, contact: 200, message: 1500, source: 200 };
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

const clip = (v, n) => (v === undefined || v === null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n));

// Accepts a flat form payload, or PostHog's webhook destination shape ({ event, person }).
export function normalizeLead(body) {
  const props = body.event?.properties || body.properties || {};
  const person = body.person?.properties || {};
  const pick = (...keys) => keys.map((k) => body[k] ?? props[k] ?? person[k]).find((v) => v !== undefined && v !== '');
  const utm = {};
  for (const k of UTM_KEYS) {
    const v = pick(k, `$initial_${k}`);
    if (v) utm[k] = clip(v, 100);
  }
  return {
    name: clip(pick('name', 'full_name', 'first_name'), MAX.name),
    contact: clip(pick('email', 'phone', 'contact', 'telegram'), MAX.contact),
    message: clip(pick('message', 'comment', 'text'), MAX.message),
    source: clip(pick('source', 'form', '$pathname', 'page') || (body.event ? 'posthog' : 'form'), MAX.source),
    utm,
    test: Boolean(body.test) || /^test\b/i.test(String(pick('name') || '')),
  };
}

export function formatLead(lead) {
  const lines = [
    `${lead.test ? 'TEST ' : ''}New lead from ${lead.source}`,
    `Name: ${lead.name || '(not given)'}`,
    `Contact: ${lead.contact || '(not given)'}`,
  ];
  if (lead.message) lines.push(`Message: ${lead.message}`);
  const utm = Object.entries(lead.utm).map(([k, v]) => `${k.replace('utm_', '')}=${v}`).join(' ');
  if (utm) lines.push(`Came from: ${utm}`);
  return lines.join('\n');
}

export async function handleLead(req, env) {
  if (!env.LEAD_HOOK_SECRET) return json({ data: null, error: 'LEAD_HOOK_SECRET is not set' }, 503);
  const secret = req.headers.get('x-hook-secret') || new URL(req.url).searchParams.get('secret') || '';
  if (!timingSafeEqual(secret, env.LEAD_HOOK_SECRET)) return json({ data: null, error: 'unauthorized' }, 401);
  const ct = req.headers.get('content-type') || '';
  let body;
  if (ct.includes('application/json')) body = await req.json().catch(() => null);
  else body = Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  if (!body || typeof body !== 'object') return json({ data: null, error: 'bad body' }, 400);

  const lead = normalizeLead(body);
  if (!lead.contact && !lead.message) return json({ data: null, error: 'lead has no contact and no message' }, 422);

  const row = await env.DB.prepare(`INSERT INTO leads (received_at, source, name, contact, message, utm, test)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(new Date().toISOString(), lead.source, lead.name, lead.contact, lead.message, JSON.stringify(lead.utm), lead.test ? 1 : 0).first();
  const delivered = await notify(env, formatLead(lead), { kind: 'lead' });
  if (delivered) await env.DB.prepare('UPDATE leads SET delivered = 1 WHERE id = ?').bind(row.id).run();
  return json({ data: { id: row.id, delivered }, error: null });
}

// Re-send leads that no channel accepted (runs with the report cron).
export async function replayUndelivered(env) {
  const res = await env.DB.prepare(`SELECT * FROM leads WHERE delivered = 0 AND received_at > ? ORDER BY id LIMIT 20`)
    .bind(new Date(Date.now() - 3 * 86400000).toISOString()).all();
  let n = 0;
  for (const r of res.results || []) {
    const lead = { ...r, utm: JSON.parse(r.utm || '{}'), test: Boolean(r.test) };
    if (await notify(env, '(delayed) ' + formatLead(lead), { kind: 'lead' })) {
      await env.DB.prepare('UPDATE leads SET delivered = 1 WHERE id = ?').bind(r.id).run();
      n++;
    }
  }
  return n;
}

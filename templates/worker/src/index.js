// Entry point: HTTP (dashboard, API, lead webhook) and cron (one source per slot, then the report).
import { route } from './api.js';
import { isAuthed, login } from './auth.js';
import { handleLead, replayUndelivered } from './leads.js';
import { notify, sendMorningReport } from './report.js';
import { runDailySource } from './sync.js';
import { json } from './util.js';

// Cron expression -> job. Must match [triggers].crons in wrangler.toml.
export const SLOTS = {
  '0 6 * * *': 'posthog',
  '30 6 * * *': 'ga4',
  '0 7 * * *': 'gsc',
  '30 7 * * *': 'ads',
  '0 8 * * *': 'report',
};

export async function runSlot(env, job) {
  if (job === 'report') {
    await replayUndelivered(env);
    return sendMorningReport(env);
  }
  return runDailySource(env, job);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/hook/lead' && req.method === 'POST') return handleLead(req, env);
    if (url.pathname === '/api/login' && req.method === 'POST') return login(req, env);
    if (url.pathname === '/api/health') return json({ data: { ok: true }, error: null });
    if (url.pathname.startsWith('/api/')) {
      if (!(await isAuthed(req, env))) return json({ data: null, error: 'login required' }, 401);
      return route(req, env, url);
    }
    // Static dashboard. no-cache so a redeploy shows up on the next reload instead of next week.
    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'no-cache');
    return out;
  },

  async scheduled(event, env, ctx) {
    const job = SLOTS[event.cron];
    if (!job) {
      ctx.waitUntil(notify(env, `Cron "${event.cron}" has no job in SLOTS. Check wrangler.toml.`, { kind: 'ops' }));
      return;
    }
    ctx.waitUntil(runSlot(env, job));
  },
};

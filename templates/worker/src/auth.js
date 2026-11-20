// Password login with an HMAC-signed cookie. One shared password per team is enough for a
// small dashboard; put Cloudflare Access in front if you need per-person accounts.

const COOKIE = 'hub_session';
const TTL_DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeCookie(env) {
  const exp = Date.now() + TTL_DAYS * 86400000;
  const sig = await hmac(env.SESSION_SECRET, String(exp));
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_DAYS * 86400}`;
}

export async function isAuthed(req, env) {
  const raw = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return timingSafeEqual(sig, await hmac(env.SESSION_SECRET, exp));
}

export async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  if (!env.DASHBOARD_PASSWORD || !timingSafeEqual(String(body.password || ''), env.DASHBOARD_PASSWORD)) {
    return new Response(JSON.stringify({ error: 'wrong password' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'set-cookie': await makeCookie(env) },
  });
}

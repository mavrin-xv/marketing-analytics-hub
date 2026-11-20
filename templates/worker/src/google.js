// Google service-account auth from inside a Worker: sign a JWT with WebCrypto (RS256) and trade it
// for an access token. One service account covers GA4 (add it as Viewer on the property), Search
// Console (add it as a user on the property) and, if you want, Google Ads (needs a developer token).
import { fetchJSON } from './util.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const cache = new Map(); // scope -> { token, exp }

function b64url(bytes) {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToDer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function serviceAccount(env) {
  if (!env.GOOGLE_SA_JSON) throw new Error('GOOGLE_SA_JSON secret is not set');
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SA_JSON is missing client_email or private_key');
  return sa;
}

export async function googleToken(env, scope) {
  const hit = cache.get(scope);
  if (hit && hit.exp - 60 > Date.now() / 1000) return hit.token;
  const sa = serviceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(sig)}`;
  const res = await fetchJSON(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  }, 'google token');
  cache.set(scope, { token: res.access_token, exp: now + (res.expires_in || 3600) });
  return res.access_token;
}

export const SCOPES = {
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  ads: 'https://www.googleapis.com/auth/adwords',
};

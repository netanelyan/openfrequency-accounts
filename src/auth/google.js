import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { now, MINUTE } from '../core/clock.js';

// Sign in with Google: OpenID Connect, the authorization code flow with PKCE,
// no library. A customer presses the button, Google asks them which account,
// and sends them back to /auth/google/callback with a code; we trade the code
// for an ID token at Google's token endpoint and read who they are from it.
//
// The ID token comes straight from Google over TLS in answer to our own
// request, so its signature is not checked (OpenID Connect Core 3.1.3.7 allows
// this); its issuer, audience, expiry and nonce are. Only an address Google has
// verified is accepted.
//
// What the round trip needs to remember (the state, the nonce, the PKCE
// verifier, where to go next, an invite, a sign-up's token) lives in one short-lived cookie,
// signed with SESSION_SECRET. The state in Google's answer must match it, so
// nobody can finish a sign-in in a browser that did not start it.

export const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};
export const FLOW_TTL = 10 * MINUTE;

/** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or null while either is unset (the button is then not shown). */
export function googleConfig(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export class GoogleError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const rand = () => randomBytes(32).toString('base64url');
const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/** A new round trip: where to send the browser, and what to keep in the flow cookie. */
export function startGoogle({ clientId, redirectUri, next = null, invite = null, signup = null, loginHint = '' }) {
  const flow = { state: rand(), nonce: rand(), verifier: rand(), next, invite, signup, at: now() };
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challengeOf(flow.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  if (loginHint) q.set('login_hint', loginHint);
  return { url: `${GOOGLE.auth}?${q}`, flow };
}

// ---- the flow cookie: base64url(JSON).signature

const sign = (body, secret) => createHmac('sha256', secret).update(`google-flow:${body}`).digest('base64url');

export function sealFlow(flow, secret) {
  const body = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** The flow a cookie holds, or null: missing, tampered with, or older than FLOW_TTL. */
export function openFlow(value, secret) {
  const [body, sig, ...rest] = String(value || '').split('.');
  if (!body || !sig || rest.length) return null;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let flow;
  try {
    flow = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!flow || typeof flow.state !== 'string' || !(now() - flow.at < FLOW_TTL)) return null;
  return flow;
}

/** Does Google's state match the cookie's? Constant time. */
export function sameState(given, flow) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(flow.state);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- the other half: the code for an ID token

/** The claims of an ID token, or null if it is not one. */
export function decodeIdToken(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/** Who the ID token says this is: { sub, email, name }. Throws GoogleError when it is not for us or not verified. */
export function checkClaims(claims, { clientId, nonce }) {
  if (!claims) throw new GoogleError('bad_token');
  if (!GOOGLE.issuers.includes(claims.iss)) throw new GoogleError('bad_token');
  const aud = [].concat(claims.aud);
  if (!aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId)) throw new GoogleError('bad_token');
  if (!(Number(claims.exp) * 1000 > now())) throw new GoogleError('bad_token');
  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) throw new GoogleError('bad_token');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new GoogleError('bad_token');
  // Google says true for a Gmail address and for any other it has confirmed; anything else could be anyone's.
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new GoogleError('unverified');
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw new GoogleError('unverified');
  return { sub: claims.sub, email, name: String(claims.name || '').trim().slice(0, 80) };
}

/** Trade the code Google sent back for who signed in. Throws GoogleError: unreachable, refused, bad_token, unverified. */
export async function finishGoogle({ code, flow, clientId, clientSecret, redirectUri, fetch = globalThis.fetch }) {
  let res;
  try {
    res = await fetch(GOOGLE.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ code: String(code), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleError('unreachable');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok || !body?.id_token) throw new GoogleError('refused');
  return checkClaims(decodeIdToken(body.id_token), { clientId, nonce: flow.nonce });
}

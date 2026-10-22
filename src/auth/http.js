import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// What every request needs to know about itself: its cookies, its address,
// whether it came over HTTPS, and its CSRF token. Ported from Teder's auth.js.

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    // A malformed %-escape is kept as it came rather than thrown (Teder's version throws).
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

const fromProxy = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

/** Did this request reach us over HTTPS? Only the proxy on this machine may say so. */
export const isHttps = (req) => fromProxy(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';

/** The caller's address: the proxy's X-Forwarded-For when the proxy sent it, else the socket's. */
export function clientIp(req) {
  if (fromProxy(req)) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function sessionSecret(env = process.env) {
  const s = String(env.SESSION_SECRET || '').trim();
  if (s.length >= 32) return s;
  // A per-process secret: CSRF tokens do not survive a restart, which is the
  // safe failure for a missing setting.
  globalThis.__ofAccountsEphemeralSecret ??= randomBytes(32).toString('hex');
  return globalThis.__ofAccountsEphemeralSecret;
}

const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

/** The CSRF token for a session id (or, before sign-in, for a pre-session nonce). */
export const csrfFor = (session, secret) => sign(`csrf:${session}`, secret).slice(0, 32);

export function csrfOk(given, session, secret) {
  if (!session) return false;
  const want = Buffer.from(csrfFor(session, secret));
  const got = Buffer.from(String(given || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

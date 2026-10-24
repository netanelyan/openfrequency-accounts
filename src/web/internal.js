import { timingSafeEqual } from 'node:crypto';
import { describeSession } from '../auth/sessions.js';
import { PRODUCTS } from '../db/schema.js';
import { claimPhone, ownerOf, ownersOf, PhoneError, setConsent, validPhone } from '../accounts/phones.js';

// The internal listener, for Teder and Toran on this machine:
//   GET  /internal/session              who a browser is (docs/internal-session.md)
//   GET  /internal/owner-phone          who a WhatsApp number is (docs/internal-owner-phone.md)
//   GET  /internal/owner-phones         a workspace's numbers
//   POST /internal/owner-phone/claim    the number that sent a link code
//   POST /internal/owner-phone/consent  "הפסק" and "התחל"
//
// Four locks, any one of which is enough on its own:
//   - it listens on 127.0.0.1 on a port Caddy never proxies
//   - it answers only a loopback socket
//   - it answers only a loopback Host (a browser on this machine tricked by DNS
//     rebinding would send another name)
//   - it needs OF_INTERNAL_TOKEN as a bearer token, and refuses everything while
//     that is unset or short

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MIN_TOKEN = 32;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function bearerOk(req, token) {
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  if (!m) return false;
  const want = Buffer.from(token);
  const got = Buffer.from(m[1]);
  return want.length === got.length && timingSafeEqual(want, got);
}

// Which method each path answers to. Anything else on these paths is 405, any other path 404.
const ROUTES = {
  '/internal/session': 'GET',
  '/internal/owner-phone': 'GET',
  '/internal/owner-phones': 'GET',
  '/internal/owner-phone/claim': 'POST',
  '/internal/owner-phone/consent': 'POST',
};
const BODY_LIMIT = 4096;
const STATUS = { bad_phone: 400, not_linked: 404, unknown_code: 404, expired: 410, used: 409, phone_taken: 409 };
const SOURCE = /^[a-z][a-z0-9_]{0,31}$/;

class Refused extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** A small JSON object, or Refused: too_large past the limit, bad for anything that is not an object. */
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) throw new Refused(413, 'too_large');
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Refused(400, 'bad');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refused(400, 'bad');
  return body;
}

export function internalHandler(db, { env = process.env, log = console.error } = {}) {
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  return async (req, res) => {
    if (!LOOPBACK.has(req.socket?.remoteAddress)) return json(res, 403, { error: 'not_local' });
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase();
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return json(res, 403, { error: 'bad_host' });

    const url = new URL(req.url, 'http://internal');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    const method = Object.hasOwn(ROUTES, url.pathname) ? ROUTES[url.pathname] : null;
    if (!method) return json(res, 404, { error: 'not_found' });
    if (req.method !== method) return json(res, 405, { error: 'method_not_allowed' });

    if (token.length < MIN_TOKEN) return json(res, 503, { error: 'not_configured' });
    if (!bearerOk(req, token)) return json(res, 401, { error: 'bad_token' });

    try {
      switch (url.pathname) {
        case '/internal/session': {
          const product = url.searchParams.get('product');
          if (product != null && !PRODUCTS.includes(product)) return json(res, 400, { error: 'bad_product' });
          const { status, body } = describeSession(db, String(req.headers['x-of-session'] || ''));
          if (status === 200 && product && !body.products.includes(product)) return json(res, 403, { error: 'product_disabled' });
          return json(res, status, body);
        }
        case '/internal/owner-phone': {
          const found = ownerOf(db, url.searchParams.get('phone') ?? '');
          return found ? json(res, 200, found) : json(res, 404, { error: 'not_linked' });
        }
        case '/internal/owner-phones': {
          const id = url.searchParams.get('workspace') ?? '';
          if (!/^[1-9]\d{0,15}$/.test(id)) return json(res, 400, { error: 'bad_workspace' });
          return json(res, 200, { phones: ownersOf(db, Number(id)) });
        }
        case '/internal/owner-phone/claim': {
          const body = await readJson(req);
          if (!validPhone(body.phone)) return json(res, 400, { error: 'bad_phone' });
          if (typeof body.code !== 'string') return json(res, 400, { error: 'bad' });
          return json(res, 200, claimPhone(db, { code: body.code, phone: body.phone }));
        }
        case '/internal/owner-phone/consent': {
          const body = await readJson(req);
          if (!validPhone(body.phone)) return json(res, 400, { error: 'bad_phone' });
          const source = body.source ?? 'whatsapp';
          if (typeof body.optIn !== 'boolean' || typeof source !== 'string' || !SOURCE.test(source)) return json(res, 400, { error: 'bad' });
          return json(res, 200, setConsent(db, body.phone, { optIn: body.optIn, source }));
        }
      }
    } catch (e) {
      if (e instanceof Refused) return json(res, e.status, { error: e.code });
      if (e instanceof PhoneError) return json(res, STATUS[e.code] || 400, { error: e.code });
      log(`[accounts] internal ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      return json(res, 500, { error: 'server_error' });
    }
  };
}

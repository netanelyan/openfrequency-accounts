import { timingSafeEqual } from 'node:crypto';
import { describeSession } from '../auth/sessions.js';
import { PRODUCTS } from '../db/schema.js';

// The internal listener: GET /internal/session, for Teder and Toran on this
// machine. The format is in docs/internal-session.md.
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

export function internalHandler(db, { env = process.env } = {}) {
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  return (req, res) => {
    if (!LOOPBACK.has(req.socket?.remoteAddress)) return json(res, 403, { error: 'not_local' });
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase();
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return json(res, 403, { error: 'bad_host' });

    const url = new URL(req.url, 'http://internal');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (url.pathname !== '/internal/session') return json(res, 404, { error: 'not_found' });
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

    if (token.length < MIN_TOKEN) return json(res, 503, { error: 'not_configured' });
    if (!bearerOk(req, token)) return json(res, 401, { error: 'bad_token' });

    const product = url.searchParams.get('product');
    if (product != null && !PRODUCTS.includes(product)) return json(res, 400, { error: 'bad_product' });

    const { status, body } = describeSession(db, String(req.headers['x-of-session'] || ''));
    if (status === 200 && product && !body.products.includes(product)) return json(res, 403, { error: 'product_disabled' });
    return json(res, status, body);
  };
}

import { createServer } from 'node:http';

// Two listeners, both on 127.0.0.1:
//
//   PORT (4740)           the public site. Caddy holds the certificate for
//                         accounts.openfrequency.co.il and passes requests here.
//   INTERNAL_PORT (4741)  /internal/session, for Teder and Toran on this machine.
//                         Caddy never proxies it, so no request from outside can
//                         reach it even if a proxy rule is too broad.
//
// Only /healthz answers so far. The login, the sessions and the superadmin pages
// arrive in the next items.

export const HOST = '127.0.0.1';

const text = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
};

export function publicHandler() {
  return (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/healthz') return text(res, 200, 'ok');
    return text(res, 404, 'not found');
  };
}

export function internalHandler() {
  return (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/healthz') return text(res, 200, 'ok');
    return text(res, 404, 'not found');
  };
}

const listenOn = (handler, port) =>
  new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });

/** Start both listeners. Port 0 picks a free one (the tests). */
export async function listen({ env = process.env, port = Number(env.PORT || 4740), internalPort = Number(env.INTERNAL_PORT || 4741) } = {}) {
  const pub = await listenOn(publicHandler(), port);
  const internal = await listenOn(internalHandler(), internalPort);
  return {
    port: pub.address().port,
    internalPort: internal.address().port,
    close: () => Promise.all([pub, internal].map((s) => new Promise((r) => s.close(r)))),
  };
}

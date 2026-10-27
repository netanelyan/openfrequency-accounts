import { createServer } from 'node:http';
import { publicHandler } from './app.js';
import { accountsBase, internalHandler } from './internal.js';
import { createMailer } from '../mail/send.js';

// Two listeners, both on 127.0.0.1:
//
//   PORT (4740)           the public site (app.js). Caddy holds the certificate
//                         for accounts.openfrequency.co.il and passes requests here.
//   INTERNAL_PORT (4741)  /internal/session, /internal/owner-phone*, /internal/entitlement, /internal/notify (internal.js),
//                         for Teder and Toran on this machine. Caddy never proxies
//                         it, so no request from outside can reach it even if a
//                         proxy rule is too broad.

export const HOST = '127.0.0.1';

const listenOn = (handler, port) =>
  new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });

/** Start both listeners. Port 0 picks a free one (the tests). */
export async function listen(db, { env = process.env, port = Number(env.PORT || 4740), internalPort = Number(env.INTERNAL_PORT || 4741), mailer = createMailer({ env }), ...opts } = {}) {
  const pub = await listenOn(publicHandler({ db, env, mailer, ...opts }), port);
  let internal;
  try {
    internal = await listenOn(internalHandler(db, { env, log: opts.log, mailer, base: accountsBase(env) }), internalPort);
  } catch (e) {
    pub.close();
    throw e;
  }
  return {
    port: pub.address().port,
    internalPort: internal.address().port,
    mailer,
    close: async () => {
      await mailer.flush();
      await Promise.all([pub, internal].map((s) => new Promise((r) => s.close(r))));
    },
  };
}

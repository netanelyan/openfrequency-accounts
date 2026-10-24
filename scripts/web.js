#!/usr/bin/env node
// npm start   the public site on 127.0.0.1:${PORT:-4740} and /internal/session (and
//             /internal/owner-phone*) on 127.0.0.1:${INTERNAL_PORT:-4741}. pm2 runs this
//             as of-accounts.

import { requireHome } from '../src/core/paths.js';
import { loadEnv } from '../src/core/env.js';

try {
  requireHome();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
loadEnv();
const { openDb, closeDb } = await import('../src/db/index.js');
const { listen } = await import('../src/web/server.js');

const env = process.env;
const server = await listen(openDb());
console.log(`of-accounts: http://127.0.0.1:${server.port}  (internal: http://127.0.0.1:${server.internalPort}), email: ${server.mailer.sending}`);
if (String(env.OF_INTERNAL_TOKEN || '').trim().length < 32) {
  console.log('OF_INTERNAL_TOKEN is unset or short: /internal/session refuses every request, and /admin does not call Toran, until it is set (32+ characters).');
}
if (String(env.SESSION_SECRET || '').trim().length < 32) {
  console.log('SESSION_SECRET is unset or short: forms open before a restart will need a reload after it.');
}
if (!String(env.OF_ASSISTANT_WA || '').trim()) {
  console.log('OF_ASSISTANT_WA is unset: the home page makes WhatsApp link codes, but has no number to send them to.');
}
if (!String(env.PUBLIC_HOST || '').trim()) {
  console.log('PUBLIC_HOST is unset: development mode (plain http, a host-only cookie). Set it on the server.');
}

// pm2 stops with SIGINT: finish the emails in flight, then close the database.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    closeDb();
    process.exit(0);
  });
}

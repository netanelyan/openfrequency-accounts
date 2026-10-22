#!/usr/bin/env node
// npm start   the public site on 127.0.0.1:${PORT:-4740} and /internal/session on
//             127.0.0.1:${INTERNAL_PORT:-4741}. pm2 runs this as of-accounts.

import { requireHome } from '../src/core/paths.js';
import { loadEnv } from '../src/core/env.js';

try {
  requireHome();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
loadEnv();
const { openDb } = await import('../src/db/index.js');
const { listen } = await import('../src/web/server.js');

const { port, internalPort } = await listen(openDb());
if (String(process.env.OF_INTERNAL_TOKEN || '').trim().length < 32) {
  console.log('OF_INTERNAL_TOKEN is unset or short: /internal/session refuses every request until it is set (32+ characters).');
}
console.log(`of-accounts: http://127.0.0.1:${port}  (internal: http://127.0.0.1:${internalPort})`);

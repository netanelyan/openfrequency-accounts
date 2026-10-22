#!/usr/bin/env node
// npm run demo
//
// The whole thing on http://localhost:4740 with a throwaway database in .demo/
// (gitignored, rebuilt on every run): a superadmin, and a fictional shop with
// Teder turned on and one owner. No email leaves the machine: every magic link
// and invite is printed here instead.
//
//   customer      type dana@example.com at /login, then open the printed link
//   superadmin    /admin/login with the email, password and a recovery code
//                 printed below (or add the key to an authenticator app)

import { rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/core/paths.js';

const home = path.join(ROOT, '.demo');
rmSync(home, { recursive: true, force: true, maxRetries: 3 });
process.env.OF_HOME = home;
process.env.PUBLIC_HOST = '';
process.env.RESEND_API_KEY = '';
process.env.OF_INTERNAL_TOKEN ||= 'demo-internal-token-not-for-production-0000';
process.env.TEDER_URL ||= 'http://localhost:4700/';
process.env.TORAN_URL ||= 'http://localhost:4710/';

const { openDb } = await import('../src/db/index.js');
const { listen } = await import('../src/web/server.js');
const { setSuperadmin } = await import('../src/accounts/superadmin.js');
const { createInvite, acceptInvite } = await import('../src/accounts/links.js');
const { newTotpSecret } = await import('../src/auth/totp.js');
const { nowIso } = await import('../src/core/clock.js');

const db = openDb();
const ADMIN = 'admin@example.com';
const PASSWORD = 'demo-password-123';
const secret = newTotpSecret();
const { codes } = setSuperadmin(db, { email: ADMIN, password: PASSWORD, totpSecret: secret });
const admin = db.get('SELECT * FROM users WHERE email = ?', ADMIN);

const ws = db.insert('workspaces', { slug: 'demo-shop', name: 'החנות לדוגמה', created_at: nowIso() });
db.insert('workspace_products', { workspace_id: ws, product: 'teder', enabled: 1, updated_at: nowIso() });
const inv = createInvite(db, { workspaceId: ws, email: 'dana@example.com', role: 'client_owner', by: admin });
acceptInvite(db, inv.token, { name: 'דנה' });

const { port, internalPort } = await listen(db, { failDelayMs: 0 });
console.log(`
OpenFrequency accounts, demo  (database: .demo/, rebuilt each run)

  http://localhost:${port}/login          customer: dana@example.com, the link prints here
  http://localhost:${port}/admin/login    superadmin: ${ADMIN} / ${PASSWORD}
                                          code: any of ${codes.slice(0, 3).join(', ')} (one use each)
                                          or add this key to an authenticator app: ${secret}
  http://127.0.0.1:${internalPort}/internal/session   Authorization: Bearer ${process.env.OF_INTERNAL_TOKEN}

Ctrl+C to stop.
`);

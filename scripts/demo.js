#!/usr/bin/env node
// npm run demo
//
// The whole thing on http://localhost:4740 with a throwaway database in .demo/
// (gitignored, rebuilt on every run): a superadmin, and a fictional shop with
// Teder and Toran turned on, one owner and her WhatsApp number (050-000-0123,
// fictional). No email leaves the machine: every magic link and invite is
// printed here instead, and nothing is sent to any phone.
//
//   customer      type dana@example.com at /login, then open the printed link
//   superadmin    /admin/login with the email, password and a recovery code
//                 printed below (or add the key to an authenticator app)
//   owner line    "לחבר את הוואטסאפ" on the home page makes a code; the curl
//                 printed below claims it the way Toran does

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
process.env.OF_ASSISTANT_WA ||= '972500000100';

const { openDb } = await import('../src/db/index.js');
const { listen } = await import('../src/web/server.js');
const { setSuperadmin } = await import('../src/accounts/superadmin.js');
const { createInvite, acceptInvite } = await import('../src/accounts/links.js');
const { newTotpSecret } = await import('../src/auth/totp.js');
const { nowIso } = await import('../src/core/clock.js');
const { claimPhone, createLinkCode } = await import('../src/accounts/phones.js');
const { ensureSubscription, payMonth } = await import('../src/accounts/subscriptions.js');

const db = openDb();
const ADMIN = 'admin@example.com';
const PASSWORD = 'demo-password-123';
const secret = newTotpSecret();
const { codes } = setSuperadmin(db, { email: ADMIN, password: PASSWORD, totpSecret: secret });
const admin = db.get('SELECT * FROM users WHERE email = ?', ADMIN);

const ws = db.insert('workspaces', { slug: 'demo-shop', name: 'החנות לדוגמה', created_at: nowIso() });
for (const product of ['teder', 'toran']) {
  db.insert('workspace_products', { workspace_id: ws, product, enabled: 1, updated_at: nowIso() });
  ensureSubscription(db, ws, product);
}
// The paywall in both states: Teder paid for a month, Toran not paid yet (its steps locked on /setup).
payMonth(db, ws, 'teder', { by: admin });
const inv = createInvite(db, { workspaceId: ws, email: 'dana@example.com', role: 'client_owner', by: admin });
const { user: dana } = acceptInvite(db, inv.token, { name: 'דנה' });
claimPhone(db, { code: createLinkCode(db, { user: dana, workspaceId: ws, optIn: true }).code, phone: '972500000123' });

const { port, internalPort } = await listen(db, { failDelayMs: 0 });
console.log(`
OpenFrequency accounts, demo  (database: .demo/, rebuilt each run)

  http://localhost:${port}/login          customer: dana@example.com, the link prints here
  http://localhost:${port}/admin/login    superadmin: ${ADMIN} / ${PASSWORD}
                                          code: any of ${codes.slice(0, 3).join(', ')} (one use each)
                                          or add this key to an authenticator app: ${secret}
  http://127.0.0.1:${internalPort}/internal/session   Authorization: Bearer ${process.env.OF_INTERNAL_TOKEN}

  The paywall (docs/setup.md):
    curl -H "Authorization: Bearer ${process.env.OF_INTERNAL_TOKEN}" "http://127.0.0.1:${internalPort}/internal/entitlement?workspace=${ws}&product=toran"

  Toran's owner line (docs/internal-owner-phone.md):
    curl -H "Authorization: Bearer ${process.env.OF_INTERNAL_TOKEN}" "http://127.0.0.1:${internalPort}/internal/owner-phone?phone=972500000123"
    curl -H "Authorization: Bearer ${process.env.OF_INTERNAL_TOKEN}" -d '{"code":"LINK-XXXXXX","phone":"972500000124"}' http://127.0.0.1:${internalPort}/internal/owner-phone/claim

Ctrl+C to stop.
`);

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
const { openDb, closeDb, SchemaError } = await import('../src/db/index.js');
const { listen } = await import('../src/web/server.js');
const { startDaily } = await import('../src/web/daily.js');

const env = process.env;
let db;
try {
  db = openDb();
} catch (e) {
  // A database this build cannot use (src/db/index.js migrate()): say why and stop, rather than serve it wrong.
  if (!(e instanceof SchemaError)) throw e;
  console.error(`of-accounts will not start: ${e.message}`);
  process.exit(1);
}
const server = await listen(db);
// The billing emails and the deletions the privacy policy promises, once a day from 09:00 (src/web/daily.js).
const stopDaily = startDaily(db, { env, mailer: server.mailer });
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
const signupOn = String(env.OF_SIGNUP || '').trim() === '1';
console.log(signupOn ? 'Sign-up is open (OF_SIGNUP=1): /signup opens new accounts.' : 'Sign-up is closed: /signup says it opens soon. OF_SIGNUP=1 opens it.');
// What a stranger who signs up needs from us (docs/deploy.md, ACC-02, ACC-03): a way to ask how to pay, a reply
// address that reaches a person, and someone told of each sign-up.
if (signupOn) {
  if (!String(env.OF_SIGNUP_NOTIFY || '').trim()) console.log('OF_SIGNUP_NOTIFY is unset: nobody hears of a new sign-up, a payment that did not come, or a cancellation.');
  if (!String(env.OF_SUPPORT_WA || '').trim()) console.log('OF_SUPPORT_WA is unset: "how do I pay" leads to an email to MAIL_REPLY_TO, or to the website's contact page.');
  if (!String(env.MAIL_REPLY_TO || '').trim()) console.log('MAIL_REPLY_TO is unset: a reply to the welcome or billing emails goes to the sending address.');
  if (!String(env.OF_BILLING_PROVIDER || '').trim() && !String(env.OF_PAYMENT_METHOD || '').trim()) console.log('OF_PAYMENT_METHOD is unset: /setup and the emails say only that we send the payment details.');
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
    stopDaily();
    await server.close();
    closeDb();
    process.exit(0);
  });
}

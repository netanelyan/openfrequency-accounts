#!/usr/bin/env node
// npm run admin:create -- --email <you@example.com>
//
// Creates the superadmin, or replaces its password and TOTP secret (which also
// signs it out everywhere and replaces its recovery codes). Asks for:
//
//   1. a password, 12+ characters (or OF_ADMIN_PASSWORD, read once)
//   2. a code from your authenticator app, after you add the secret it prints,
//      so a mistyped secret is caught here and not at your next sign-in
//
// Then prints 8 one-time recovery codes. Keep them somewhere other than the
// phone. Nothing is saved until the code checks out.

import { createInterface } from 'node:readline';
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
const { setSuperadmin, totpMatches } = await import('../src/accounts/superadmin.js');
const { newTotpSecret, otpauthUri } = await import('../src/auth/totp.js');
const { normEmail, validEmail } = await import('../src/accounts/links.js');
const { MIN_PASSWORD } = await import('../src/auth/password.js');

const args = process.argv.slice(2);
const email = normEmail(args.includes('--email') ? args[args.indexOf('--email') + 1] : '');
if (!validEmail(email)) {
  console.error('Usage: npm run admin:create -- --email <you@example.com>');
  process.exit(1);
}

// Lines come from the terminal or from a pipe alike; the password is not echoed on a terminal.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const queue = [];
const waiting = [];
rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : queue.push(l)));
rl.on('close', () => waiting.splice(0).forEach((w) => w(null)));
let muted = false;
rl._writeToOutput = (s) => {
  if (!muted || /\r?\n$/.test(s)) process.stdout.write(muted ? '\n' : s);
};
const ask = (q, { hidden = false } = {}) => {
  process.stdout.write(q);
  muted = hidden && Boolean(process.stdin.isTTY);
  return new Promise((resolve) => {
    const done = (l) => {
      muted = false;
      resolve(l == null ? null : l.trim());
    };
    queue.length ? done(queue.shift()) : waiting.push(done);
  });
};

let password = process.env.OF_ADMIN_PASSWORD || '';
if (password) console.log('Using OF_ADMIN_PASSWORD. Remove it from .env afterwards.');
while (password.length < MIN_PASSWORD) {
  password = (await ask(`Password for ${email} (${MIN_PASSWORD}+ characters): `, { hidden: true })) ?? process.exit(1);
  if (password.length < MIN_PASSWORD) console.log(`That is ${password.length} characters; it needs ${MIN_PASSWORD}.`);
}

const secret = newTotpSecret();
console.log(`
Add this account to your authenticator app (Google Authenticator, 1Password, Authy...).
Most apps scan a QR code or take the key typed in. To make a QR code, paste the
otpauth:// line into any QR generator you trust, offline if you can.

  Key:      ${secret.match(/.{1,4}/g).join(' ')}
  otpauth:  ${otpauthUri(secret, email)}
`);

let ok = false;
for (let i = 0; i < 3 && !ok; i++) {
  const code = await ask('The 6-digit code the app shows now: ');
  if (code == null) process.exit(1);
  ok = totpMatches(secret, code);
  if (!ok) console.log('That code does not match. Check the key and the phone\'s clock, then try again.');
}
if (!ok) {
  console.error('Nothing was saved.');
  process.exit(1);
}

const db = openDb();
let result;
try {
  result = setSuperadmin(db, { email, password, totpSecret: secret });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
console.log(`
Saved. ${email} is the superadmin. Sign in at /admin/login.

Recovery codes, one use each, for when the phone is lost. Keep them somewhere
other than the phone; they are not shown again:

${result.codes.map((c) => `  ${c}`).join('\n')}
`);
rl.close();
db.close();

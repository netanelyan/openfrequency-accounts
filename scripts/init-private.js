#!/usr/bin/env node
// npm run init-private
//
// Creates the private folder ($OF_HOME, ./private/ by default) and never
// overwrites anything already there:
//
//   data/               the database, the dev outbox, backups
//   .env                keys (copied from .env.example, empty, mode 600)
//   public-denylist.txt words check:public refuses in the public repo
//
// The database itself is created on first start.

import { chmodSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, dataDir, ensureDir, ofHome } from '../src/core/paths.js';

const home = ofHome();
const made = [];

if (!existsSync(dataDir())) (ensureDir(dataDir()), made.push('data/'));
if (!existsSync(path.join(home, '.env'))) {
  copyFileSync(path.join(ROOT, '.env.example'), path.join(home, '.env'));
  try {
    chmodSync(path.join(home, '.env'), 0o600);
  } catch {
    /* Windows: permissions are the folder's */
  }
  made.push('.env');
}
const deny = path.join(home, 'public-denylist.txt');
if (!existsSync(deny)) {
  writeFileSync(deny, '# One word or name per line that must never appear in the public repository.\n# Customer emails and workspace names are read from the database; this is for anything else.\n');
  made.push('public-denylist.txt');
}

console.log(made.length ? `init-private: ${home}\n  created ${made.join(', ')}` : `init-private: ${home} already set up, nothing changed`);
console.log('Next: fill in $OF_HOME/.env (OF_INTERNAL_TOKEN, SESSION_SECRET, RESEND_API_KEY, MAIL_FROM).');

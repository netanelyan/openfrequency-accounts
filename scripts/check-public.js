#!/usr/bin/env node
// npm run check:public
//
// The repository is public. This fails if anything committed (or staged for the
// next commit) looks private:
//
//   - any file under private/ (the default $OF_HOME), however it got there
//   - a .env file other than .env.example, or a key-shaped string anywhere
//   - a database (by extension or by the SQLite header)
//   - a real customer: every user's email and every workspace's name and slug in
//     $OF_HOME/data/accounts.db, plus any word in $OF_HOME/public-denylist.txt
//
// It reads file contents from the git index, so the pre-commit hook checks what
// would actually be committed, not what happens to be on disk. Ported from Teder's.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT as REPO, dbPath, ofHome } from '../src/core/paths.js';
import { SECRET_KEYS } from '../src/core/env.js';

// The tests point this at a throwaway repository.
const ROOT = process.env.CHECK_PUBLIC_ROOT || REPO;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });

let files;
try {
  files = git('ls-files', '--cached', '-z').toString('utf8').split('\0').filter(Boolean);
} catch {
  console.error('check:public: not a git repository');
  process.exit(1);
}

/** Every indexed file's content, in one git call. */
function indexContents(list) {
  if (!list.length) return new Map();
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: ROOT, input: list.map((f) => `:${f}`).join('\n') + '\n', maxBuffer: 512 * 1024 * 1024 });
  const map = new Map();
  let at = 0;
  for (const f of list) {
    const nl = out.indexOf(10, at);
    const header = out.subarray(at, nl).toString('utf8');
    const m = /^\S+ (\S+) (\d+)$/.exec(header);
    if (!m) {
      at = nl + 1;
      continue;
    }
    const size = Number(m[2]);
    map.set(f, out.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return map;
}

const contents = indexContents(files);
const problems = [];
const fail = (file, why) => problems.push(`${file}: ${why}`);

const KEY_SHAPES = [
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/, 'a Resend key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic key'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'an API key'],
  [/\bghp_[A-Za-z0-9]{30,}\b/, 'a GitHub token'],
  [/\bGOCSPX-[A-Za-z0-9_-]{20,}/, 'a Google client secret'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'a private key'],
  [/otpauth:\/\/totp\/[^\s'"`]*secret=[A-Z2-7]{16,}/i, 'a TOTP secret'],
  // [ \t], not \s: an empty key must not reach across the line break into the next one.
  [new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:${SECRET_KEYS.join('|')})[ \\t]*=[ \\t]*['"]?[^\\s'"#]{6,}`, 'm'), 'a key assigned a value'],
];

// ---- what the private folder says is real
const real = [];
const home = ofHome();
const db = dbPath();
if (existsSync(db)) {
  try {
    const conn = new DatabaseSync(db, { readOnly: true });
    for (const { email } of conn.prepare('SELECT email FROM users').all()) real.push({ term: email, kind: 'user email' });
    for (const { name, slug } of conn.prepare('SELECT name, slug FROM workspaces').all()) {
      if (name.trim().length >= 3) real.push({ term: name.trim(), kind: 'workspace name' });
      if (slug.length >= 4) real.push({ term: slug, kind: 'workspace slug' });
    }
    conn.close();
  } catch (e) {
    console.error(`check:public: could not read ${db} (${e.message}); only the generic checks ran`);
  }
}
const deny = path.join(home, 'public-denylist.txt');
if (existsSync(deny)) {
  for (const line of readFileSync(deny, 'utf8').split(/\r?\n/)) {
    const t = line.replace(/#.*$/, '').trim();
    if (t.length >= 3) real.push({ term: t, kind: 'denylisted word' });
  }
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const L = '[\\p{L}\\p{N}_]';
const matchers = real.map((r) => ({ ...r, re: new RegExp(`(?<!${L})${esc(r.term)}(?!${L})`, 'iu') }));

// ---- the checks
for (const f of files) {
  const base = path.posix.basename(f);
  if (f.startsWith('private/') || f === 'private') fail(f, 'the private folder must never be tracked');
  if (/^\.env($|\.)/.test(base) && base !== '.env.example') fail(f, 'an .env file');
  if (/\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/i.test(base)) fail(f, 'a database file');

  const buf = contents.get(f);
  if (!buf) continue;
  if (buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\0') fail(f, 'an SQLite database');
  if (buf.includes(0)) continue; // binary: nothing to read
  const text = buf.toString('utf8');
  for (const [re, what] of KEY_SHAPES) {
    const m = re.exec(text);
    if (!m) continue;
    if (base === '.env.example' && what === 'a key assigned a value') fail(f, `.env.example must list keys with empty values (${m[0].split('=')[0].trim()})`);
    else fail(f, `${what} (line ${text.slice(0, m.index).split('\n').length})`);
  }
  for (const r of matchers) {
    const m = r.re.exec(text);
    if (m) fail(f, `names a real ${r.kind} (line ${text.slice(0, m.index).split('\n').length})`);
  }
}

if (problems.length) {
  console.error(`check:public FAILED: ${problems.length} problem(s) in tracked files\n  - ${problems.join('\n  - ')}`);
  console.error('\nNothing private belongs in this repository. Move it to $OF_HOME (./private/ by default).');
  process.exit(1);
}
console.log(`check:public ok: ${files.length} tracked files, ${real.length} private names checked${existsSync(home) ? '' : ' (no private folder here, so only the generic checks ran)'}`);

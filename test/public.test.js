import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/core/paths.js';
import { Db } from '../src/db/index.js';

// The repository is public, and check:public is what proves nothing private is
// tracked: no key, no database, no customer's email or business name.

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'of-accounts-public-'));
  // The private folder lives outside the repository under test, as it would on a real install.
  const home = mkdtempSync(path.join(os.tmpdir(), 'of-accounts-private-'));
  const db = new Db(path.join(home, 'data', 'accounts.db'));
  const t = '2026-10-22T10:00:00.000Z';
  db.insert('users', { email: 'zz.customer@example.net', created_at: t });
  db.insert('workspaces', { slug: 'zz-real-shop', name: 'חנות אמיתית לגמרי', created_at: t });
  db.close();
  writeFileSync(path.join(home, 'public-denylist.txt'), '# a comment\nsecretpartnername\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return { dir, home, cleanup: () => [dir, home].forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 3 })) };
}

function check(r, files) {
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(r.dir, f)), { recursive: true });
    writeFileSync(path.join(r.dir, f), body);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: r.dir });
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-public.js')], { env: { ...process.env, CHECK_PUBLIC_ROOT: r.dir, OF_HOME: r.home }, encoding: 'utf8' });
}

test('a clean repository passes check:public', () => {
  const r = repo();
  try {
    const out = check(r, { 'src/a.js': 'export const x = 1; // a real shop is never named here\n', '.env.example': 'RESEND_API_KEY=\nOF_INTERNAL_TOKEN=\n' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /4 private names checked/);
  } finally {
    r.cleanup();
  }
});

// Assembled at run time, so this file itself carries no key-shaped string.
const resendKey = ['re', 'AbCdEfGh12', 'abcdefghijklmnopqrstuvwxyz12'].join('_');
const totpUri = `otpauth://totp/OpenFrequency:x?${'secret'}=${'JBSWY3DPEHPK3PXP'.repeat(2)}`;

for (const [why, files, expect] of [
  ['a customer email', { 'docs/a.md': 'invited ZZ.Customer@example.net today\n' }, /real user email/],
  ['a workspace name', { 'README.md': 'חנות אמיתית לגמרי\n' }, /real workspace name/],
  ['a workspace slug', { 'test/x.test.js': "const slug = 'zz-real-shop';\n" }, /real workspace slug/],
  ['a denylisted word', { 'docs/b.md': 'thanks to secretpartnername\n' }, /denylisted/],
  ['a Resend key', { 'src/mail.js': `const k = "${resendKey}";\n` }, /Resend key/],
  ['a TOTP secret', { 'notes.txt': `${totpUri}\n` }, /TOTP secret/],
  ['a filled .env.example', { '.env.example': 'OF_INTERNAL_TOKEN=abcdef123456\n' }, /empty values/],
  ['a secret assigned in a shell script', { 'deploy/x.sh': 'export SESSION_SECRET=abcdef123456\n' }, /key assigned a value/],
  ['an .env file', { '.env': 'X=1\n' }, /\.env file/],
  ['a database', { 'state.db': 'SQLite format 3\0xxxx' }, /database/],
  ['an SQLite file under another name', { 'notes.bin': 'SQLite format 3\0xxxx' }, /SQLite database/],
  ['the private folder', { 'private/readme.txt': 'hi\n' }, /private folder/],
]) {
  test(`check:public refuses ${why}`, () => {
    const r = repo();
    try {
      const out = check(r, files);
      assert.equal(out.status, 1, out.stdout);
      assert.match(out.stderr, expect);
    } finally {
      r.cleanup();
    }
  });
}

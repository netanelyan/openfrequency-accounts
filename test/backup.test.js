import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeWorkspace, tempHome } from './helpers.js';
import { backup, checkCopy } from '../src/db/backup.js';
import { MIGRATIONS } from '../src/db/schema.js';
import { ROOT } from '../src/core/paths.js';

// The backup and its check (PRA-DB-003): a copy is opened and checked before it counts, a bad one is set aside, a
// failed run alerts a person (PRA-OPS-007); and scripts/schema-check.js, which deploy/rollback.sh asks before it
// switches back to an older build (PRA-OPS-005).

const node = (args, env) => spawnSync(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });

test('a backup is a checked copy; the nightly ones and the ones before a deploy are kept apart, the newest of each', () => {
  const h = tempHome();
  try {
    makeWorkspace(h.db, 'noa-shop', { members: { 'noa@example.com': 'client_owner' } });
    const src = path.join(h.home, 'data', 'accounts.db');
    const dir = path.join(h.home, 'data', 'backups');
    mkdirSync(dir, { recursive: true });
    const r = backup(src, dir, { keep: 2, at: new Date('2026-10-22T03:30:00Z') });
    assert.equal(path.basename(r.file), 'accounts-2026-10-22T03-30-00-000Z.db');
    assert.deepEqual(r.counts, { workspaces: 1, users: 1, subscriptions: 0 });
    for (const day of ['23', '24']) backup(src, dir, { keep: 2, at: new Date(`2026-10-${day}T03:30:00Z`) });
    for (let i = 0; i < 7; i++) backup(src, dir, { keep: 2, tag: `pre-abc${i}`, at: new Date(`2026-10-2${i}T12:00:00Z`) });
    const names = readdirSync(dir).sort();
    assert.deepEqual(names.filter((n) => !n.includes('-pre-')), ['accounts-2026-10-23T03-30-00-000Z.db', 'accounts-2026-10-24T03-30-00-000Z.db']);
    assert.equal(names.filter((n) => n.includes('-pre-')).length, 5);
    assert.throws(() => backup(src, dir, { tag: 'x; rm -rf' }), /a tag is pre-<commit>/);
  } finally {
    h.cleanup();
  }
});

test('a copy that cannot be used says why: not a database, or not the live one\'s schema', () => {
  const h = tempHome();
  try {
    const bad = path.join(h.home, 'broken.db');
    writeFileSync(bad, 'this is not a database, and it is long enough to look like one at a glance '.repeat(100));
    assert.ok(checkCopy(bad).problems.length > 0);
    const src = path.join(h.home, 'data', 'accounts.db');
    assert.deepEqual(checkCopy(src, MIGRATIONS.length).problems, []);
    assert.match(checkCopy(src, MIGRATIONS.length + 1).problems.join(), /user_version \d+, the live database's is \d+/);
  } finally {
    h.cleanup();
  }
});

test('scripts/backup.js: a good run prints the check; a failed one exits 1 and alerts a person', () => {
  const h = tempHome();
  try {
    h.db.close();
    const ok = node(['scripts/backup.js', '--keep', '3'], { OF_HOME: h.home });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^backup: .*accounts-[\d-]+T[\d-]+Z\.db \(checked: 0 workspaces, 0 people; 1 nightly copies kept\)/);
    // No database there: the alert is called with what failed.
    const empty = path.join(h.home, 'empty');
    mkdirSync(empty);
    const said = path.join(h.home, 'alert.txt');
    const alertJs = path.join(h.home, 'alert.js');
    writeFileSync(alertJs, `require('node:fs').writeFileSync(${JSON.stringify(said)}, process.argv.slice(2).join('|'));`);
    writeFileSync(path.join(h.home, 'package.json'), '{"type":"commonjs"}');
    const failed = node(['scripts/backup.js'], { OF_HOME: empty, OF_ALERT: alertJs });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /backup failed: no database at/);
    assert.match(readFileSync(said, 'utf8'), /^accounts: the backup failed\|no database at /);
  } finally {
    h.cleanup();
  }
});

test('scripts/schema-check.js: 0 when this build can open the database, 3 when a newer build migrated it, 4 when a migration differs', () => {
  const h = tempHome();
  try {
    h.db.close();
    const file = path.join(h.home, 'data', 'accounts.db');
    assert.equal(node(['scripts/schema-check.js', file]).status, 0);
    let raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    raw.close();
    const ahead = node(['scripts/schema-check.js', file]);
    assert.equal(ahead.status, 3);
    assert.match(ahead.stdout, /it would not start/);
    raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    raw.exec("UPDATE schema_checksums SET sha256 = 'x' WHERE position = 1");
    raw.close();
    assert.equal(node(['scripts/schema-check.js', file]).status, 4);
    assert.equal(node(['scripts/schema-check.js', path.join(h.home, 'nope.db')]).status, 1);
  } finally {
    h.cleanup();
  }
});

test('the deploy scripts use only the server\'s checked values, and act on of-accounts alone', () => {
  for (const f of ['deploy/deploy.sh', 'deploy/rollback.sh']) {
    const s = readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(s, /^ROOT=\/opt\/openfrequency-accounts$/m, f);
    assert.match(s, /^NODE_DIR=\/opt\/node24\/bin$/m, f);
    assert.match(s, /^APP=of-accounts$/m, f);
    assert.match(s, /^READY=http:\/\/127\.0\.0\.1:4740\/readyz$/m, f);
    // Never pm2 as a whole: it runs other apps too.
    const code = s.split('\n').filter((l) => !/^\s*#/.test(l) && !/\becho\b/.test(l) && !l.includes('command -v pm2'));
    for (const line of code) for (const cmd of line.matchAll(/\bpm2 (\w+)(.*)$/g)) assert.match(cmd[2], /"\$APP"/, `${f}: pm2 ${cmd[1]} names of-accounts`);
    assert.doesNotMatch(s, /pm2 (kill|flush|save|delete all|stop all|restart all)/, f);
    assert.doesNotMatch(s, /Host: accounts\.openfrequency\.co\.il/, f);
  }
});

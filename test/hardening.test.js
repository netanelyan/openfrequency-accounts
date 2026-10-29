import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempHome } from './helpers.js';
import { startSite } from './site.js';
import { setNow, DAY } from '../src/core/clock.js';
import { createLimiter, ipKey, LIMITS } from '../src/auth/limiter.js';
import { Db, SchemaError } from '../src/db/index.js';
import { MIGRATIONS } from '../src/db/schema.js';
import { payContact } from '../src/web/app.js';
import { ACCESSIBILITY_URL } from '../src/web/html.js';

// What the audit asked of accounts besides the plans and the daily jobs: the sign-up email carries nothing a
// stranger typed and has a daily ceiling, an IPv6 address is limited by its /64 (PRA-SEC-005); every page links the
// accessibility statement (PRA-FE-002); a build refuses a database it does not know (PRA-OPS-005); /readyz asks the
// database (PRA-OPS-006); and "how do I pay" always leads to a person (ACC-02).

test('an address is limited as its network: IPv4 as it is, IPv6 by its /64, an IPv4-mapped one as IPv4', () => {
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:0db8:0001:0002:0000:0000:0000:0009'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('[2001:db8:1:2::5]'), '2001:db8:1:2::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('unknown'), 'unknown');
  // Two addresses in one /64 share the limit.
  const l = createLimiter(LIMITS.signupPerIp);
  for (let i = 1; i <= 5; i++) l.hit(ipKey(`2001:db8:1:2::${i}`), 0);
  assert.ok(l.check(ipKey('2001:db8:1:2:ffff::1'), 0));
  assert.equal(l.check(ipKey('2001:db8:1:3::1'), 0), null);
});

test('sign-up emails stop for the day at the ceiling, from every address together, and the form says so', async () => {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const limiters = { signupMail: createLimiter({ rules: [{ max: 2, windowMs: DAY }] }) };
  const site = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder' }, limiters });
  try {
    const send = async (n) => {
      const b = site.browser({ ip: `203.0.113.${n}` });
      await b.get('/signup');
      return b.post('/signup', { name: 'Noa Levi', business: `Shop ${n}`, email: `n${n}@example.com`, products: ['teder'], terms: '1', website: '', via: 'email' });
    };
    assert.equal((await send(1)).status, 200);
    assert.equal((await send(2)).status, 200);
    const third = await send(3);
    assert.equal(third.status, 429);
    assert.match(third.body, /היום נשלחו מכאן הרבה מיילים של הרשמה, אז עצרנו אותם עד מחר\./);
    assert.equal(site.mails.length, 2);
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM signups').n, 2);
  } finally {
    await site.close();
    h.cleanup();
  }
});

test('every page links the accessibility statement, the public ones first among them', async () => {
  const h = tempHome();
  const site = await startSite(h.db, { env: { OF_SIGNUP: '1' } });
  try {
    for (const p of ['/login', '/signup', '/admin/login', '/signup/confirm?t=x', '/no-such-page']) {
      const r = await site.browser().get(p);
      assert.match(r.body, new RegExp(`<footer class="site-foot"><a href="${ACCESSIBILITY_URL.replace(/[./]/g, '\\$&')}">הצהרת נגישות</a></footer>`), p);
    }
  } finally {
    await site.close();
    h.cleanup();
  }
});

test('a build refuses a database a newer build migrated, or one whose migrations it does not recognise; it records each one it ran', () => {
  const h = tempHome();
  try {
    const file = path.join(h.home, 'data', 'accounts.db');
    h.db.close();
    // Every migration recorded by its place, as it ran.
    const raw = new DatabaseSync(file);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM schema_checksums').get().n, MIGRATIONS.length);
    // A newer build was here: refused, nothing run.
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    raw.close();
    assert.throws(() => new Db(file), (e) => e instanceof SchemaError && e.code === 'ahead' && /deploy the newer build, or restore the backup/.test(e.message));
    // Back to this build's place, with a migration that is not the one it ran: refused.
    const raw2 = new DatabaseSync(file);
    raw2.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    raw2.exec("UPDATE schema_checksums SET sha256 = 'x' WHERE position = 2");
    raw2.close();
    assert.throws(() => new Db(file), (e) => e instanceof SchemaError && e.code === 'changed');
    // A database from before the checksums: taken as it is, the first time.
    const raw3 = new DatabaseSync(file);
    raw3.exec('DROP TABLE schema_checksums');
    raw3.close();
    const db = new Db(file);
    assert.deepEqual(db.schemaState(), { have: MIGRATIONS.length, want: MIGRATIONS.length, ok: true });
    db.close();
  } finally {
    h.cleanup();
  }
});

test('/readyz: 200 when the database answers at this build\'s schema, with the details only to this machine', async () => {
  const h = tempHome();
  const site = await startSite(h.db);
  try {
    const pub = await site.browser().get('/readyz');
    assert.equal(pub.status, 200);
    assert.deepEqual(JSON.parse(pub.body), { ok: true });
    const local = await site.browser({ host: `127.0.0.1:${site.s.port}`, secure: false }).get('/readyz');
    const body = JSON.parse(local.body);
    assert.deepEqual([body.ok, body.db, body.schema], [true, 'ok', { have: MIGRATIONS.length, want: MIGRATIONS.length, ok: true }]);
    assert.ok('commit' in body);
    // The database gone from under it: 503.
    h.db.close();
    const down = await site.browser().get('/readyz');
    assert.equal(down.status, 503);
    assert.deepEqual(JSON.parse(down.body), { ok: false });
  } finally {
    await site.close();
    h.cleanup();
  }
});

test('"how do I pay" leads to our WhatsApp, else a reply to MAIL_REPLY_TO, else the website\'s contact page', () => {
  assert.match(payContact({ OF_SUPPORT_WA: '972500000100' }, 'היי'), /^https:\/\/wa\.me\/972500000100\?text=/);
  assert.equal(payContact({ MAIL_REPLY_TO: 'OpenFrequency <support@in.openfrequency.co.il>' }, 'pay'), 'mailto:support@in.openfrequency.co.il?subject=pay');
  assert.equal(payContact({}, 'pay'), 'https://openfrequency.co.il/join');
});

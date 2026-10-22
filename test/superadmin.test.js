import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { makeWorkspace, tempHome } from './helpers.js';
import { startSite } from './site.js';
import { advance, now, setNow, MINUTE } from '../src/core/clock.js';
import { setSuperadmin, verifySuperadmin } from '../src/accounts/superadmin.js';
import { createSession } from '../src/auth/sessions.js';
import { newTotpSecret, stepAt, totpCode, base32Decode } from '../src/auth/totp.js';
import { Db } from '../src/db/index.js';
import { ROOT } from '../src/core/paths.js';

const EMAIL = 'admin@example.com';
const PASSWORD = 'a long enough password';

function setup() {
  const h = tempHome();
  setNow('2026-10-22T10:00:15.000Z');
  const secret = newTotpSecret();
  const { codes } = setSuperadmin(h.db, { email: EMAIL, password: PASSWORD, totpSecret: secret });
  const code = (dt = 0) => totpCode(secret, stepAt(now() + dt));
  return { ...h, secret, codes, code };
}

test('the right password with the current code signs in; a code works once', () => {
  const h = setup();
  try {
    const ok = verifySuperadmin(h.db, { email: EMAIL, password: PASSWORD, code: h.code() });
    assert.equal(ok.method, 'totp');
    assert.equal(ok.user.email, EMAIL);
    assert.equal(verifySuperadmin(h.db, { email: EMAIL, password: PASSWORD, code: h.code() }), null, 'the same code again');
    advance(30_000);
    assert.ok(verifySuperadmin(h.db, { email: EMAIL, password: PASSWORD, code: h.code() }), 'the next code');
  } finally {
    h.cleanup();
  }
});

test('a wrong password, a wrong code, an unknown email or a customer all fail the same way', () => {
  const h = setup();
  try {
    makeWorkspace(h.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner' } });
    const wrongCode = String((Number(h.code()) + 1) % 1_000_000).padStart(6, '0');
    for (const attempt of [
      { email: EMAIL, password: 'not the password', code: h.code() },
      { email: EMAIL, password: PASSWORD, code: wrongCode },
      { email: EMAIL, password: PASSWORD, code: '' },
      { email: 'nobody@example.com', password: PASSWORD, code: h.code() },
      { email: 'dana@example.com', password: PASSWORD, code: h.code() },
    ]) {
      assert.equal(verifySuperadmin(h.db, attempt), null, JSON.stringify(attempt));
    }
    assert.ok(verifySuperadmin(h.db, { email: 'ADMIN@example.com ', password: PASSWORD, code: h.code() }), 'email is not case-sensitive');
  } finally {
    h.cleanup();
  }
});

test('a recovery code works once, in any spelling, and says how many are left', () => {
  const h = setup();
  try {
    assert.equal(h.codes.length, 8);
    assert.match(h.codes[0], /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
    const ok = verifySuperadmin(h.db, { email: EMAIL, password: PASSWORD, code: h.codes[0].toUpperCase().replace(/-/g, ' ') });
    assert.deepEqual([ok.method, ok.recoveryLeft], ['recovery', 7]);
    assert.equal(verifySuperadmin(h.db, { email: EMAIL, password: PASSWORD, code: h.codes[0] }), null);
    assert.equal(verifySuperadmin(h.db, { email: EMAIL, password: 'wrong password!', code: h.codes[1] }), null, 'still needs the password');
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL').n, 7, 'a failed password does not spend a code');
    assert.ok(!h.db.all('SELECT code_hash FROM recovery_codes').some((r) => h.codes.includes(r.code_hash)), 'only hashes are stored');
  } finally {
    h.cleanup();
  }
});

test('running admin:create again replaces the password, the secret and the codes, and signs out everywhere', () => {
  const h = setup();
  try {
    const me = h.db.get('SELECT * FROM users WHERE email = ?', EMAIL);
    const s = createSession(h.db, me);
    const secret2 = newTotpSecret();
    const { codes } = setSuperadmin(h.db, { email: EMAIL, password: 'another long password', totpSecret: secret2 });
    assert.equal(h.db.get('SELECT revoked_reason FROM sessions WHERE id = ?', s.row.id).revoked_reason, 'superadmin_reset');
    assert.equal(verifySuperadmin(h.db, { email: EMAIL, password: PASSWORD, code: h.code() }), null);
    assert.equal(verifySuperadmin(h.db, { email: EMAIL, password: 'another long password', code: h.codes[0] }), null, 'old recovery codes are gone');
    assert.ok(verifySuperadmin(h.db, { email: EMAIL, password: 'another long password', code: codes[0] }));
    assert.throws(() => setSuperadmin(h.db, { email: EMAIL, password: 'short', totpSecret: secret2 }), /12 characters/);
  } finally {
    h.cleanup();
  }
});

test("a customer's address cannot become the superadmin", () => {
  const h = setup();
  try {
    makeWorkspace(h.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner' } });
    assert.throws(() => setSuperadmin(h.db, { email: 'dana@example.com', password: PASSWORD, totpSecret: h.secret }), /customer/);
  } finally {
    h.cleanup();
  }
});

// ---- over HTTP

async function site() {
  const h = setup();
  const s = await startSite(h.db);
  return { ...h, ...s, done: async () => (await s.close(), h.cleanup()) };
}

const signIn = async (b, fields) => {
  await b.get('/admin/login');
  return b.post('/admin/login', fields);
};

test('the superadmin signs in at /admin/login and gets a 12-hour session', async () => {
  const t = await site();
  try {
    const b = t.browser();
    const r = await signIn(b, { email: EMAIL, password: PASSWORD, code: t.code() });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/admin');
    assert.match(r.setCookies.find((c) => c.startsWith('__Secure-of_session=')), /Max-Age=43200/);
    const who = await t.internal(b.cookie('__Secure-of_session'));
    assert.equal(who.json.role, 'superadmin');
    assert.equal((await b.get('/admin')).status, 200);
    assert.equal((await b.get('/admin/login')).headers.location, '/admin');
  } finally {
    await t.done();
  }
});

test('every failure gets the same answer; five per address in 15 minutes, then a wait', async () => {
  const t = await site();
  try {
    const b = t.browser({ ip: '192.0.2.77' });
    const bodies = new Set();
    for (const fields of [
      { email: EMAIL, password: 'wrong password 1', code: t.code() },
      { email: EMAIL, password: PASSWORD, code: '000000' },
      { email: 'nobody@example.com', password: PASSWORD, code: t.code() },
      { email: EMAIL, password: PASSWORD, code: 'aaaa-bbbb-cccc' },
      { email: EMAIL, password: PASSWORD, code: '' },
    ]) {
      const r = await signIn(b, fields);
      assert.equal(r.status, 401);
      bodies.add(r.body.replace(/value="[^"]*"/g, ''));
    }
    assert.equal(bodies.size, 1);
    const held = await signIn(b, { email: EMAIL, password: PASSWORD, code: t.code() });
    assert.equal(held.status, 429, 'even the right answer waits');
    assert.match(held.body, /יותר מדי ניסיונות/);
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM audit WHERE action = 'admin_login_failed'").n, 5);
    // Another address is not held back.
    assert.equal((await signIn(t.browser({ ip: '192.0.2.78' }), { email: EMAIL, password: PASSWORD, code: t.code() })).status, 303);
    advance(15 * MINUTE);
    advance(30_000);
    assert.equal((await signIn(b, { email: EMAIL, password: PASSWORD, code: t.code() })).status, 303);
  } finally {
    await t.done();
  }
});

test('signing in with a recovery code says how many are left', async () => {
  const t = await site();
  try {
    const b = t.browser();
    const r = await signIn(b, { email: EMAIL, password: PASSWORD, code: t.codes[3] });
    assert.equal(r.status, 303);
    const page = await b.get('/admin');
    assert.match(page.body, /נכנסתם עם קוד גיבוי\. נשארו 7 קודים/);
  } finally {
    await t.done();
  }
});

test('a customer session cannot open the console or change anything in it', async () => {
  const t = await site();
  try {
    makeWorkspace(t.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner' } });
    const dana = t.db.get("SELECT * FROM users WHERE email = 'dana@example.com'");
    const b = t.browser();
    const sid = createSession(t.db, dana).id;
    b.jar.set('__Secure-of_session', { value: sid, attrs: [] });
    assert.equal((await b.get('/admin')).headers.location, '/admin/login');
    await b.get('/login');
    const r = await b.post('/admin/workspaces', { name: 'X', slug: 'x-shop', owner: 'x@example.com' });
    assert.equal(r.status, 403);
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM workspaces WHERE slug = 'x-shop'").n, 0);
  } finally {
    await t.done();
  }
});

// ---- npm run admin:create, as a person would run it

test('admin:create asks for a password and a code from the app, then prints recovery codes', async () => {
  const h = tempHome();
  try {
    h.db.close();
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'admin-create.js'), '--email', 'Me@Example.com'], {
      env: { ...process.env, OF_HOME: h.home, OF_ADMIN_PASSWORD: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let sentCode = false;
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes('Password for') && !out.includes('__pw__')) {
        out += '__pw__';
        child.stdin.write('too short\n');
        child.stdin.write(`${PASSWORD}\n`);
      }
      const key = /Key:\s+([A-Z2-7 ]+)\n/.exec(out);
      if (key && out.includes('code the app shows') && !sentCode) {
        sentCode = true;
        const secret = key[1].replace(/ /g, '');
        assert.equal(base32Decode(secret).length, 20);
        child.stdin.write('123456\n'); // wrong first
        child.stdin.write(`${totpCode(secret, stepAt(Date.now()))}\n`);
      }
    });
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 0, out);
    assert.match(out, /it needs 12/);
    assert.match(out, /does not match/);
    assert.match(out, /otpauth:\/\/totp\/OpenFrequency%3Ame%40example\.com\?secret=/);
    const codes = out.match(/^ {2}([a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4})$/gm);
    assert.equal(codes.length, 8);
    const db = new Db(path.join(h.home, 'data', 'accounts.db'));
    const me = db.get('SELECT * FROM users');
    db.close();
    assert.equal(me.email, 'me@example.com');
    assert.equal(me.is_superadmin, 1);
    assert.ok(!out.includes(PASSWORD));
  } finally {
    h.cleanup();
  }
});

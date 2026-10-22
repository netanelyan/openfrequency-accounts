import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword, hashPassword, DUMMY_HASH } from '../src/auth/password.js';
import { hashToken, looksLikeToken, newToken } from '../src/auth/tokens.js';
import { clientIp, cookies, csrfFor, csrfOk, isHttps, sessionSecret } from '../src/auth/http.js';

const req = ({ cookie, ip = '127.0.0.1', headers = {} } = {}) => ({ headers: { cookie, ...headers }, socket: { remoteAddress: ip } });

test('a password checks against its own hash only', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(checkPassword('correct horse battery', h));
  assert.ok(!checkPassword('correct horse batterY', h));
  assert.ok(!checkPassword('', h));
  assert.ok(!checkPassword('x', 'garbage'));
  assert.ok(!checkPassword('x', null));
  assert.notEqual(hashPassword('same'), hashPassword('same'));
  assert.ok(!checkPassword('anything', DUMMY_HASH));
});

test("a hash made by Teder's auth.js checks here (the same scrypt parameters)", () => {
  // Made by openfrequency-teder/src/web/auth.js: hashPassword('teder-password-1', Buffer.alloc(16)).
  const fromTeder = 'scrypt$00000000000000000000000000000000$22db74670fcb681c767e1e62e9dea76121157aa1cd5ad53200a062f6b78c26b9';
  assert.ok(checkPassword('teder-password-1', fromTeder));
  assert.equal(hashPassword('teder-password-1', Buffer.alloc(16)), fromTeder);
});

test('tokens are 256 random bits; only the SHA-256 is kept', () => {
  const a = newToken();
  assert.ok(looksLikeToken(a));
  assert.notEqual(a, newToken());
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(a), hashToken(a));
  for (const bad of ['', null, 'short', `${a}x`, `${a.slice(0, 42)}=`, `${a.slice(0, 42)}/`]) assert.ok(!looksLikeToken(bad), String(bad));
});

test('cookies parse, and a malformed escape does not throw', () => {
  assert.deepEqual(cookies(req({ cookie: 'a=1; __Secure-of_session=abc%3D; b=x=y' })), { a: '1', '__Secure-of_session': 'abc=', b: 'x=y' });
  assert.deepEqual(cookies(req({ cookie: 'a=%E0%A4%A' })), { a: '%E0%A4%A' });
  assert.deepEqual(cookies(req({})), {});
  assert.deepEqual(cookies(req({ cookie: '=x; ;novalue' })), {});
});

test('only the proxy on this machine may say a request came over HTTPS, or whose it is', () => {
  const viaProxy = req({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } });
  assert.ok(isHttps(viaProxy));
  assert.equal(clientIp(viaProxy), '203.0.113.5');
  const direct = req({ ip: '198.51.100.7', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4' } });
  assert.ok(!isHttps(direct));
  assert.equal(clientIp(direct), '198.51.100.7');
});

test('a CSRF token belongs to one session and is checked in constant time', () => {
  const secret = 'x'.repeat(32);
  const t = csrfFor('session-a', secret);
  assert.ok(csrfOk(t, 'session-a', secret));
  assert.ok(!csrfOk(t, 'session-b', secret));
  assert.ok(!csrfOk(t, 'session-a', 'y'.repeat(32)));
  assert.ok(!csrfOk('', 'session-a', secret));
  assert.ok(!csrfOk(t, null, secret));
});

test('a short or missing SESSION_SECRET is replaced by one that lasts until the process ends', () => {
  const a = sessionSecret({ SESSION_SECRET: 'short' });
  assert.equal(a.length, 64);
  assert.equal(sessionSecret({}), a);
  assert.equal(sessionSecret({ SESSION_SECRET: 's'.repeat(40) }), 's'.repeat(40));
});

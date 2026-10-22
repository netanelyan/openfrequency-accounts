import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, LIMITS } from '../src/auth/limiter.js';
import { MINUTE, HOUR, DAY } from '../src/core/clock.js';

const T = Date.parse('2026-10-22T10:00:00Z');

test('a key may go until its rule is full, then waits until the oldest event leaves the window', () => {
  const l = createLimiter({ rules: [{ max: 3, windowMs: 15 * MINUTE }] });
  for (let i = 0; i < 3; i++) {
    assert.equal(l.check('a', T + i * MINUTE), null);
    l.hit('a', T + i * MINUTE);
  }
  // Full at T+2m; the first event (T) leaves at T+15m.
  assert.equal(l.check('a', T + 2 * MINUTE), 13 * 60);
  assert.equal(l.check('a', T + 15 * MINUTE - 1000), 1);
  assert.equal(l.check('a', T + 15 * MINUTE), null);
});

test('keys are counted apart', () => {
  const l = createLimiter({ rules: [{ max: 1, windowMs: HOUR }] });
  l.hit('203.0.113.1', T);
  assert.ok(l.check('203.0.113.1', T));
  assert.equal(l.check('203.0.113.2', T), null);
});

test('clear forgets a key at once', () => {
  const l = createLimiter({ rules: [{ max: 1, windowMs: HOUR }] });
  l.hit('a', T);
  l.clear('a');
  assert.equal(l.check('a', T), null);
});

test('every rule applies: the longest window holds a key the short one would let through', () => {
  const l = createLimiter(LIMITS.magicPerEmail);
  let t = T;
  let sent = 0;
  // Ask as often as allowed for a day: 3 per 15 minutes, but 10 in all.
  while (t < T + DAY) {
    if (l.check('dana@example.com', t) == null) {
      l.hit('dana@example.com', t);
      sent++;
    }
    t += MINUTE;
  }
  assert.equal(sent, 10);
  // The wait reported is the longer one: until the first of the ten is a day old.
  assert.ok(l.check('dana@example.com', T + 23 * HOUR) > 30 * 60);
});

test('under a wide attack every key gets one try, and no key is locked out entirely', () => {
  const l = createLimiter(LIMITS.adminLogin);
  // 20 failures from 20 addresses inside the hour.
  for (let i = 0; i < 20; i++) l.hit(`198.51.100.${i}`, T + i * 1000);
  // A fresh address (the superadmin's) still gets a try...
  assert.equal(l.check('192.0.2.7', T + 30_000), null);
  l.hit('192.0.2.7', T + 30_000);
  // ...but only one, where it would usually get five.
  assert.ok(l.check('192.0.2.7', T + 31_000));
  // An hour after the attack the usual five are back.
  assert.equal(l.check('192.0.2.8', T + HOUR + 20_000), null);
  for (let i = 0; i < 4; i++) l.hit('192.0.2.8', T + HOUR + 20_000);
  assert.equal(l.check('192.0.2.8', T + HOUR + 21_000), null);
});

test("the superadmin's five tries per 15 minutes, as in Teder", () => {
  const l = createLimiter(LIMITS.adminLogin);
  for (let i = 0; i < 5; i++) {
    assert.equal(l.check('192.0.2.7', T + i), null);
    l.hit('192.0.2.7', T + i);
  }
  assert.ok(l.check('192.0.2.7', T + 10));
});

test('the limits for magic links: 3 per email and 10 per address in 15 minutes', () => {
  const email = createLimiter(LIMITS.magicPerEmail);
  const ip = createLimiter(LIMITS.magicPerIp);
  for (let i = 0; i < 3; i++) email.hit('dana@example.com', T + i);
  assert.ok(email.check('dana@example.com', T + 10));
  for (let i = 0; i < 10; i++) ip.hit('203.0.113.9', T + i);
  assert.ok(ip.check('203.0.113.9', T + 20));
});

test('keys are compared as strings, so an email and its object form are one key', () => {
  const l = createLimiter({ rules: [{ max: 1, windowMs: HOUR }] });
  l.hit({ toString: () => 'k' }, T);
  assert.ok(l.check('k', T));
});

test('a flood of distinct keys does not grow memory without bound', () => {
  const l = createLimiter({ rules: [{ max: 1, windowMs: HOUR }], maxKeys: 100 });
  for (let i = 0; i < 1000; i++) l.hit(`k${i}`, T);
  // The newest are remembered; the oldest were forgotten.
  assert.ok(l.check('k999', T));
  assert.equal(l.check('k0', T), null);
});

test('a limiter without rules is a mistake, not an open door', () => {
  assert.throws(() => createLimiter({ rules: [] }), /at least one rule/);
});

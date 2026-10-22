import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, newTotpSecret, otpauthUri, stepAt, totpCode, verifyTotp } from '../src/auth/totp.js';

// RFC 6238, appendix B: the SHA-1 secret is the ASCII "12345678901234567890".
// The RFC lists 8 digits; a 6-digit code is the last six of the same number.
const RFC = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('the RFC 6238 test vectors', () => {
  for (const [seconds, code] of VECTORS) {
    assert.equal(totpCode(RFC, stepAt(seconds * 1000), 8), code, `t=${seconds}`);
    assert.equal(totpCode(RFC, stepAt(seconds * 1000)), code.slice(2), `t=${seconds}, 6 digits`);
  }
});

test('base32 round-trips, and tolerates spaces, dashes, padding and lower case', () => {
  for (let n = 0; n < 40; n++) {
    const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    assert.deepEqual(base32Decode(base32Encode(b)), b);
  }
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq===='), base32Decode('GEZDGNBVGY3TQOJQ'));
  assert.throws(() => base32Decode('ABC1'), /not base32/);
});

test('a new secret is 160 random bits', () => {
  const a = newTotpSecret();
  assert.equal(base32Decode(a).length, 20);
  assert.notEqual(a, newTotpSecret());
});

test("the current code is accepted, and so are the step before and after (a phone's clock drifts)", () => {
  const secret = newTotpSecret();
  const t = Date.parse('2026-10-22T10:00:15Z');
  const s = stepAt(t);
  for (const d of [-1, 0, 1]) assert.equal(verifyTotp(secret, totpCode(secret, s + d), { t }), s + d, `drift ${d}`);
  for (const d of [-3, -2, 2, 3]) assert.equal(verifyTotp(secret, totpCode(secret, s + d), { t }), null, `drift ${d}`);
});

test('a code works once: its step, and any step before it, is refused next time', () => {
  const secret = newTotpSecret();
  const t = Date.parse('2026-10-22T10:00:15Z');
  const code = totpCode(secret, stepAt(t));
  const used = verifyTotp(secret, code, { t });
  assert.equal(used, stepAt(t));
  assert.equal(verifyTotp(secret, code, { t, lastStep: used }), null);
  // The previous step's code is still inside the drift window but older than the used one.
  assert.equal(verifyTotp(secret, totpCode(secret, used - 1), { t, lastStep: used }), null);
  // The next step's code is new and is accepted.
  assert.equal(verifyTotp(secret, totpCode(secret, used + 1), { t: t + 30_000, lastStep: used }), used + 1);
});

test('anything but six digits is refused without a lookup; spaces inside are fine', () => {
  const secret = newTotpSecret();
  const t = Date.now();
  const code = totpCode(secret, stepAt(t));
  assert.equal(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { t }), stepAt(t));
  for (const bad of ['', null, undefined, '12345', '1234567', 'abcdef', `${code}0`, ` ${code}x`]) assert.equal(verifyTotp(secret, bad, { t }), null, String(bad));
});

test('the otpauth URI says what an authenticator app needs', () => {
  const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'admin@example.com');
  assert.match(uri, /^otpauth:\/\/totp\/OpenFrequency%3Aadmin%40example\.com\?/);
  const q = new URL(uri).searchParams;
  assert.equal(q.get('issuer'), 'OpenFrequency');
  assert.equal(q.get('digits'), '6');
  assert.equal(q.get('period'), '30');
  assert.equal(q.get('algorithm'), 'SHA1');
});

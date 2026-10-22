import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { now } from '../core/clock.js';

// TOTP (RFC 6238) for the superadmin's second factor: HMAC-SHA1, 30-second
// steps, 6 digits, which every authenticator app reads from an otpauth:// URI.
// Built on node:crypto rather than a dependency.
//
// A code from the step before or after the current one is accepted (a phone's
// clock drifts), and a step is accepted once: the caller stores the step it gets
// back and passes it as lastStep next time, so a code seen over a shoulder or
// in a log cannot be used again.

const STEP_MS = 30_000;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, base32, as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const stepAt = (t = now()) => Math.floor(t / STEP_MS);

/** The code for one step. */
export function totpCode(secret, step, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const off = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, '0');
}

/**
 * The step a code proves, or null: wrong, too old, or a step at or before
 * lastStep (already used).
 */
export function verifyTotp(secret, code, { t = now(), lastStep = null, window = 1 } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const current = stepAt(t);
  let found = null;
  // Every candidate is computed and compared, so timing does not say which one matched.
  for (let s = current - window; s <= current + window; s++) {
    const ok = timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(given));
    if (ok && (lastStep == null || s > lastStep) && found == null) found = s;
  }
  return found;
}

/** What an authenticator app scans (or has typed in) to add the account. */
export function otpauthUri(secret, account, issuer = 'OpenFrequency') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_MS / 1000}`;
}

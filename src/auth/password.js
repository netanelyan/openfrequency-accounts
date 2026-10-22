import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// The superadmin's password: scrypt with a per-user salt. Ported unchanged from
// Teder's auth.js, so a hash made there checks here.

const PARAMS = { N: 16384, r: 8, p: 1 };
export const MIN_PASSWORD = 12;

export function hashPassword(password, salt = randomBytes(16)) {
  const key = scryptSync(String(password), salt, 32, PARAMS);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function checkPassword(password, stored) {
  const m = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(String(stored || ''));
  if (!m) return false;
  const want = Buffer.from(m[2], 'hex');
  const got = scryptSync(String(password), Buffer.from(m[1], 'hex'), want.length, PARAMS);
  return timingSafeEqual(want, got);
}

/** A hash to check against when there is no user, so a wrong email costs as long as a wrong password. */
export const DUMMY_HASH = hashPassword('not a password', Buffer.alloc(16));

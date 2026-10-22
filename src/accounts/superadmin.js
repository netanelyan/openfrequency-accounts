import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { checkPassword, DUMMY_HASH, hashPassword, MIN_PASSWORD } from '../auth/password.js';
import { base32Encode, stepAt, verifyTotp } from '../auth/totp.js';

// The superadmin: one account, made from the terminal (npm run admin:create),
// signed in with a password and a TOTP code, or a one-time recovery code when
// the phone is lost.
//
// The TOTP secret sits in the database as it is: anyone holding a copy of the
// database still needs the password, which is only there as a scrypt hash.

const RECOVERY_COUNT = 8;

const hashCode = (code) => createHash('sha256').update(normCode(code)).digest('hex');
const normCode = (code) => String(code ?? '').toLowerCase().replace(/[\s-]/g, '');

/** Eight codes like "k3vq-7mxa-p2rd": 60 random bits each, kept only as hashes. */
export function newRecoveryCodes(db, userId) {
  db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  const codes = [];
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const raw = base32Encode(randomBytes(8)).slice(0, 12).toLowerCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    db.insert('recovery_codes', { user_id: userId, code_hash: hashCode(code) });
    codes.push(code);
  }
  return codes;
}

/**
 * Create the superadmin, or replace its password and TOTP secret. Every existing
 * session of that user ends, and new recovery codes replace the old ones.
 */
export function setSuperadmin(db, { email, password, totpSecret }) {
  if (String(password).length < MIN_PASSWORD) throw new Error(`a password needs at least ${MIN_PASSWORD} characters`);
  return db.tx(() => {
    const existing = db.get('SELECT * FROM users WHERE email = ?', email);
    const fields = { is_superadmin: 1, password_hash: hashPassword(password), totp_secret: totpSecret, totp_last_step: null, disabled_at: null };
    let id;
    if (existing) {
      if (!existing.is_superadmin && db.get('SELECT 1 FROM memberships WHERE user_id = ?', existing.id)) throw new Error(`${email} is a customer in a workspace; use another address for the superadmin`);
      db.update('users', existing.id, fields);
      id = existing.id;
      db.run("UPDATE sessions SET revoked_at = ?, revoked_reason = 'superadmin_reset' WHERE user_id = ? AND revoked_at IS NULL", nowIso(), id);
    } else {
      id = db.insert('users', { email, name: '', created_at: nowIso(), ...fields });
    }
    const codes = newRecoveryCodes(db, id);
    audit(db, { actor: { id, email }, action: existing ? 'superadmin_reset' : 'superadmin_created' });
    return { id, codes };
  });
}

/**
 * Check a superadmin sign-in. Returns { user, method, recoveryLeft } or null.
 * The password is always hashed, even for an unknown email, so the time taken
 * does not say which part was wrong.
 */
export function verifySuperadmin(db, { email, password, code }) {
  const user = db.get('SELECT * FROM users WHERE email = ? AND is_superadmin = 1 AND disabled_at IS NULL', String(email ?? '').trim().toLowerCase());
  const passOk = checkPassword(password ?? '', user?.password_hash || DUMMY_HASH);
  if (!user || !passOk) return null;

  const given = String(code ?? '').replace(/\s/g, '');
  if (/^\d{6}$/.test(given)) {
    const step = verifyTotp(user.totp_secret, given, { t: now(), lastStep: user.totp_last_step });
    if (step == null) return null;
    // Record the step only if no one recorded it (or a later one) first: a code works once.
    const r = db.run('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)', step, user.id, step);
    if (Number(r.changes) !== 1) return null;
    return { user, method: 'totp' };
  }

  if (normCode(given).length === 12) {
    const want = hashCode(given);
    const rows = db.all('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', user.id);
    const hit = rows.find((r) => timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(want)));
    if (!hit) return null;
    const r = db.run('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), hit.id);
    if (Number(r.changes) !== 1) return null;
    const left = db.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', user.id).n;
    return { user, method: 'recovery', recoveryLeft: left };
  }
  return null;
}

/** For the terminal: is this the code the app shows right now? */
export const totpMatches = (secret, code) => verifyTotp(secret, code, { t: now() }) != null;
export { stepAt };

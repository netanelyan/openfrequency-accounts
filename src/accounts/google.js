import { audit } from '../core/audit.js';

// Who a Google account is here. Google signs nobody up: like the emailed link,
// it opens an account that already exists (or, with an invite, the one the
// invite makes). The superadmin never signs in this way.
//
// The first time, the user is found by the address Google has verified and the
// Google account's sub is kept on them (migration 5). From then on the sub is
// what counts: a user whose address is bound to a different Google account is
// not let in by this one.

const usable = (u) => Boolean(u && !u.disabled_at && !u.is_superadmin);

/** The customer this Google account signs in as, or null. Binds the sub on first use and fills an empty name. */
export function userForGoogle(db, { sub, email, name = '' }, { ip = null } = {}) {
  const bySub = db.get('SELECT * FROM users WHERE google_sub = ?', sub);
  const user = bySub || db.get('SELECT * FROM users WHERE email = ?', email);
  const ok = usable(user) && (bySub || !user.google_sub);
  audit(db, { actor: ok ? user : null, action: ok ? 'sign_in' : 'google_refused', ip, detail: { method: 'google', email } });
  if (!ok) return null;
  bindGoogle(db, user, { sub, name });
  return db.get('SELECT * FROM users WHERE id = ?', user.id);
}

/** Keep the Google account on a user that has none yet, and its name if theirs is empty. */
export function bindGoogle(db, user, { sub, name = '' }) {
  const change = {};
  if (!user.google_sub && !db.get('SELECT 1 FROM users WHERE google_sub = ?', sub)) change.google_sub = sub;
  if (!user.name && name) change.name = name;
  if (Object.keys(change).length) db.update('users', user.id, change);
}

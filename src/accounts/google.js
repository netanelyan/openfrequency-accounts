import { audit } from '../core/audit.js';

// Who a Google account is here. Google signs nobody up: like the emailed link,
// it opens an account that already exists (or, with an invite, the one the
// invite makes). The superadmin never signs in this way.
//
// The first time, the user is found by the address Google has verified and the
// Google account's sub is kept on them (migration 5). From then on the sub is
// what counts: a user whose address is bound to a different Google account is
// not let in by this one.
//
// A Gmail address is one mailbox under many spellings: Gmail ignores dots and
// anything after a "+" in its local part, and googlemail.com is gmail.com. Google
// reports the plain one (dana@gmail.com), while the account here may have been
// made as dana+shop@gmail.com. Both reach the same inbox, so whoever holds that
// Google account would get the emailed link for either: the address is matched
// by its mailbox (mailbox()), first exactly, then by mailbox when exactly one
// customer account has it. Any other domain is matched as written.

const usable = (u) => Boolean(u && !u.disabled_at && !u.is_superadmin);
const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** The mailbox an address reaches: Gmail's without dots and +tags, any other as written (lower case). */
export function mailbox(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  const domain = e.slice(at + 1);
  if (!GMAIL.has(domain)) return e;
  return `${e.slice(0, at).split('+')[0].replace(/\./g, '')}@gmail.com`;
}

/** The customer accounts made for this mailbox under another spelling, not yet tied to a Google account. */
function sameMailbox(db, email) {
  const box = mailbox(email);
  if (box === String(email || '').trim().toLowerCase() && !box.endsWith('@gmail.com')) return [];
  return db.all("SELECT * FROM users WHERE email LIKE '%@gmail.com' OR email LIKE '%@googlemail.com'").filter((u) => mailbox(u.email) === box && usable(u) && !u.google_sub);
}

/** The customer this Google account signs in as, or null. Binds the sub on first use and fills an empty name. */
export function userForGoogle(db, { sub, email, name = '' }, { ip = null } = {}) {
  const bySub = db.get('SELECT * FROM users WHERE google_sub = ?', sub);
  let user = null;
  if (bySub) user = usable(bySub) ? bySub : null;
  else {
    const exact = db.get('SELECT * FROM users WHERE email = ?', email);
    if (usable(exact) && !exact.google_sub) user = exact;
    else {
      // The same Gmail mailbox under another spelling, when exactly one customer account has it.
      const others = sameMailbox(db, email);
      if (others.length === 1) user = others[0];
    }
  }
  audit(db, { actor: user, action: user ? 'sign_in' : 'google_refused', ip, detail: { method: 'google', email, ...(user && user.email !== email ? { account: user.email } : {}) } });
  if (!user) return null;
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

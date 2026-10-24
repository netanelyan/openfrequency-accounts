import { randomInt } from 'node:crypto';
import { now, nowIso, MINUTE } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { enabledProducts, workspaceOut } from '../auth/sessions.js';

// Who a WhatsApp number is, for the owner line (docs/internal-owner-phone.md). Accounts never sends anything to a
// phone. The number proves itself by writing: the customer makes a link code on their home page, sends it from their
// WhatsApp to the owner line, and Toran tells us which number sent it (claim). Then the number is that user's, in
// that workspace, until it is removed.
//
// Consent to updates on WhatsApp is kept as the latest opt-in and the latest opt-out, each with its time and where it
// was said (the box on the home page, the toggle there, "הפסק" and "התחל" on WhatsApp). The later of the two speaks
// for now; on a tie, the opt-out. Every link, claim, removal and consent is in the audit log, never the code itself.

export class PhoneError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** International digits: a country code and a number, 8 to 15 digits, no + and no leading 0. */
export const PHONE = /^[1-9]\d{7,14}$/;
export const validPhone = (p) => typeof p === 'string' && PHONE.test(p);

// No 0/O, 1/I/L: a code is read off a screen and typed, sometimes.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE = /^LINK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const LINK_MS = 30 * MINUTE;

const newCode = () => `LINK-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

/**
 * A new link code for a user in a workspace, with their answer to "send me updates on WhatsApp". An older code of
 * theirs that is still open ends now: one code at a time. Returns { code, expiresAt, optIn }.
 */
export function createLinkCode(db, { user, workspaceId, optIn = false, ip = null }) {
  return db.tx(() => {
    const t = nowIso();
    db.run('UPDATE phone_links SET expires_at = ? WHERE user_id = ? AND workspace_id = ? AND used_at IS NULL AND expires_at > ?', t, user.id, workspaceId, t);
    let code;
    do code = newCode();
    while (db.get('SELECT 1 FROM phone_links WHERE code = ?', code));
    const expiresAt = new Date(now() + LINK_MS).toISOString();
    db.insert('phone_links', { code, user_id: user.id, workspace_id: workspaceId, opt_in: optIn ? 1 : 0, created_at: t, expires_at: expiresAt });
    audit(db, { actor: user, action: 'phone_link_created', workspaceId, ip, detail: { optIn: Boolean(optIn), expiresAt } });
    return { code, expiresAt, optIn: Boolean(optIn) };
  });
}

/** The user's open code in this workspace, if there is one: what the home page shows. */
export const openLinkCode = (db, userId, workspaceId) =>
  db.get('SELECT * FROM phone_links WHERE user_id = ? AND workspace_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', userId, workspaceId, nowIso());

// A number, with who it belongs to. Only while that person is still a member of the workspace and not disabled:
// otherwise it is nobody's.
const LINKED = `SELECT p.*, u.name AS user_name, u.email AS user_email, m.role, w.slug, w.name AS workspace_name, w.disabled_at
  FROM user_phones p
  JOIN users u ON u.id = p.user_id AND u.disabled_at IS NULL
  JOIN memberships m ON m.user_id = p.user_id AND m.workspace_id = p.workspace_id
  JOIN workspaces w ON w.id = p.workspace_id`;

/** Which of the two speaks for now. On a tie, the opt-out. */
export const optedIn = (r) => Boolean(r.opt_in_at && (!r.opt_out_at || r.opt_in_at > r.opt_out_at));

/** The owner object, as every internal route answers it. */
function owner(db, r) {
  const outSpeaks = Boolean(r.opt_out_at) && !optedIn(r);
  return {
    phone: r.phone,
    verifiedAt: r.verified_at,
    user: { id: r.user_id, name: r.user_name, email: r.user_email },
    workspace: workspaceOut({ id: r.workspace_id, slug: r.slug, name: r.workspace_name, disabled_at: r.disabled_at }),
    role: r.role,
    products: enabledProducts(db, r.workspace_id),
    optIn: r.opt_in_at ? { at: r.opt_in_at, source: r.opt_in_source } : null,
    optOut: outSpeaks ? { at: r.opt_out_at, source: r.opt_out_source } : null,
  };
}

/** The owner a number is, or null. A disabled workspace's numbers are answered, with workspace.disabled. */
export function ownerOf(db, phone) {
  if (!validPhone(phone)) throw new PhoneError('bad_phone');
  const r = db.get(`${LINKED} WHERE p.phone = ?`, phone);
  return r ? owner(db, r) : null;
}

/** Every verified number of a workspace, oldest first. */
export const ownersOf = (db, workspaceId) => db.all(`${LINKED} WHERE p.workspace_id = ? ORDER BY p.created_at, p.phone`, workspaceId).map((r) => owner(db, r));

/**
 * Record what someone said about updates, at a time. Each column keeps only the latest of its kind, so the order the
 * calls come in does not matter. True when it was recorded (it is the newest of its kind).
 */
function consent(db, row, { optIn, at, source, actor, ip }) {
  const col = optIn ? 'opt_in' : 'opt_out';
  if (row[`${col}_at`] && row[`${col}_at`] >= at) return false;
  db.run(`UPDATE user_phones SET ${col}_at = ?, ${col}_source = ? WHERE phone = ?`, at, source, row.phone);
  audit(db, { actor, action: optIn ? 'phone_opt_in' : 'phone_opt_out', workspaceId: row.workspace_id, ip, detail: { phone: row.phone, at, source } });
  return true;
}

/**
 * The number that sent a code is that code's user's, in that workspace: linked, verified now, with the code's answer
 * about updates (as said when the code was made). Throws PhoneError: unknown_code, used, expired, phone_taken.
 */
export function claimPhone(db, { code, phone, ip = null }) {
  if (!validPhone(phone)) throw new PhoneError('bad_phone');
  code = String(code ?? '').trim().toUpperCase();
  return db.tx(() => {
    const link = CODE.test(code) ? db.get('SELECT * FROM phone_links WHERE code = ?', code) : null;
    // A code whose person has left the workspace, or was disabled, is nobody's code.
    const user = link && db.get('SELECT u.* FROM users u JOIN memberships m ON m.user_id = u.id AND m.workspace_id = ? WHERE u.id = ? AND u.disabled_at IS NULL', link.workspace_id, link.user_id);
    if (!user) throw new PhoneError('unknown_code');
    if (link.used_at) throw new PhoneError('used');
    if (link.expires_at <= nowIso()) throw new PhoneError('expired');

    const t = nowIso();
    let row = db.get('SELECT * FROM user_phones WHERE phone = ?', phone);
    const same = Boolean(row) && row.user_id === link.user_id && row.workspace_id === link.workspace_id;
    if (row && !same) {
      // Someone else's number stays theirs until it is removed there. A row nobody holds any more (they left the
      // workspace, or were disabled) is not a link: it goes.
      if (db.get(`${LINKED} WHERE p.phone = ?`, phone)) throw new PhoneError('phone_taken');
      db.run('DELETE FROM user_phones WHERE phone = ?', phone);
      row = null;
    }
    db.update('phone_links', code, { used_at: t, used_phone: phone }, 'code');
    if (row) db.update('user_phones', phone, { verified_at: t }, 'phone');
    else db.insert('user_phones', { phone, user_id: link.user_id, workspace_id: link.workspace_id, verified_at: t, created_at: t });
    audit(db, { actor: user, action: 'phone_linked', workspaceId: link.workspace_id, ip, detail: { phone, again: same } });

    // The box on the form: ticked is an opt-in at the time the code was made. Unticked, on a number that had said
    // yes, is the customer changing their mind; on a new number it is only "not asked yet".
    row = db.get('SELECT * FROM user_phones WHERE phone = ?', phone);
    if (link.opt_in) consent(db, row, { optIn: true, at: link.created_at, source: 'accounts', actor: user, ip });
    else if (optedIn(row)) consent(db, row, { optIn: false, at: link.created_at, source: 'accounts', actor: user, ip });
    return ownerOf(db, phone);
  });
}

/** Updates on or off for a linked number, said now. Throws PhoneError not_linked. */
export function setConsent(db, phone, { optIn, source, actor = null, ip = null }) {
  if (!validPhone(phone)) throw new PhoneError('bad_phone');
  return db.tx(() => {
    const row = db.get(`${LINKED} WHERE p.phone = ?`, phone);
    if (!row) throw new PhoneError('not_linked');
    consent(db, row, { optIn: Boolean(optIn), at: nowIso(), source, actor: actor || { id: row.user_id, email: row.user_email }, ip });
    return ownerOf(db, phone);
  });
}

/** Unlink a number. Gone from user_phones; the audit log keeps it. False when there was nothing to remove. */
export function removePhone(db, phone, { by, ip = null }) {
  return db.tx(() => {
    const row = db.get('SELECT * FROM user_phones WHERE phone = ?', phone);
    if (!row) return false;
    db.run('DELETE FROM user_phones WHERE phone = ?', phone);
    audit(db, { actor: by, action: 'phone_removed', workspaceId: row.workspace_id, ip, detail: { phone, userId: row.user_id } });
    return true;
  });
}

/**
 * The numbers the home page lists for a user: their own, and for the workspace's owner every number in it. Each with
 * whose it is and whether its updates are on.
 */
export function phonesFor(db, { userId, workspaceId, role }) {
  const rows = db.all(`${LINKED} WHERE p.workspace_id = ?${role === 'client_owner' ? '' : ' AND p.user_id = ?'} ORDER BY p.user_id = ? DESC, p.created_at, p.phone`, ...(role === 'client_owner' ? [workspaceId, userId] : [workspaceId, userId, userId]));
  return rows.map((r) => ({ phone: r.phone, userId: r.user_id, name: r.user_name, email: r.user_email, mine: r.user_id === userId, updates: optedIn(r), verifiedAt: r.verified_at }));
}

/** One number of this workspace, as phonesFor lists it, or null. */
export const phoneIn = (db, phone, workspaceId) => (validPhone(phone) ? db.get(`${LINKED} WHERE p.phone = ? AND p.workspace_id = ?`, phone, workspaceId) : null);

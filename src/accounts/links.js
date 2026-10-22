import { isoIn, nowIso, MINUTE, HOUR } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { hashToken, looksLikeToken, newToken } from '../auth/tokens.js';

// Magic links and invites. Both are a random token in an email, stored only as
// its SHA-256, good once, for a short while.
//
//   magic   15 minutes. Only for an existing, active customer: there is no
//           public signup, and the superadmin signs in with a password and TOTP.
//   invite  72 hours. Made by the superadmin for one email, one workspace and one
//           role. Accepting it creates the user if needed and adds the membership.
//
// Using a token is one UPDATE ... WHERE used_at IS NULL, so two clicks racing
// each other (or an email scanner and a person) cannot both get in.

export const MAGIC_TTL = 15 * MINUTE;
export const INVITE_TTL = 72 * HOUR;

export const normEmail = (e) => String(e ?? '').trim().toLowerCase();

/** A plain address: something@something.tld, no spaces or angle brackets, 254 characters at most. */
export function validEmail(e) {
  const s = String(e ?? '');
  return s.length <= 254 && /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\.]+(\.[^\s@<>()[\]",;:\\.]+)+$/.test(s);
}

// ---- magic links

/**
 * A new link for `email`, or null when the address is not an active customer.
 * The caller shows the same page either way, so the answer never says who has
 * an account.
 */
export function requestMagicLink(db, email, { next = null, ip = null } = {}) {
  const user = db.get('SELECT * FROM users WHERE email = ?', email);
  const ok = Boolean(user && !user.disabled_at && !user.is_superadmin);
  audit(db, { actor: ok ? user : null, action: 'magic_link_requested', ip, detail: { email, sent: ok } });
  if (!ok) return null;
  const token = newToken();
  db.insert('tokens', { token_hash: hashToken(token), kind: 'magic', email: user.email, user_id: user.id, next_url: next, created_at: nowIso(), expires_at: isoIn(MAGIC_TTL), ip });
  return { token, user };
}

const live = (kind) => `kind = '${kind}' AND used_at IS NULL AND expires_at > ?`;

/** The link's row and user if it still works, without using it up (the page before the button). */
export function peekMagicLink(db, token) {
  if (!looksLikeToken(token)) return null;
  const row = db.get(`SELECT * FROM tokens WHERE token_hash = ? AND ${live('magic')}`, hashToken(token), nowIso());
  if (!row) return null;
  const user = db.get('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL AND is_superadmin = 0', row.user_id);
  return user ? { row, user } : null;
}

/** Use the link up. Returns { user, next } once; null every other time. */
export function consumeMagicLink(db, token, { ip = null } = {}) {
  if (!looksLikeToken(token)) return null;
  return db.tx(() => {
    const t = nowIso();
    const r = db.run(`UPDATE tokens SET used_at = ? WHERE token_hash = ? AND ${live('magic')}`, t, hashToken(token), t);
    if (Number(r.changes) !== 1) return null;
    const row = db.get('SELECT * FROM tokens WHERE token_hash = ?', hashToken(token));
    const user = db.get('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL AND is_superadmin = 0', row.user_id);
    if (!user) return null;
    // Any other link this user still holds is spent too: one sign-in, one link.
    db.run(`UPDATE tokens SET used_at = ? WHERE user_id = ? AND ${live('magic')}`, t, user.id, t);
    audit(db, { actor: user, action: 'sign_in', ip, detail: { method: 'magic_link' } });
    return { user, next: row.next_url };
  });
}

// ---- invites

export class InviteError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** A new invite. Throws InviteError: bad_email, superadmin_email, no_workspace, workspace_disabled. */
export function createInvite(db, { workspaceId, email, role, by = null, ip = null }) {
  email = normEmail(email);
  if (!validEmail(email)) throw new InviteError('bad_email');
  if (!['client_owner', 'client_member'].includes(role)) throw new InviteError('bad_role');
  const w = db.get('SELECT * FROM workspaces WHERE id = ?', workspaceId);
  if (!w) throw new InviteError('no_workspace');
  if (w.disabled_at) throw new InviteError('workspace_disabled');
  const existing = db.get('SELECT * FROM users WHERE email = ?', email);
  if (existing?.is_superadmin) throw new InviteError('superadmin_email');
  const token = newToken();
  const expiresAt = isoIn(INVITE_TTL);
  db.insert('tokens', { token_hash: hashToken(token), kind: 'invite', email, user_id: existing?.id ?? null, workspace_id: w.id, role, created_by: by?.id ?? null, created_at: nowIso(), expires_at: expiresAt, ip });
  audit(db, { actor: by, action: 'invite_sent', workspaceId: w.id, ip, detail: { email, role } });
  return { token, workspace: w, email, role, expiresAt };
}

/** The invite and its workspace if it still works, without using it up. */
export function peekInvite(db, token) {
  if (!looksLikeToken(token)) return null;
  const row = db.get(`SELECT * FROM tokens WHERE token_hash = ? AND ${live('invite')}`, hashToken(token), nowIso());
  if (!row) return null;
  const workspace = db.get('SELECT * FROM workspaces WHERE id = ? AND disabled_at IS NULL', row.workspace_id);
  return workspace ? { row, workspace } : null;
}

/**
 * Accept: create the user if new, add the membership (an existing one keeps its
 * role), use the invite up. Returns { user, workspace } once; null otherwise.
 */
export function acceptInvite(db, token, { name = '', ip = null } = {}) {
  if (!looksLikeToken(token)) return null;
  try {
    return acceptInTx(db, token, { name, ip });
  } catch (e) {
    if (isRollback(e)) return null;
    throw e;
  }
}

function acceptInTx(db, token, { name, ip }) {
  return db.tx(() => {
    const t = nowIso();
    const r = db.run(`UPDATE tokens SET used_at = ? WHERE token_hash = ? AND ${live('invite')}`, t, hashToken(token), t);
    if (Number(r.changes) !== 1) return null;
    const row = db.get('SELECT * FROM tokens WHERE token_hash = ?', hashToken(token));
    const workspace = db.get('SELECT * FROM workspaces WHERE id = ? AND disabled_at IS NULL', row.workspace_id);
    if (!workspace) throw rollback();
    let user = db.get('SELECT * FROM users WHERE email = ?', row.email);
    if (user && (user.disabled_at || user.is_superadmin)) throw rollback();
    if (!user) {
      const id = db.insert('users', { email: row.email, name: String(name).trim().slice(0, 80), created_at: t });
      user = db.get('SELECT * FROM users WHERE id = ?', id);
    } else if (!user.name && name) {
      db.update('users', user.id, { name: String(name).trim().slice(0, 80) });
      user.name = String(name).trim().slice(0, 80);
    }
    db.run('INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', user.id, workspace.id, row.role, t);
    audit(db, { actor: user, action: 'invite_accepted', workspaceId: workspace.id, ip, detail: { role: row.role } });
    return { user, workspace };
  });
}

// A refused acceptance leaves the invite unused: the transaction is rolled back.
const ROLLBACK = Symbol('rollback');
const rollback = () => Object.assign(new Error('rollback'), { [ROLLBACK]: true });
const isRollback = (e) => Boolean(e?.[ROLLBACK]);

/** Cancel an invite that has not been used. */
export function revokeInvite(db, tokenId, { by = null, ip = null } = {}) {
  const row = db.get(`SELECT * FROM tokens WHERE id = ? AND kind = 'invite' AND used_at IS NULL`, tokenId);
  if (!row) return false;
  db.update('tokens', row.id, { used_at: nowIso(), expires_at: nowIso() });
  audit(db, { actor: by, action: 'invite_revoked', workspaceId: row.workspace_id, ip, detail: { email: row.email } });
  return true;
}

import { nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { createInvite, InviteError, normEmail, revokeInvite, validEmail } from './links.js';

// The people in a workspace, as its owner manages them from the home page: invite someone by email (the same
// 72-hour invite the console sends), cancel an invite that has not been used, remove someone.
//
// A workspace holds TEAM_LIMIT people, its owners included, and an invite still waiting holds a place too, so
// accepting one never takes a workspace past the limit. Past it, the customer talks to us: the console (the
// superadmin) is not limited, and anyone it adds counts like everyone else. The count and the new invite are one
// transaction (BEGIN IMMEDIATE), so two invites sent at once cannot both take the last place.

export const TEAM_LIMIT = 3;

export class TeamError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** The workspace's people (signed-up, not disabled), its invites still waiting, and how many places they take. */
export function teamOf(db, workspaceId) {
  const members = db.all(
    'SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.disabled_at IS NULL ORDER BY m.created_at, u.id',
    workspaceId
  );
  // An invite to someone already in (the console can send one) takes no second place.
  const invites = db.all(
    `SELECT t.id, t.email, t.role, t.expires_at FROM tokens t
      WHERE t.kind = 'invite' AND t.workspace_id = ? AND t.used_at IS NULL AND t.expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = t.workspace_id AND u.email = t.email)
      ORDER BY t.created_at, t.id`,
    workspaceId,
    nowIso()
  );
  const taken = members.length + new Set(invites.map((i) => i.email.toLowerCase())).size;
  return { members, invites, taken, limit: TEAM_LIMIT, full: taken >= TEAM_LIMIT };
}

const isOwner = (db, userId, workspaceId) => db.get("SELECT 1 FROM memberships WHERE user_id = ? AND workspace_id = ? AND role = 'client_owner'", userId, workspaceId);

/**
 * An owner invites someone. A second invite to the same address replaces the first (the old link stops working)
 * and takes no new place. Returns createInvite()'s { token, email, role, expiresAt, workspace }. Throws TeamError
 * (not_owner, already_member, team_full) or InviteError (bad_email, bad_role, superadmin_email, ...).
 */
export function inviteToTeam(db, { workspaceId, email, role, by, ip = null }) {
  email = normEmail(email);
  if (!validEmail(email)) throw new InviteError('bad_email');
  if (!['client_owner', 'client_member'].includes(role)) throw new InviteError('bad_role');
  return db.tx(() => {
    if (!isOwner(db, by.id, workspaceId)) throw new TeamError('not_owner');
    const team = teamOf(db, workspaceId);
    if (team.members.some((m) => m.email.toLowerCase() === email)) throw new TeamError('already_member');
    const again = team.invites.filter((i) => i.email.toLowerCase() === email);
    if (!again.length && team.full) throw new TeamError('team_full');
    for (const i of again) revokeInvite(db, i.id, { by, ip });
    return createInvite(db, { workspaceId, email, role, by, ip });
  });
}

/** An owner cancels an invite of their own workspace that is still waiting. Returns its email, or null. */
export function cancelTeamInvite(db, { workspaceId, tokenId, by, ip = null }) {
  return db.tx(() => {
    if (!isOwner(db, by.id, workspaceId)) throw new TeamError('not_owner');
    const row = db.get("SELECT id, email FROM tokens WHERE id = ? AND kind = 'invite' AND workspace_id = ? AND used_at IS NULL", Number(tokenId), workspaceId);
    if (!row || !revokeInvite(db, row.id, { by, ip })) return null;
    return row.email;
  });
}

/**
 * An owner removes someone from the workspace: never themselves, and never its last owner. Their browsers leave the
 * workspace on the next request (the session reads the membership fresh). Returns the user removed, or null.
 */
export function removeMember(db, { workspaceId, userId, by, ip = null }) {
  return db.tx(() => {
    if (!isOwner(db, by.id, workspaceId)) throw new TeamError('not_owner');
    if (Number(userId) === by.id) throw new TeamError('not_self');
    const m = db.get('SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.user_id = ?', workspaceId, Number(userId));
    if (!m) return null;
    if (m.role === 'client_owner' && db.get("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'client_owner'", workspaceId).n <= 1) throw new TeamError('last_owner');
    db.run('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?', workspaceId, m.id);
    db.run('UPDATE sessions SET workspace_id = NULL WHERE user_id = ? AND workspace_id = ?', m.id, workspaceId);
    audit(db, { actor: by, action: 'member_removed', workspaceId, ip, detail: { email: m.email, role: m.role } });
    return m;
  });
}

import { nowIso } from './clock.js';

// The audit log: every sign-in, link, invite and superadmin action, as it happens.
// Never a password, a code, a token or a session id.

export function audit(db, { actor = null, action, workspaceId = null, ip = null, detail = null }) {
  db.insert('audit', {
    at: nowIso(),
    actor_id: actor?.id ?? null,
    actor: actor?.email ?? 'system',
    action,
    workspace_id: workspaceId,
    ip,
    detail_json: detail,
  });
}

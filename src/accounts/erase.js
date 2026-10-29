import { nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { WorkspaceError, getWorkspace } from './workspaces.js';

// Deleting a workspace and its data, as its owner asks on /account/delete or the superadmin on /admin. The products
// are asked first (src/web/erase.js: Teder's and Toran's POST /internal/workspaces/<id>/delete); only once each has
// deleted its part (or said it had nothing, with a 2xx) does eraseWorkspace() below delete ours, in one transaction:
//
//   deleted   the people's memberships, the invites, the products and their subscriptions, the WhatsApp numbers and
//             link codes, the notification choices and log, the sign-up that opened it, and every person who was in
//             this workspace and no other (their email, name, sessions and links). Everyone else's sessions leave it.
//   kept      the invoices, with their PDFs: the law asks us to keep them. Each is marked detached, with the business
//             it was for written on it. The audit log (who did what, when) stays as the security record it is.
//   the row   stays, emptied (no name, slug deleted-<id>-, disabled, deleted_at), so its id is never given to another
//             workspace: Teder and Toran key their data by it. The slug ends in a hyphen, which neither the console
//             nor the sign-up ever makes, so it never stands in a new workspace's way.

/** The products a workspace has ever had (on or off, or a subscription): the ones that may hold its data. */
export const productsEver = (db, workspaceId) =>
  PRODUCTS.filter(
    (p) =>
      db.get('SELECT 1 FROM workspace_products WHERE workspace_id = ? AND product = ?', workspaceId, p) ||
      db.get('SELECT 1 FROM subscriptions WHERE workspace_id = ? AND product = ?', workspaceId, p)
  );

/**
 * Delete a workspace's data here (the products' parts are deleted first, by the caller). Returns { name, people
 * (emails of everyone who was in it), usersDeleted, invoicesKept }. Throws WorkspaceError('no_workspace').
 */
export function eraseWorkspace(db, workspaceId, { by, ip = null, source = 'owner', products = {} } = {}) {
  return db.tx(() => {
    const w = getWorkspace(db, workspaceId);
    if (w.deleted_at) throw new WorkspaceError('no_workspace');
    const t = nowIso();
    const people = db.all('SELECT u.id, u.email, u.is_superadmin FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?', w.id);
    const invoicesKept = Number(db.run('UPDATE invoices SET customer_name = ?, detached_at = ? WHERE workspace_id = ?', w.name, t, w.id).changes);
    for (const table of ['signups', 'tokens', 'phone_links', 'user_phones', 'notify_prefs', 'notify_log', 'billing_notices', 'retention_notices', 'subscriptions', 'workspace_products', 'memberships'])
      db.run(`DELETE FROM ${table} WHERE workspace_id = ?`, w.id);
    db.run('UPDATE sessions SET workspace_id = NULL WHERE workspace_id = ?', w.id);
    db.run('UPDATE sessions SET view_as_workspace_id = NULL, view_as_since = NULL WHERE view_as_workspace_id = ?', w.id);
    // Someone who was only here has nothing left with us: their account goes too (its sessions and links with it).
    let usersDeleted = 0;
    for (const u of people) {
      if (u.is_superadmin || db.get('SELECT 1 FROM memberships WHERE user_id = ?', u.id)) continue;
      db.run('DELETE FROM users WHERE id = ?', u.id);
      usersDeleted++;
    }
    db.update('workspaces', w.id, { name: '', slug: `deleted-${w.id}-`, disabled_at: w.disabled_at || t, disabled_reason: 'deleted', deleted_at: t });
    audit(db, { actor: by, action: 'workspace_deleted', workspaceId: w.id, ip, detail: { source, people: people.length, users_deleted: usersDeleted, invoices_kept: invoicesKept, products } });
    return { name: w.name, people: people.map((u) => u.email), usersDeleted, invoicesKept };
  });
}

/** Does `typed` name this business? The same words, with spaces and letter case not counted. */
export const sameName = (typed, name) => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(name);
};

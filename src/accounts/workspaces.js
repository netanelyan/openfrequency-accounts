import { nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { createInvite, normEmail, validEmail } from './links.js';
import { ensureSubscription, subscriptionsOf } from './subscriptions.js';
import { invoicesOf } from './invoices.js';

// What the superadmin does to workspaces: open one (and invite its owner), turn
// a product on or off, disable or enable it, and view it as its customer does.
// Every change is in the audit log with who did it.

export class WorkspaceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Open a workspace with its products and send its owner an invite. Throws WorkspaceError. */
export function createWorkspace(db, { name, slug, ownerEmail, products = [] }, { by, ip = null }) {
  checkWorkspace(db, { name, slug });
  ownerEmail = normEmail(ownerEmail);
  if (!validEmail(ownerEmail)) throw new WorkspaceError('bad_email');
  if (db.get('SELECT 1 FROM users WHERE email = ? AND is_superadmin = 1', ownerEmail)) throw new WorkspaceError('superadmin_email');
  return db.tx(() => {
    const workspace = openWorkspace(db, { name, slug, products }, { by, ip });
    const invite = createInvite(db, { workspaceId: workspace.id, email: ownerEmail, role: 'client_owner', by, ip });
    return { workspace, invite };
  });
}

/** A workspace's name and slug, trimmed, or WorkspaceError: bad_name, bad_slug, slug_taken. */
function checkWorkspace(db, { name, slug }) {
  name = String(name ?? '').trim();
  slug = String(slug ?? '').trim().toLowerCase();
  if (!name || name.length > 80) throw new WorkspaceError('bad_name');
  if (!SLUG.test(slug)) throw new WorkspaceError('bad_slug');
  if (db.get('SELECT 1 FROM workspaces WHERE slug = ?', slug)) throw new WorkspaceError('slug_taken');
  return { name, slug };
}

/**
 * The part of opening a workspace that the superadmin's console and the public sign-up share: the workspace, each
 * chosen product turned on, and its subscription at the list price with nothing paid yet (ensureSubscription). No
 * owner and no invite: the caller adds whoever owns it. Throws WorkspaceError. Returns the workspace's row.
 */
export function openWorkspace(db, { name, slug, products = [], terms = null }, { by, ip = null, source = 'admin' }) {
  ({ name, slug } = checkWorkspace(db, { name, slug }));
  const chosen = PRODUCTS.filter((p) => products.includes(p));
  return db.tx(() => {
    const id = db.insert('workspaces', { slug, name, created_at: nowIso(), ...(terms ? { terms_version: terms.version, terms_accepted_at: terms.at } : {}) });
    for (const p of chosen) {
      db.insert('workspace_products', { workspace_id: id, product: p, enabled: 1, updated_at: nowIso() });
      ensureSubscription(db, id, p);
    }
    audit(db, { actor: by, action: 'workspace_created', workspaceId: id, ip, detail: { slug, name, products: chosen, ...(source !== 'admin' ? { source } : {}) } });
    return db.get('SELECT * FROM workspaces WHERE id = ?', id);
  });
}

export function setProduct(db, workspaceId, product, enabled, { by, ip = null }) {
  if (!PRODUCTS.includes(product)) throw new WorkspaceError('bad_product');
  const w = getWorkspace(db, workspaceId);
  db.run(
    'INSERT INTO workspace_products (workspace_id, product, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, product) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at',
    w.id,
    product,
    enabled ? 1 : 0,
    nowIso()
  );
  // A product turned on has a subscription at the list price from today, until /admin records otherwise.
  if (enabled) ensureSubscription(db, w.id, product);
  audit(db, { actor: by, action: enabled ? 'product_enabled' : 'product_disabled', workspaceId: w.id, ip, detail: { product } });
  return w;
}

/** Disable (every customer session in it is refused on its next request) or enable again. */
export function setDisabled(db, workspaceId, disabled, { by, ip = null, reason = null }) {
  const w = getWorkspace(db, workspaceId);
  db.update('workspaces', w.id, disabled ? { disabled_at: nowIso(), disabled_reason: reason } : { disabled_at: null, disabled_reason: null });
  audit(db, { actor: by, action: disabled ? 'workspace_disabled' : 'workspace_enabled', workspaceId: w.id, ip, detail: reason ? { reason } : null });
  return w;
}

/** The superadmin's session starts viewing a workspace, read-only. */
export function startViewAs(db, session, workspaceId, { by, ip = null }) {
  const w = getWorkspace(db, workspaceId);
  db.update('sessions', session.id, { view_as_workspace_id: w.id, view_as_since: nowIso() });
  audit(db, { actor: by, action: 'view_as_start', workspaceId: w.id, ip });
  return w;
}

export function stopViewAs(db, session, { by, ip = null }) {
  if (!session.view_as_workspace_id) return false;
  db.update('sessions', session.id, { view_as_workspace_id: null, view_as_since: null });
  audit(db, { actor: by, action: 'view_as_stop', workspaceId: session.view_as_workspace_id, ip, detail: { since: session.view_as_since } });
  return true;
}

export function getWorkspace(db, id) {
  const w = db.get('SELECT * FROM workspaces WHERE id = ?', Number(id));
  if (!w) throw new WorkspaceError('no_workspace');
  return w;
}

/** Every workspace with its members, products, subscriptions, invoices and open invites, newest first. */
export function listWorkspaces(db) {
  const t = nowIso();
  return db.all('SELECT * FROM workspaces ORDER BY created_at DESC, id DESC').map((w) => ({
    ...w,
    products: Object.fromEntries(PRODUCTS.map((p) => [p, Boolean(db.get('SELECT enabled FROM workspace_products WHERE workspace_id = ? AND product = ?', w.id, p)?.enabled)])),
    members: db.all(
      'SELECT u.id, u.email, u.name, u.last_login_at, u.disabled_at, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at',
      w.id
    ),
    invites: db.all("SELECT id, email, role, expires_at FROM tokens WHERE kind = 'invite' AND workspace_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at", w.id, t),
    subscriptions: subscriptionsOf(db, w.id),
    invoices: invoicesOf(db, w.id),
  }));
}

/** The latest audit entries, for the console. */
export const recentAudit = (db, limit = 40) =>
  db.all('SELECT a.*, w.name AS workspace_name FROM audit a LEFT JOIN workspaces w ON w.id = a.workspace_id ORDER BY a.id DESC LIMIT ?', limit);

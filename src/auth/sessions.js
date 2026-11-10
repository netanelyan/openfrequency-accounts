import { now, nowIso, MINUTE, HOUR, DAY } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { hashToken, looksLikeToken, newToken } from './tokens.js';
import { PARENT } from './next.js';

// Sessions: one row per signed-in browser, found by the SHA-256 of the random id
// in the cookie. Teder and Toran ask about it on every request (see
// docs/internal-session.md), so revoking a row signs that browser out of every
// product at once.
//
// A session ends at the first of: sign-out, its absolute end, or a stretch of
// idleness. Who someone is (their role, their workspace's products, whether the
// workspace is disabled) is read fresh on every lookup, never copied into the
// session, so a change by the superadmin applies on the next request.

export const LIFETIME = {
  client: { idleMs: 14 * DAY, maxMs: 30 * DAY },
  superadmin: { idleMs: 12 * HOUR, maxMs: 12 * HOUR },
};
// last_seen_at is written at most this often, not on every request.
const TOUCH_MS = MINUTE;

const lifetime = (user) => (user.is_superadmin ? LIFETIME.superadmin : LIFETIME.client);

/** The workspaces a user may enter, oldest membership first. */
export function memberships(db, userId) {
  return db.all(
    `SELECT w.id, w.slug, w.name, w.disabled_at, m.role
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? ORDER BY m.created_at, w.id`,
    userId
  );
}

/**
 * Sign a user in. Returns the cookie value (the only place the id exists) and
 * the row. A member of exactly one active workspace lands in it; a member of
 * several chooses (workspace_id stays null until chooseWorkspace).
 */
export function createSession(db, user, { ip = null, userAgent = null, workspaceId = null } = {}) {
  const id = newToken();
  const t = now();
  if (workspaceId == null && !user.is_superadmin) {
    const active = memberships(db, user.id).filter((m) => !m.disabled_at);
    if (active.length === 1) workspaceId = active[0].id;
  }
  const rowId = db.insert('sessions', {
    id_hash: hashToken(id),
    user_id: user.id,
    workspace_id: workspaceId,
    created_at: new Date(t).toISOString(),
    last_seen_at: new Date(t).toISOString(),
    expires_at: new Date(t + lifetime(user).maxMs).toISOString(),
    ip,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
  });
  db.update('users', user.id, { last_login_at: nowIso() });
  return { id, row: db.get('SELECT * FROM sessions WHERE id = ?', rowId) };
}

/**
 * The live session for a cookie value, with its user, or null: unknown,
 * revoked, past its end, idle too long, or its user disabled. Slides the idle
 * window forward unless touch is false.
 */
export function findSession(db, cookieValue, { touch = true } = {}) {
  if (!looksLikeToken(cookieValue)) return null;
  const s = db.get('SELECT * FROM sessions WHERE id_hash = ?', hashToken(cookieValue));
  if (!s || s.revoked_at) return null;
  const user = db.get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!user || user.disabled_at) return null;
  const t = now();
  if (Date.parse(s.expires_at) <= t) return null;
  if (Date.parse(s.last_seen_at) + lifetime(user).idleMs <= t) return null;
  if (touch && t - Date.parse(s.last_seen_at) >= TOUCH_MS) {
    s.last_seen_at = new Date(t).toISOString();
    db.update('sessions', s.id, { last_seen_at: s.last_seen_at });
  }
  return { session: s, user };
}

/** Sign out this browser. True if there was a live session to end. */
export function revokeSession(db, cookieValue, { reason = 'sign_out', ip = null } = {}) {
  const found = findSession(db, cookieValue, { touch: false });
  if (!found) return false;
  db.update('sessions', found.session.id, { revoked_at: nowIso(), revoked_reason: reason });
  audit(db, { actor: found.user, action: 'sign_out', ip, detail: { reason } });
  return true;
}

/** Sign a user out of every browser. Returns how many sessions ended. */
export function revokeAllSessions(db, userId, { reason = 'sign_out_all', actor = null, ip = null } = {}) {
  const r = db.run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), reason, userId);
  const user = db.get('SELECT id, email FROM users WHERE id = ?', userId);
  audit(db, { actor: actor || user, action: 'sign_out_all', ip, detail: { reason, userId, sessions: Number(r.changes) } });
  return Number(r.changes);
}

/** A member of several workspaces picks one. Refused for a workspace they are not in. */
export function chooseWorkspace(db, session, workspaceId) {
  const m = db.get('SELECT 1 FROM memberships WHERE user_id = ? AND workspace_id = ?', session.user_id, workspaceId);
  if (!m) return false;
  db.update('sessions', session.id, { workspace_id: workspaceId });
  return true;
}

/** The products a workspace may open, sorted. */
export const enabledProducts = (db, workspaceId) =>
  db
    .all('SELECT product FROM workspace_products WHERE workspace_id = ? AND enabled = 1', workspaceId)
    .map((r) => r.product)
    .filter((p) => PRODUCTS.includes(p))
    .sort();

export const workspaceOut = (w) => ({ id: w.id, slug: w.slug, name: w.name, disabled: Boolean(w.disabled_at) });

/**
 * What /internal/session answers for a cookie value: { status, body }. The
 * format is documented, with every case, in docs/internal-session.md.
 */
export function describeSession(db, cookieValue) {
  const found = findSession(db, cookieValue);
  if (!found) return { status: 401, body: { error: 'no_session' } };
  const { session: s, user } = found;
  const base = {
    user: { id: user.id, email: user.email, name: user.name, superadmin: Boolean(user.is_superadmin) },
    expiresAt: s.expires_at,
  };

  if (user.is_superadmin) {
    if (s.view_as_workspace_id) {
      const w = db.get('SELECT * FROM workspaces WHERE id = ?', s.view_as_workspace_id);
      if (w) {
        return {
          status: 200,
          body: { ...base, workspace: workspaceOut(w), role: 'superadmin', products: enabledProducts(db, w.id), readOnly: true, viewAs: { by: { id: user.id, email: user.email }, since: s.view_as_since } },
        };
      }
    }
    // The operator, outside any customer's workspace.
    return { status: 200, body: { ...base, workspace: null, role: 'superadmin', products: [...PRODUCTS], readOnly: false, viewAs: null } };
  }

  if (!s.workspace_id) return { status: 409, body: { error: 'choose_workspace' } };
  const row = db.get(
    'SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.id = ?',
    user.id,
    s.workspace_id
  );
  if (!row) return { status: 403, body: { error: 'no_membership' } };
  if (row.disabled_at) return { status: 403, body: { error: 'workspace_disabled' } };
  return { status: 200, body: { ...base, workspace: workspaceOut(row), role: row.role, products: enabledProducts(db, row.id), readOnly: false, viewAs: null } };
}

/**
 * The operator's own workspace on the products' sites (docs/admin-split.md). The owner, 2026-11-10: "Make teder and
 * toran of natikyan153@gmail.com regular, just like a customer's. Everything else, leads etc should be in other
 * places. The admin dashboard is for that. Toran and teder should stay toran and teder, even for admins".
 *
 * The superadmin cannot be a member of a workspace (workspaces.js, the invites), so OF_OPERATOR_WORKSPACE names one: a
 * workspace id, on the live server the company's own (the one Teder's OF_OWN_WORKSPACES names). For the superadmin
 * outside view-as, /internal/session (internal.js) then answers that workspace as its owner would get it: the
 * workspace, client_owner, its products, not read-only, not view-as; `user.superadmin` still says who it is. Their
 * operator pages are reached through /admin (admin-toran.js), where the products are told who they are another way.
 *
 * `body` is describeSession()'s 200. Unchanged (the operator's, workspace null) when the setting is unset or not a
 * whole number, when the workspace is gone or closed, or when `product` is named and the workspace does not have it:
 * the product then shows its short page pointing to /admin.
 */
export function operatorHome(db, body, { env = process.env, product = null } = {}) {
  if (!body || body.role !== 'superadmin' || body.viewAs || body.workspace) return body;
  const id = String(env.OF_OPERATOR_WORKSPACE || '').trim();
  if (!/^[1-9]\d{0,8}$/.test(id)) return body;
  const w = db.get('SELECT * FROM workspaces WHERE id = ?', Number(id));
  if (!w || w.disabled_at) return body;
  const products = enabledProducts(db, w.id);
  if (product && !products.includes(product)) return body;
  return { ...body, workspace: workspaceOut(w), role: 'client_owner', products, readOnly: false, viewAs: null };
}

// ---- the cookie

export const COOKIE ={ secure: '__Secure-of_session', dev: 'of_session' };

/** The cookie value a request carries: the secure name behind HTTPS, the plain one in development. */
export const sessionFromJar = (jar, secure) => (secure ? jar[COOKIE.secure] : jar[COOKIE.dev]) || null;

/**
 * Set-Cookie for a session, or to clear it. Behind HTTPS it is shared with every
 * *.openfrequency.co.il product; in development it stays on the host it came from.
 */
export function sessionCookie(value, { secure, clear = false, maxAgeMs = LIFETIME.client.maxMs } = {}) {
  const parts = [`${secure ? COOKIE.secure : COOKIE.dev}=${clear ? '' : value}`, 'Path=/'];
  if (secure) parts.push(`Domain=.${PARENT}`);
  parts.push('HttpOnly', 'SameSite=Lax', clear ? 'Max-Age=0' : `Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

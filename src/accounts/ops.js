import { nowIso } from '../core/clock.js';
import { PRODUCTS } from '../db/schema.js';
import { describe, israelToday, subscriptionsOf } from './subscriptions.js';

// The customers and the money, for the operator's dashboard on Toran (GET /internal/ops/customers,
// docs/internal-ops.md). Read-only: every workspace, newest first, with what the console holds of it.

/** describe()'s status, in the dashboard's words. `ending` is describe()'s: stopped, its last day ahead, paid or not. */
export const STATE = { active: 'paid', open: 'waiting', due: 'late', ending: 'ending', ended: 'ended' };

/** One subscription row as the dashboard reads it, on `today`. */
export function opsSubscription(row, today) {
  const d = describe(row, today);
  return {
    product: row.product,
    monthly: row.monthly,
    vat: row.vat,
    setup: row.setup,
    startedOn: row.started_on,
    paidUntil: row.paid_until,
    endsOn: row.ends_on,
    state: STATE[d.status],
    nextChargeOn: d.next?.on ?? null,
  };
}

/** Every customer workspace, newest first, and today's Israel date: { today, workspaces }. */
export function opsCustomers(db, today = israelToday()) {
  const t = nowIso();
  const workspaces = db.all('SELECT id, slug, name, created_at, disabled_at FROM workspaces ORDER BY created_at DESC, id DESC').map((w) => {
    const subs = subscriptionsOf(db, w.id);
    const invoices = db.get('SELECT count(*) AS count, max(issued_on) AS last FROM invoices WHERE workspace_id = ?', w.id);
    return {
      id: w.id,
      slug: w.slug,
      name: w.name,
      disabled: Boolean(w.disabled_at),
      createdAt: w.created_at,
      products: db.all('SELECT product FROM workspace_products WHERE workspace_id = ? AND enabled = 1 ORDER BY product', w.id).map((r) => r.product),
      people: db.get('SELECT count(*) AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.disabled_at IS NULL', w.id).n,
      // Not used and not expired, as the console lists them (an invite to someone already in counts too).
      invitesWaiting: db.get("SELECT count(*) AS n FROM tokens WHERE kind = 'invite' AND workspace_id = ? AND used_at IS NULL AND expires_at > ?", w.id, t).n,
      // users.last_login_at: set on every sign-in (createSession), per person, not per workspace.
      lastLoginAt: db.get('SELECT max(u.last_login_at) AS at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?', w.id).at ?? null,
      subscriptions: PRODUCTS.filter((p) => subs[p]).map((p) => opsSubscription(subs[p], today)),
      invoices: { count: invoices.count, lastIssuedOn: invoices.last ?? null },
    };
  });
  return { today, workspaces };
}

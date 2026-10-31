import { nowIso } from '../core/clock.js';
import { PRODUCTS } from '../db/schema.js';
import { addDays, describe, israelToday, subscriptionsOf, VAT } from './subscriptions.js';

// The customers and the money, for the operator's dashboard on /admin (opsMoney and opsCustomersStage, below) and
// for Toran (GET /internal/ops/customers, docs/internal-ops.md). Read-only: every workspace, newest first, with what
// the console holds of it.

/** describe()'s status, in the dashboard's words. `ending` is describe()'s: stopped, its last day ahead, paid or not. */
export const STATE = { active: 'paid', open: 'waiting', due: 'late', ending: 'ending', ended: 'ended' };

/** One subscription row as the dashboard reads it, on `today`. `comp`: the product is free (the paywall's comp). */
export function opsSubscription(row, today, comp = false) {
  const d = describe(row, today);
  return {
    product: row.product,
    // Teder's plan (full or small, subscriptions.js PLANS), null for Toran.
    plan: row.plan ?? null,
    monthly: row.monthly,
    vat: row.vat,
    setup: row.setup,
    startedOn: row.started_on,
    paidUntil: row.paid_until,
    endsOn: row.ends_on,
    cancelledAt: row.cancelled_at ?? null,
    comp: Boolean(comp),
    state: STATE[d.status],
    nextChargeOn: d.next?.on ?? null,
  };
}

/** Every customer workspace, newest first, and today's Israel date: { today, workspaces }. */
export function opsCustomers(db, today = israelToday()) {
  const t = nowIso();
  const workspaces = db.all('SELECT id, slug, name, created_at, disabled_at FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC').map((w) => {
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
      subscriptions: PRODUCTS.filter((p) => subs[p]).map((p) => opsSubscription(subs[p], today, db.get('SELECT comp FROM workspace_products WHERE workspace_id = ? AND product = ?', w.id, p)?.comp)),
      invoices: { count: invoices.count, lastIssuedOn: invoices.last ?? null },
    };
  });
  return { today, workspaces };
}

// ---- the operator's dashboard on /admin: the money and the funnels' last stage, from the same rows

/** VAT in Israel (subscriptions.js), for a price recorded with it included. */
export { VAT };

/**
 * The money, from opsCustomers()' workspaces on `today`: the monthly revenue before VAT (paid and ending, a price
 * recorded with VAT included counted without it), how many pay for each product, who is late, who has not paid yet,
 * and who renews in the next 7 days. A disabled workspace, and a complimentary product, count nowhere. Ported from Toran's src/ops/funnel.ts.
 */
export function opsMoney(workspaces, today) {
  const out = { mrr: 0, paying: { toran: 0, teder: 0 }, late: [], waiting: [], renewals: [] };
  const week = addDays(today, 7);
  for (const w of workspaces) {
    if (w.disabled) continue;
    for (const s of w.subscriptions) {
      // A complimentary product is not late and not waiting: there is nothing to pay.
      if (s.comp) continue;
      const monthly = Number(s.monthly) || 0;
      const net = s.vat === 'included' ? Math.round((monthly / (1 + VAT)) * 100) / 100 : monthly;
      if (s.state === 'paid' || s.state === 'ending') {
        out.mrr += net;
        if (Object.hasOwn(out.paying, s.product)) out.paying[s.product]++;
        if (s.state === 'paid' && s.nextChargeOn && s.nextChargeOn <= week) out.renewals.push({ w, product: s.product, on: s.nextChargeOn, monthly });
      } else if (s.state === 'late') out.late.push({ w, product: s.product, since: s.nextChargeOn, monthly });
      else if (s.state === 'waiting') out.waiting.push({ w, product: s.product, monthly, setup: Number(s.setup) || 0 });
    }
  }
  out.mrr = Math.round(out.mrr * 100) / 100;
  out.renewals.sort((a, b) => a.on.localeCompare(b.on));
  return out;
}

/**
 * The funnel's last stage for one product, which Toran leaves to us: the workspaces with a subscription to it that
 * is paid or ending, over all time and those that started in the last 30 days. A disabled workspace is no customer,
 * as in opsMoney().
 */
export function opsCustomersStage(workspaces, product, today) {
  const since = addDays(today, -30);
  const has = (w, recent) => !w.disabled && w.subscriptions.some((s) => s.product === product && (s.state === 'paid' || s.state === 'ending') && (!recent || (s.startedOn && s.startedOn > since)));
  return { all: workspaces.filter((w) => has(w, false)).length, month: workspaces.filter((w) => has(w, true)).length };
}

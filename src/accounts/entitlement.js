import { nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { WorkspaceError, getWorkspace } from './workspaces.js';
import { addDays, ensureSubscription, graceLast, israelToday, planOut, PLANS } from './subscriptions.js';

// The paywall: may this workspace use this product today? Teder and Toran ask at GET /internal/entitlement
// (docs/setup.md), and accounts' own pages lock what is not paid for. No payment provider is connected yet, so
// "paid" is what the superadmin records on /admin: each month's payment moves the subscription's paid_until on
// (subscriptions.js payMonth), and the date can be edited there too.
//
//   off        the product is not on for the workspace, or the workspace is disabled or deleted
//   comp       the superadmin marked it complimentary (workspace_products.comp): free, nothing to pay. Every workspace
//              that existed before the paywall is comp for the products it had on (migration 7)
//   cancelled  the customer cancelled online (or the superadmin set a last day): it works until the last day paid
//              for, and the last day, whichever is first, then stops
//   paid       a recorded payment covers today
//   due        the last paid period is over and the next payment has not come yet: it keeps working for the 14 days of
//              grace the terms give (subscriptions.js GRACE_DAYS), from the day it fell due, while the owners are told
//              (src/web/daily.js); then it is unpaid
//   unpaid     anything else: on, nothing paid for today (never paid, or the grace is over)
//
// allowed = paid || comp || due || (cancelled && today is not past either day). Days are Israel calendar days. A
// cancelled subscription gets no grace: it stops on its last day, as the customer asked.

export const ACCESS = ['paid', 'comp', 'due', 'unpaid', 'cancelled', 'off'];

/** The last millisecond of an Israel calendar day (YYYY-MM-DD), as an ISO instant: "2026-11-21T21:59:59.999Z". */
export function endOfIsraelDay(day) {
  const next = addDays(day, 1);
  const utc = Date.UTC(+next.slice(0, 4), +next.slice(5, 7) - 1, +next.slice(8, 10));
  // Israel is UTC+2 or UTC+3: midnight there is the first of these instants that is already the next day.
  for (const h of [3, 2]) {
    const t = utc - h * 3_600_000;
    if (israelToday(t) === next && israelToday(t - 1) === day) return new Date(t - 1).toISOString();
  }
  return new Date(utc - 2 * 3_600_000 - 1).toISOString();
}

/**
 * What a workspace's product may do, from its rows. Pure.
 *   { enabled, comp, paidUntil, endsOn, cancelledAt } -> { access, allowed, paidUntil, lastDay, graceUntil }
 * `lastDay` is the day it stops when it is cancelled, else null. `graceUntil` is the last day of the grace while it is
 * due, else null.
 */
export function accessOf({ enabled, comp = false, paidUntil = null, endsOn = null, cancelledAt = null }, today = israelToday()) {
  const none = { lastDay: null, graceUntil: null };
  if (!enabled) return { access: 'off', allowed: false, paidUntil, ...none };
  if (comp) return { access: 'comp', allowed: true, paidUntil, ...none };
  const paid = Boolean(paidUntil && paidUntil >= today);
  if (cancelledAt || endsOn) {
    const lastDay = endsOn || paidUntil || today;
    return { access: 'cancelled', allowed: paid && today <= lastDay, paidUntil, lastDay, graceUntil: null };
  }
  if (!paid && paidUntil && today <= graceLast(paidUntil)) return { access: 'due', allowed: true, paidUntil, lastDay: null, graceUntil: graceLast(paidUntil) };
  return { access: paid ? 'paid' : 'unpaid', allowed: paid, paidUntil, ...none };
}

/** A workspace's rows for one product, read fresh. Null when there is no such workspace. */
function rowsOf(db, workspaceId, product) {
  const w = db.get('SELECT id, disabled_at, deleted_at FROM workspaces WHERE id = ?', Number(workspaceId));
  if (!w) return null;
  const wp = db.get('SELECT enabled, comp FROM workspace_products WHERE workspace_id = ? AND product = ?', w.id, product);
  const s = db.get('SELECT paid_until, ends_on, cancelled_at FROM subscriptions WHERE workspace_id = ? AND product = ?', w.id, product);
  return { w, wp, s };
}

/**
 * One product's access for a workspace, with the days as the pages want them: { workspace, product, enabled, comp,
 * access, allowed, paidUntil, lastDay, cancelled (the customer cancelled online) }. Null for a workspace that does not
 * exist; a deleted one is 'off'.
 */
export function accessFor(db, workspaceId, product, today = israelToday()) {
  if (!PRODUCTS.includes(product)) return null;
  const r = rowsOf(db, workspaceId, product);
  if (!r) return null;
  const enabled = Boolean(r.wp?.enabled) && !r.w.disabled_at && !r.w.deleted_at;
  const a = accessOf({ enabled, comp: Boolean(r.wp?.comp), paidUntil: r.s?.paid_until ?? null, endsOn: r.s?.ends_on ?? null, cancelledAt: r.s?.cancelled_at ?? null }, today);
  return { workspace: r.w.id, product, enabled, comp: Boolean(r.wp?.comp), cancelled: Boolean(r.s?.cancelled_at), ...a };
}

/** Every product's access for a workspace: { teder: accessFor(...), toran: ... }. */
export const accessAll = (db, workspaceId, today = israelToday()) => Object.fromEntries(PRODUCTS.map((p) => [p, accessFor(db, workspaceId, p, today)]));

/**
 * The answer of GET /internal/entitlement, exactly as docs/setup.md has it, or null for no such workspace:
 * { workspace, product, enabled, access, allowed, paidThrough, cancelAt, graceUntil, plan? }. paidThrough is the end of
 * the last day paid for, cancelAt the end of the last day of a cancelled subscription, graceUntil the end of the last
 * day of the grace while it is due, all ISO instants (Israel days' ends, in UTC) or null. `plan`, for a product with
 * plans (Teder), is what its month gives: { name: "full" | "small", slideshows, redos } (the full plan when none is
 * recorded).
 */
export function entitlement(db, workspaceId, product, today = israelToday()) {
  const a = accessFor(db, workspaceId, product, today);
  if (!a) return null;
  const plan = PLANS[product] ? planOut(product, db.get('SELECT plan FROM subscriptions WHERE workspace_id = ? AND product = ?', a.workspace, product)?.plan) : undefined;
  return {
    workspace: a.workspace,
    product,
    enabled: a.enabled,
    access: a.access,
    allowed: a.allowed,
    paidThrough: a.paidUntil ? endOfIsraelDay(a.paidUntil) : null,
    cancelAt: a.access === 'cancelled' && a.lastDay ? endOfIsraelDay(a.lastDay) : null,
    graceUntil: a.graceUntil ? endOfIsraelDay(a.graceUntil) : null,
    ...(plan ? { plan } : {}),
  };
}

/** The superadmin marks a product of a workspace complimentary, or takes that back. Throws WorkspaceError. */
export function setComp(db, workspaceId, product, comp, { by, ip = null }) {
  if (!PRODUCTS.includes(product)) throw new WorkspaceError('bad_product');
  const w = getWorkspace(db, workspaceId);
  if (w.deleted_at) throw new WorkspaceError('no_workspace');
  const r = db.run('UPDATE workspace_products SET comp = ?, updated_at = ? WHERE workspace_id = ? AND product = ?', comp ? 1 : 0, nowIso(), w.id, product);
  if (Number(r.changes) !== 1) throw new WorkspaceError('product_off');
  audit(db, { actor: by, action: comp ? 'comp_set' : 'comp_cleared', workspaceId: w.id, ip, detail: { product } });
  return w;
}

export class BillingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * The customer cancels a product online. It keeps working to the last day already paid for and then stops; nothing
 * more is charged. With nothing paid for today, it stops today. Returns { lastDay, paid } (paid: days were left).
 * Throws BillingError: product_off, comp (nothing to cancel), already (cancelled or stopped already).
 */
export function cancelSubscription(db, workspaceId, product, { by, ip = null }, today = israelToday()) {
  return db.tx(() => {
    const a = accessFor(db, workspaceId, product, today);
    if (!a || a.access === 'off') throw new BillingError('product_off');
    if (a.access === 'comp') throw new BillingError('comp');
    if (a.access === 'cancelled') throw new BillingError('already');
    ensureSubscription(db, a.workspace, product, today);
    const paid = a.access === 'paid';
    const lastDay = paid ? a.paidUntil : today;
    db.run('UPDATE subscriptions SET cancelled_at = ?, ends_on = ?, updated_at = ? WHERE workspace_id = ? AND product = ?', nowIso(), lastDay, nowIso(), a.workspace, product);
    audit(db, { actor: by, action: 'subscription_cancelled', workspaceId: a.workspace, ip, detail: { product, last_day: lastDay, paid } });
    return { lastDay, paid };
  });
}

/**
 * The customer takes the cancellation back, before its last day has passed: the subscription goes on as before.
 * Throws BillingError: not_cancelled (nothing cancelled online), ended (its last day is over).
 */
export function resumeSubscription(db, workspaceId, product, { by, ip = null }, today = israelToday()) {
  return db.tx(() => {
    const s = db.get('SELECT * FROM subscriptions WHERE workspace_id = ? AND product = ?', Number(workspaceId), product);
    if (!s?.cancelled_at) throw new BillingError('not_cancelled');
    if (s.ends_on && s.ends_on < today) throw new BillingError('ended');
    db.run('UPDATE subscriptions SET cancelled_at = NULL, ends_on = NULL, updated_at = ? WHERE workspace_id = ? AND product = ?', nowIso(), s.workspace_id, product);
    audit(db, { actor: by, action: 'subscription_resumed', workspaceId: s.workspace_id, ip, detail: { product } });
    return true;
  });
}

import { now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { WorkspaceError, getWorkspace } from './workspaces.js';

// A workspace's subscriptions: what each product costs it, since when, and until when it is paid. OpenFrequency
// records them on /admin (there is no payment provider yet); the customer's dashboard shows them, worked out by
// describe() below. Dates are Israel calendar days, YYYY-MM-DD.

/** The list prices, before VAT, a new subscription starts from (openfrequency.co.il, site.config.json). Teder's is its full plan's. */
export const LIST_PRICES = { toran: { monthly: 590, setup: 990, vat: 'excluded' }, teder: { monthly: 790, setup: 1490, vat: 'excluded' } };

/**
 * Teder's plans: what a month gives (slideshows suggested, and rejected ones written again) and what it costs before
 * VAT. Teder reads the plan from GET /internal/entitlement (docs/setup.md) and counts the month by it, for the whole
 * workspace. Toran has no plans here: it has its own price, and no plan column (NULL).
 */
export const PLANS = {
  teder: {
    full: { monthly: 790, setup: 1490, slideshows: 40, redos: 10 },
    small: { monthly: 490, setup: 990, slideshows: 15, redos: 4 },
  },
};
export const DEFAULT_PLAN = 'full';

/** A product's plan names, the default first: [] for a product without plans. */
export const plansOf = (product) => Object.keys(PLANS[product] || {}).sort((a, b) => Number(b === DEFAULT_PLAN) - Number(a === DEFAULT_PLAN));

/** The plan a name stands for, for a product: that one when the product has it, else its default; null without plans. */
export const planFor = (product, name) => (PLANS[product] ? (Object.hasOwn(PLANS[product], name ?? '') ? name : DEFAULT_PLAN) : null);

/** What a plan gives, as Teder reads it: { name, slideshows, redos }, or null for a product without plans. */
export function planOut(product, name) {
  const p = planFor(product, name);
  return p ? { name: p, slideshows: PLANS[product][p].slideshows, redos: PLANS[product][p].redos } : null;
}

/** The list price a new subscription starts from, before VAT: { monthly, setup, vat }, by its plan when it has one. */
export function listPrice(product, plan = null) {
  const p = planFor(product, plan);
  const src = p ? PLANS[product][p] : LIST_PRICES[product];
  return { monthly: src.monthly, setup: src.setup, vat: 'excluded' };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Israel, YYYY-MM-DD. */
export const israelToday = (t = now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

const toUtc = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Whole days from a to b (b later: positive). */
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
export const addDays = (day, n) => fromUtc(toUtc(day) + n * 86_400_000);
/** The same day a month on, or the month's last day when it has no such day (31 January to 28 or 29 February). */
export function addMonths(day, n = 1) {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m, Math.min(+day.slice(8, 10), last)));
}

/**
 * Days a subscription keeps working after its paid period ends, counted from the day the payment fell due: the terms
 * (openfrequency.co.il/terms) let us stop the service 14 days after we wrote about an unpaid payment, and that email
 * goes out on the day it falls due (src/web/daily.js).
 */
export const GRACE_DAYS = 14;
/** The last day a subscription paid until `paidUntil` still works unpaid: the day the payment fell due and 14 more. */
export const graceLast = (paidUntil) => addDays(paidUntil, 1 + GRACE_DAYS);

/** A workspace's subscription rows, by product. */
export function subscriptionsOf(db, workspaceId) {
  return Object.fromEntries(db.all('SELECT * FROM subscriptions WHERE workspace_id = ?', workspaceId).map((r) => [r.product, r]));
}

/**
 * A product turned on gets a subscription at the list price of its plan (the default plan unless one is given), from
 * today, nothing paid yet. An existing one stays as it is.
 */
export function ensureSubscription(db, workspaceId, product, today = israelToday(), plan = null) {
  if (!PRODUCTS.includes(product)) throw new WorkspaceError('bad_product');
  const p = planFor(product, plan);
  const list = listPrice(product, p);
  db.run(
    'INSERT INTO subscriptions (workspace_id, product, plan, monthly, vat, setup, started_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, product) DO NOTHING',
    workspaceId,
    product,
    p,
    list.monthly,
    list.vat,
    list.setup,
    today,
    nowIso()
  );
}

/** A price or an amount from a form, in ₪: null when empty. Throws WorkspaceError('bad_price'). */
export const money = (v) => {
  const t = String(v ?? '').replace(/[,\s₪]/g, '');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new WorkspaceError('bad_price');
  return n;
};
/** A day from a form, YYYY-MM-DD: null when empty. Throws WorkspaceError('bad_date'). */
export const day = (v) => {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  if (!DAY.test(t) || fromUtc(toUtc(t)) !== t) throw new WorkspaceError('bad_date');
  return t;
};

/**
 * Save a subscription from the admin form. Throws WorkspaceError. A product with plans keeps its plan unless the form
 * names another; moving to another plan also moves a price still at the old plan's list price to the new one's, so a
 * price agreed by hand is never overwritten.
 */
export function setSubscription(db, workspaceId, product, form, { by, ip = null }) {
  if (!PRODUCTS.includes(product)) throw new WorkspaceError('bad_product');
  const w = getWorkspace(db, workspaceId);
  const before = db.get('SELECT plan FROM subscriptions WHERE workspace_id = ? AND product = ?', w.id, product);
  if (form.plan && PLANS[product] && !Object.hasOwn(PLANS[product], form.plan)) throw new WorkspaceError('bad_plan');
  const plan = PLANS[product] ? planFor(product, form.plan || before?.plan) : null;
  const row = {
    plan,
    monthly: money(form.monthly),
    setup: money(form.setup),
    vat: ['included', 'excluded'].includes(form.vat) ? form.vat : null,
    started_on: day(form.started_on),
    paid_until: day(form.paid_until),
    ends_on: day(form.ends_on),
  };
  if (plan && before?.plan && before.plan !== plan) {
    const was = listPrice(product, before.plan);
    const now_ = listPrice(product, plan);
    if (row.monthly === was.monthly) row.monthly = now_.monthly;
    if (row.setup === was.setup) row.setup = now_.setup;
  }
  if (row.started_on && row.ends_on && row.ends_on < row.started_on) throw new WorkspaceError('bad_dates');
  db.run(
    `INSERT INTO subscriptions (workspace_id, product, plan, monthly, vat, setup, started_on, paid_until, ends_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, product) DO UPDATE SET plan = excluded.plan, monthly = excluded.monthly, vat = excluded.vat, setup = excluded.setup, started_on = excluded.started_on,
       paid_until = excluded.paid_until, ends_on = excluded.ends_on, updated_at = excluded.updated_at`,
    w.id, product, row.plan, row.monthly, row.vat, row.setup, row.started_on, row.paid_until, row.ends_on, nowIso()
  );
  // A last day cleared here undoes a cancellation too: the subscription goes on.
  if (!row.ends_on) db.run('UPDATE subscriptions SET cancelled_at = NULL WHERE workspace_id = ? AND product = ?', w.id, product);
  audit(db, { actor: by, action: 'subscription_saved', workspaceId: w.id, ip, detail: { product, ...row } });
  return w;
}

/**
 * A month's payment came in: paid until a month after the last paid day (or after yesterday, if that is later).
 * `expect` is the paid-until date the console showed when the button was pressed ('' for none): when it is given and
 * the subscription has moved on since, nothing is recorded (WorkspaceError 'already_paid'), so a second press of the
 * same button, or a page left open, never records a second month.
 */
export function payMonth(db, workspaceId, product, { by, ip = null, expect = undefined }, today = israelToday()) {
  return db.tx(() => {
    const w = getWorkspace(db, workspaceId);
    ensureSubscription(db, w.id, product, today);
    const s = subscriptionsOf(db, w.id)[product];
    if (expect !== undefined && (s.paid_until ?? '') !== String(expect ?? '')) throw new WorkspaceError('already_paid');
    const from = s.paid_until && s.paid_until >= addDays(today, -1) ? s.paid_until : addDays(today, -1);
    const paid_until = addDays(addMonths(addDays(from, 1), 1), -1);
    db.run('UPDATE subscriptions SET paid_until = ?, updated_at = ? WHERE workspace_id = ? AND product = ?', paid_until, nowIso(), w.id, product);
    audit(db, { actor: by, action: 'subscription_paid', workspaceId: w.id, ip, detail: { product, paid_until } });
    return paid_until;
  });
}

/**
 * The month already paid for that `today` falls in, for the bar: { from, to, days, day } (day 1 is its first day,
 * today counted), or null when no paid month covers today. Paid months run back from paid_until a month at a time,
 * as payMonth() adds them, so a customer paid three months ahead sees this month's bar, not one 90 days long. `last`
 * cuts the month short (the last day of a subscription that is ending).
 */
export function paidMonth(paidUntil, today, last = paidUntil) {
  if (!paidUntil || paidUntil < today) return null;
  const after = addDays(paidUntil, 1);
  let k = 1;
  while (addMonths(after, -k) > today && k < 1200) k++;
  const from = addMonths(after, -k);
  const end = addDays(addMonths(after, 1 - k), -1);
  const to = last && last < end ? last : end;
  if (to < today) return null;
  return { from, to, days: daysBetween(from, to) + 1, day: daysBetween(from, today) + 1 };
}

/**
 * What the customer sees of one subscription, on a given day. Pure.
 *   status   'active' | 'due' (the paid month is over: it works until graceUntil, then stops until paid) | 'ending'
 *            (stopped, its last day ahead) | 'ended' | 'open' (on, no payment recorded yet)
 *   plan     Teder's plan name (PLANS), or null
 *   left     days left: to the last day paid for, or to the last day when it is ending
 *   period   the length of the current paid month, for the bar
 *   bar      the paid month today is in (paidMonth() above), or null: there is no bar while nothing is paid, once
 *            the paid month is over, or once it has ended
 *   next     the next charge: { on, monthly, vat }, or null when it is ending or ended
 */
export function describe(s, today = israelToday()) {
  if (!s) return null;
  const base = { plan: s.plan ?? null, monthly: s.monthly, vat: s.vat, setup: s.setup, started_on: s.started_on, paid_until: s.paid_until, ends_on: s.ends_on };
  if (s.ends_on && s.ends_on < today) return { ...base, status: 'ended', left: 0, period: null, bar: null, next: null };
  if (s.ends_on) {
    const bar = paidMonth(s.paid_until, today, s.ends_on);
    return { ...base, status: 'ending', left: daysBetween(today, s.ends_on) + 1, period: bar?.days ?? null, bar, next: null };
  }
  if (!s.paid_until) return { ...base, status: 'open', left: null, period: null, bar: null, next: null };
  if (s.paid_until < today) return { ...base, status: 'due', left: 0, period: null, bar: null, graceUntil: graceLast(s.paid_until), next: { on: addDays(s.paid_until, 1), monthly: s.monthly, vat: s.vat } };
  const bar = paidMonth(s.paid_until, today);
  return {
    ...base,
    status: 'active',
    left: daysBetween(today, s.paid_until) + 1,
    period: bar.days,
    bar,
    next: { on: addDays(s.paid_until, 1), monthly: s.monthly, vat: s.vat },
  };
}

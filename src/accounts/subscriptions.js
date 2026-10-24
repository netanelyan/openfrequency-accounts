import { now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { WorkspaceError, getWorkspace } from './workspaces.js';

// A workspace's subscriptions: what each product costs it, since when, and until when it is paid. OpenFrequency
// records them on /admin (there is no payment provider yet); the customer's dashboard shows them, worked out by
// describe() below. Dates are Israel calendar days, YYYY-MM-DD.

/** The list prices, before VAT, a new subscription starts from (openfrequency.co.il, site.config.json). */
export const LIST_PRICES = { toran: { monthly: 449, setup: 990, vat: 'excluded' }, teder: { monthly: 790, setup: 1490, vat: 'excluded' } };

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

/** A workspace's subscription rows, by product. */
export function subscriptionsOf(db, workspaceId) {
  return Object.fromEntries(db.all('SELECT * FROM subscriptions WHERE workspace_id = ?', workspaceId).map((r) => [r.product, r]));
}

/** A product turned on gets a subscription at the list price, from today, nothing paid yet. An existing one stays. */
export function ensureSubscription(db, workspaceId, product, today = israelToday()) {
  if (!PRODUCTS.includes(product)) throw new WorkspaceError('bad_product');
  const list = LIST_PRICES[product];
  db.run(
    'INSERT INTO subscriptions (workspace_id, product, monthly, vat, setup, started_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, product) DO NOTHING',
    workspaceId,
    product,
    list.monthly,
    list.vat,
    list.setup,
    today,
    nowIso()
  );
}

const money = (v) => {
  const t = String(v ?? '').replace(/[,\s₪]/g, '');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new WorkspaceError('bad_price');
  return n;
};
const day = (v) => {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  if (!DAY.test(t) || fromUtc(toUtc(t)) !== t) throw new WorkspaceError('bad_date');
  return t;
};

/** Save a subscription from the admin form. Throws WorkspaceError. */
export function setSubscription(db, workspaceId, product, form, { by, ip = null }) {
  if (!PRODUCTS.includes(product)) throw new WorkspaceError('bad_product');
  const w = getWorkspace(db, workspaceId);
  const row = {
    monthly: money(form.monthly),
    setup: money(form.setup),
    vat: ['included', 'excluded'].includes(form.vat) ? form.vat : null,
    started_on: day(form.started_on),
    paid_until: day(form.paid_until),
    ends_on: day(form.ends_on),
  };
  if (row.started_on && row.ends_on && row.ends_on < row.started_on) throw new WorkspaceError('bad_dates');
  db.run(
    `INSERT INTO subscriptions (workspace_id, product, monthly, vat, setup, started_on, paid_until, ends_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, product) DO UPDATE SET monthly = excluded.monthly, vat = excluded.vat, setup = excluded.setup, started_on = excluded.started_on,
       paid_until = excluded.paid_until, ends_on = excluded.ends_on, updated_at = excluded.updated_at`,
    w.id, product, row.monthly, row.vat, row.setup, row.started_on, row.paid_until, row.ends_on, nowIso()
  );
  audit(db, { actor: by, action: 'subscription_saved', workspaceId: w.id, ip, detail: { product, ...row } });
  return w;
}

/** A month's payment came in: paid until a month after the last paid day (or after yesterday, if that is later). */
export function payMonth(db, workspaceId, product, { by, ip = null }, today = israelToday()) {
  const w = getWorkspace(db, workspaceId);
  ensureSubscription(db, w.id, product, today);
  const s = subscriptionsOf(db, w.id)[product];
  const from = s.paid_until && s.paid_until >= addDays(today, -1) ? s.paid_until : addDays(today, -1);
  const paid_until = addDays(addMonths(addDays(from, 1), 1), -1);
  db.run('UPDATE subscriptions SET paid_until = ?, updated_at = ? WHERE workspace_id = ? AND product = ?', paid_until, nowIso(), w.id, product);
  audit(db, { actor: by, action: 'subscription_paid', workspaceId: w.id, ip, detail: { product, paid_until } });
  return paid_until;
}

/**
 * What the customer sees of one subscription, on a given day. Pure.
 *   status   'active' | 'due' (the paid month is over) | 'ending' (stopped, its last day ahead) | 'ended' | 'open'
 *            (on, no payment recorded yet)
 *   left     days left: to the end of the paid month, or to the last day when it is ending
 *   period   the length of the current paid month, for the bar
 *   next     the next charge: { on, monthly, vat }, or null when it is ending or ended
 */
export function describe(s, today = israelToday()) {
  if (!s) return null;
  const base = { monthly: s.monthly, vat: s.vat, setup: s.setup, started_on: s.started_on, paid_until: s.paid_until, ends_on: s.ends_on };
  if (s.ends_on && s.ends_on < today) return { ...base, status: 'ended', left: 0, period: null, next: null };
  if (s.ends_on) return { ...base, status: 'ending', left: daysBetween(today, s.ends_on) + 1, period: null, next: null };
  if (!s.paid_until) return { ...base, status: 'open', left: null, period: null, next: null };
  if (s.paid_until < today) return { ...base, status: 'due', left: 0, period: null, next: { on: addDays(s.paid_until, 1), monthly: s.monthly, vat: s.vat } };
  const start = addDays(addMonths(addDays(s.paid_until, 1), -1), 0);
  return {
    ...base,
    status: 'active',
    left: daysBetween(today, s.paid_until) + 1,
    period: daysBetween(start, s.paid_until) + 1,
    next: { on: addDays(s.paid_until, 1), monthly: s.monthly, vat: s.vat },
  };
}

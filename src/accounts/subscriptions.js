import { randomBytes } from 'node:crypto';
import { now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { hashToken } from '../auth/tokens.js';
import { PRODUCTS } from '../db/schema.js';
import { WorkspaceError, getWorkspace } from './workspaces.js';

// A workspace's subscriptions: what each product costs it, since when, and until when it is paid. OpenFrequency
// records them on /admin (there is no payment provider yet); the customer's dashboard shows them, worked out by
// describe() below. Dates are Israel calendar days, YYYY-MM-DD.

/** The list prices, before VAT, a new subscription starts from (openfrequency.co.il, site.config.json). Teder's is its full plan's. */
export const LIST_PRICES = { toran: { monthly: 590, setup: 990, vat: 'excluded' }, teder: { monthly: 790, setup: 1490, vat: 'excluded' } };

/**
 * Each product's plans: what a month gives and what it costs before VAT. Teder's give slideshows suggested and rejected
 * ones written again; Toran's give conversations (openfrequency.co.il sells store at 300 a month and big at 1,500, the
 * owner, 2026-11-08: "make sure toran is ready for customers like teder"). Each product reads its plan from
 * GET /internal/entitlement (docs/setup.md, docs/contracts/entitlement.json) and counts the month by it, for the whole
 * workspace.
 */
export const PLANS = {
  teder: {
    full: { monthly: 790, setup: 1490, slideshows: 40, redos: 10 },
    small: { monthly: 490, setup: 990, slideshows: 15, redos: 4 },
  },
  toran: {
    store: { monthly: 590, setup: 990, conversations: 300 },
    big: { monthly: 1190, setup: 990, conversations: 1500 },
  },
};
/** The plan a product's new subscription takes when none is chosen. */
export const DEFAULT_PLANS = { teder: 'full', toran: 'store' };
/** Teder's default, as before there were two products with plans. */
export const DEFAULT_PLAN = DEFAULT_PLANS.teder;
export const defaultPlan = (product) => DEFAULT_PLANS[product] ?? null;

/** A product's plan names, the default first: [] for a product without plans. */
export const plansOf = (product) => Object.keys(PLANS[product] || {}).sort((a, b) => Number(b === defaultPlan(product)) - Number(a === defaultPlan(product)));

/** The plan a name stands for, for a product: that one when the product has it, else its default; null without plans. */
export const planFor = (product, name) => (PLANS[product] ? (Object.hasOwn(PLANS[product], name ?? '') ? name : defaultPlan(product)) : null);

/**
 * What a plan gives, as the product reads it: Teder { name, slideshows, redos }, Toran { name, conversations }; null
 * for a product without plans.
 */
export function planOut(product, name) {
  const p = planFor(product, name);
  if (!p) return null;
  const plan = PLANS[product][p];
  return plan.conversations != null ? { name: p, conversations: plan.conversations } : { name: p, slideshows: plan.slideshows, redos: plan.redos };
}

/** The list price a new subscription starts from, before VAT: { monthly, setup, vat }, by its plan when it has one. */
export function listPrice(product, plan = null) {
  const p = planFor(product, plan);
  const src = p ? PLANS[product][p] : LIST_PRICES[product];
  return { monthly: src.monthly, setup: src.setup, vat: 'excluded' };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** VAT in Israel. */
export const VAT = 0.18;
/** What a price comes to with VAT, to the agora: as recorded when VAT is included in it ('included'), else with VAT added. */
export const withVat = (sum, vat) => (vat === 'included' ? Number(sum) : Math.round(Number(sum) * (1 + VAT) * 100) / 100);

/**
 * What one payment comes to, for the customer to transfer: `items` are { sum, vat } (a month, a setup fee), each as
 * recorded. { total } with VAT, { net, vat } the part recorded before VAT and the VAT on it (0 when every price
 * already includes it).
 */
export function payTotal(items) {
  const total = Math.round(items.reduce((a, i) => a + withVat(i.sum, i.vat), 0) * 100) / 100;
  const excluded = items.filter((i) => i.vat !== 'included');
  const net = excluded.reduce((a, i) => a + Number(i.sum), 0);
  return { total, net, vat: Math.round((excluded.reduce((a, i) => a + withVat(i.sum, i.vat), 0) - net) * 100) / 100 };
}

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
 * How long a subscription keeps working after its paid month ends while the next month's payment has not come: 72
 * hours at least (the owner, 2026-11-03: "A user has 72 hours to pay for a new month once their subscription has
 * ended"; the terms, openfrequency.co.il/terms, say the same). The paid month ends at the end of the Israel day
 * `paid_until`, and the 72 hours are the 3 Israel days after it, to the end of the third; then it stops until paid.
 * When the clocks go forward in those days (the end of March), the 3 days are 71 hours, and it works to the end of the
 * 4th instead (95 hours), so a customer never gets less; when they go back (the end of October), the 3 days are 73
 * hours and stay 3. The emails before, on and at the end of them are src/web/daily.js.
 */
export const GRACE_HOURS = 72;
export const GRACE_DAYS = GRACE_HOURS / 24;

/**
 * The terms the 72 hours came with: TERMS_VERSION (src/accounts/signup.js) from 2026-11-03. A workspace whose owner
 * accepted an older version when signing up (workspaces.terms_version), or that has none recorded (opened on /admin,
 * which records none), is on the old terms. Those gave a payment that did not come 14 days, and promise "על שינוי
 * במחיר או בהסכם נודיע לכם לפחות 30 יום מראש", so such a workspace keeps the 14 days (OLD_GRACE_DAYS, from the day
 * the payment fell due) until its change date: the day after the 30 whole days that follow the day its owners were
 * emailed the change (src/web/daily.js termsNotices, kept in terms_notices; emailed on 3.11.2026, the 72 hours from
 * 4.12.2026). The date is kept and never moves. A workspace on the old terms never emailed (no owner to email) keeps
 * the 14 days (NEVER).
 */
export const TERMS_72H = '2026-11-03';
export const OLD_GRACE_DAYS = 14;
export const NOTICE_DAYS = 30;
/** A day after every other: the change date of a workspace on the old terms that was never told of the change. */
export const NEVER = '9999-12-31';
/** Whether terms accepted at `version` are from before the 72 hours; none recorded counts as before. */
export const onOldTerms = (version) => !version || String(version) < TERMS_72H;
/** The change date a workspace's grace follows: null on the new terms (the 72 hours always), else its kept date or NEVER. */
export const graceChange = (termsVersion, changeOn = null) => (onOldTerms(termsVersion) ? changeOn || NEVER : null);
/** graceChange() for a workspace, read fresh; null for no such workspace. */
export function graceChangeOf(db, workspaceId) {
  const r = db.get('SELECT w.terms_version, n.change_on FROM workspaces w LEFT JOIN terms_notices n ON n.workspace_id = w.id WHERE w.id = ?', Number(workspaceId));
  return r ? graceChange(r.terms_version, r.change_on) : null;
}

/**
 * The last day a subscription paid until `paidUntil` still works unpaid: the third day after it, or the fourth when the
 * third would end less than 72 hours after it (paid until 23 to 25 March 2027: the 27th to the 29th). `change` is the
 * workspace's graceChange(): a payment that falls due (the day after paidUntil) before it has the old terms' 14 days
 * from that day instead. It is decided by the day it falls due, not by today, so a grace that began under the old terms
 * runs its 14 days even past the change date (change date 4.12.2026: paid until 2.12, it works until 17.12; paid until
 * 3.12, until 6.12).
 */
export function graceLast(paidUntil, change = null) {
  if (change && addDays(paidUntil, 1) < change) return addDays(paidUntil, 1 + OLD_GRACE_DAYS);
  const third = addDays(paidUntil, GRACE_DAYS);
  return Date.parse(endOfIsraelDay(third)) - Date.parse(endOfIsraelDay(paidUntil)) < GRACE_HOURS * 3_600_000 ? addDays(third, 1) : third;
}

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

/** A month recorded without a form's token or the paid-until day the page showed is refused this long after the last. */
export const PAY_AGAIN_MS = 60_000;

/** A one-time token for a form that records a month (the console's button): random, new each time the page is drawn. */
export const newPayOnce = () => randomBytes(16).toString('base64url');

/**
 * A month's payment came in: paid until a month after the last paid day (or after yesterday, if that is later). Each
 * of these refuses a month that was already recorded (WorkspaceError 'already_paid'), and then nothing is recorded:
 *   once    the one-time token of the form (newPayOnce()): a form is recorded once, however often it is sent (a double
 *           click, the browser sending it again, back and send), even if the date it carries is right again later
 *   expect  the paid-until date the page showed when the button was pressed ('' for none): when the subscription has
 *           moved on since (a page left open, another tab, a receipt recorded meanwhile), nothing more is recorded
 *   neither (a script, a request that did not come from the form): refused within 60 seconds of the last month
 *           recorded for this product of this workspace (PAY_AGAIN_MS)
 * Two payments meant as two (the next month from the page drawn again, another product, another workspace) each have
 * their own token and date, and both record. Each month is kept in paid_months, the token as its SHA-256 only.
 */
export function payMonth(db, workspaceId, product, { by, ip = null, expect = undefined, once = undefined }, today = israelToday()) {
  return db.tx(() => {
    const w = getWorkspace(db, workspaceId);
    ensureSubscription(db, w.id, product, today);
    const s = subscriptionsOf(db, w.id)[product];
    const onceHash = once ? hashToken(once) : null;
    if (onceHash && db.get('SELECT 1 FROM paid_months WHERE once_hash = ?', onceHash)) throw new WorkspaceError('already_paid');
    if (expect !== undefined && (s.paid_until ?? '') !== String(expect ?? '')) throw new WorkspaceError('already_paid');
    if (!onceHash && expect === undefined && db.get('SELECT 1 FROM paid_months WHERE workspace_id = ? AND product = ? AND at > ?', w.id, product, new Date(now() - PAY_AGAIN_MS).toISOString()))
      throw new WorkspaceError('already_paid');
    const from = s.paid_until && s.paid_until >= addDays(today, -1) ? s.paid_until : addDays(today, -1);
    const paid_until = addDays(addMonths(addDays(from, 1), 1), -1);
    const at = nowIso();
    db.run('UPDATE subscriptions SET paid_until = ?, updated_at = ? WHERE workspace_id = ? AND product = ?', paid_until, at, w.id, product);
    db.insert('paid_months', { workspace_id: w.id, product, paid_until, at, once_hash: onceHash });
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
 * What the customer sees of one subscription, on a given day. Pure. `change` is its workspace's graceChange(), for
 * the day it stops while due.
 *   status   'active' | 'due' (the paid month is over: it works until graceUntil, then stops until paid) | 'ending'
 *            (stopped, its last day ahead) | 'ended' | 'open' (on, no payment recorded yet)
 *   plan     Teder's plan name (PLANS), or null
 *   left     days left: to the last day paid for, or to the last day when it is ending
 *   period   the length of the current paid month, for the bar
 *   bar      the paid month today is in (paidMonth() above), or null: there is no bar while nothing is paid, once
 *            the paid month is over, or once it has ended
 *   next     the next charge: { on, monthly, vat }, or null when it is ending or ended
 */
export function describe(s, today = israelToday(), change = null) {
  if (!s) return null;
  const base = { plan: s.plan ?? null, monthly: s.monthly, vat: s.vat, setup: s.setup, started_on: s.started_on, paid_until: s.paid_until, ends_on: s.ends_on };
  if (s.ends_on && s.ends_on < today) return { ...base, status: 'ended', left: 0, period: null, bar: null, next: null };
  if (s.ends_on) {
    const bar = paidMonth(s.paid_until, today, s.ends_on);
    return { ...base, status: 'ending', left: daysBetween(today, s.ends_on) + 1, period: bar?.days ?? null, bar, next: null };
  }
  if (!s.paid_until) return { ...base, status: 'open', left: null, period: null, bar: null, next: null };
  if (s.paid_until < today) return { ...base, status: 'due', left: 0, period: null, bar: null, graceUntil: graceLast(s.paid_until, change), next: { on: addDays(s.paid_until, 1), monthly: s.monthly, vat: s.vat } };
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

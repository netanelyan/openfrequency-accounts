import { enabledProducts } from '../auth/sessions.js';
import { PRODUCT_NAMES } from '../web/copy.js';
import { accessAll } from './entitlement.js';
import { PHONE } from './phones.js';
import { addDays, israelToday, payTotal, subscriptionsOf } from './subscriptions.js';

// How a customer pays for a subscription: the switch OF_PAYMENT. Either way the operator records each payment on
// /admin (subscriptions.js payMonth, which moves paid_until on), and the paywall (entitlement.js) opens a product once
// a recorded payment covers today. No provider is called from here.
//
//   OF_PAYMENT=manual     (or unset: the default, and how it works today) we email each new customer the payment details
//                         (the owner's sign-up notice says to, with the address), and OF_PAYMENT_METHOD, when set, says
//                         how they pay ("העברה בנקאית או ביט"). The setup page's payment step leads to us for questions
//                         (our WhatsApp, OF_SUPPORT_WA, else an email to MAIL_REPLY_TO, else the website's contact page).
//   OF_PAYMENT=provider   the customer pays by card on the payment provider's own page, OF_PAYMENT_URL (https), from the
//                         setup page's "לתשלום" button and the billing emails. The product opens once the payment is
//                         recorded, never at once.
//
// Any other value of OF_PAYMENT, or provider without an https OF_PAYMENT_URL, and the service will not start
// (paymentProblem(), scripts/web.js).

export const PAYMENT_MODES = ['manual', 'provider'];

/** OF_PAYMENT_URL when it is an https address with a host and no user name or password in it; else null. */
function paymentUrl(env) {
  try {
    const u = new URL(String(env.OF_PAYMENT_URL || '').trim());
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** What is wrong with the payment settings, in one line, or null when nothing is. The service refuses to start on it. */
export function paymentProblem(env = process.env) {
  const mode = String(env.OF_PAYMENT ?? '').trim();
  if (mode && !PAYMENT_MODES.includes(mode)) return `OF_PAYMENT is ${JSON.stringify(mode.slice(0, 40))}: it can be manual (the default, when unset) or provider`;
  if (mode === 'provider' && !paymentUrl(env)) {
    return String(env.OF_PAYMENT_URL || '').trim()
      ? `OF_PAYMENT_URL is not an https address: with OF_PAYMENT=provider it is the payment provider's payment page`
      : `OF_PAYMENT=provider needs OF_PAYMENT_URL, the https address of the payment provider's payment page`;
  }
  return null;
}

/** 'provider' when OF_PAYMENT says so and OF_PAYMENT_URL is good; else 'manual'. */
export const paymentMode = (env = process.env) => (String(env.OF_PAYMENT ?? '').trim() === 'provider' && paymentUrl(env) ? 'provider' : 'manual');

/**
 * How a customer pays in manual mode, in the owner's words (OF_PAYMENT_METHOD, for example "העברה בנקאית או ביט"): said
 * on /setup, in the welcome email and in the billing emails. Empty while unset, and with a provider.
 */
export const payHow = (env = process.env) => (paymentMode(env) === 'manual' ? String(env.OF_PAYMENT_METHOD || '').trim().slice(0, 200) : '');

/** Does the customer pay online, on the provider's page? True with OF_PAYMENT=provider. */
export const billingReady = (env = process.env) => paymentMode(env) === 'provider';

/** Where a workspace's owner pays: the provider's payment page (OF_PAYMENT_URL), the same for every workspace; null in manual mode. */
export const checkoutUrl = (workspaceId, env = process.env) => (billingReady(env) ? paymentUrl(env) : null);

/** Our WhatsApp (OF_SUPPORT_WA) in international digits, written the usual ways ("+972 55-..."), or null while unset. */
export function supportWa(env = process.env) {
  const digits = String(env.OF_SUPPORT_WA || '').replace(/[\s+-]/g, '');
  return PHONE.test(digits) ? digits : null;
}

/**
 * The owner line's WhatsApp number in international digits (OF_ASSISTANT_WA), or null while it is unset: the number
 * Toran answers on, where a link code is sent (docs/internal-owner-phone.md) and where "לתשלום בוואטסאפ" leads
 * (docs/internal-pay.md).
 */
export function assistantWa(env = process.env) {
  const digits = String(env.OF_ASSISTANT_WA || '').replace(/[\s+-]/g, '');
  return PHONE.test(digits) ? digits : null;
}

// ---- what a workspace owes now
//
// One answer to "how much is to pay now", for every place that says it: /setup's payment card (html.js billingCard),
// what Toran tells a customer who wants to pay on WhatsApp (GET /internal/pay) and what a transfer's receipt is held
// against (src/accounts/pay.js). Product by product, among the products turned on:
//   comp     complimentary: nothing
//   due      the paid month is over, in its 14 days of grace: a month (no setup fee)
//   paid     a recorded payment covers today (cancelled ones included, until their last day): nothing
//   none     no price recorded: nothing
//   owed     anything else (never paid, or the grace is over): a month, and the setup fee until the first payment
// With `ahead` (days) and nothing owed now, a product paid for whose next payment falls due within that many days is
// owed too, a month ahead: what the billing emails a week and a day before ask for (src/web/daily.js), so the button
// in them leads to that month and not to "nothing to pay". The card asks without it, so it shows what is owed today.

/** How many days before a payment falls due Toran quotes it: the week of the first billing email (daily.js soon7). */
export const PAY_AHEAD_DAYS = 7;

/**
 * What is to pay, from the rows. Pure. `products` in their order, `access` as accessAll() gives it, `prices` the
 * subscription rows by product (subscriptionsOf()). Returns
 *   items       [{ product, productName, plan, monthly, setup, net, total, firstMonth }]: each product to pay for now.
 *               setup is the setup fee, 0 unless this is its first payment; net is the month and the setup fee as
 *               recorded; total is that with VAT (withVat())
 *   net, vat, total   the payment, as payTotal() works it out: total with VAT; net the part recorded before VAT and
 *               vat the VAT on it (0 when every price already includes it). All 0 with nothing to pay
 *   vatIncluded true when every price in it was recorded with VAT in it (nothing added on top)
 *   monthsAfter with a setup fee in it, the months after it, with VAT; else null
 *   lines       one per product: { product, kind (above, or 'ahead'), plan, monthly, vat, setup, paidUntil,
 *               graceUntil, item } for the card's lines and the receipt page
 */
export function dueOf({ products, access = {}, prices = {}, today = israelToday(), ahead = 0 }) {
  const item = (p, s, setup, extra = {}) => {
    const parts = [{ sum: s.monthly, vat: s.vat }, ...(setup ? [{ sum: setup, vat: s.vat }] : [])];
    return { product: p, productName: PRODUCT_NAMES[p], plan: s.plan ?? null, monthly: Number(s.monthly), setup: Number(setup || 0), net: Number(s.monthly) + Number(setup || 0), total: payTotal(parts).total, firstMonth: !s.paid_until, ...extra, parts };
  };
  const lines = products.map((p) => {
    const a = access[p];
    const s = prices[p] || {};
    const base = { product: p, plan: s.plan ?? null, monthly: s.monthly ?? null, vat: s.vat ?? null, setup: 0, paidUntil: a?.paidUntil ?? null, graceUntil: a?.graceUntil ?? null, access: a?.access ?? null, item: null };
    if (a?.access === 'comp') return { ...base, kind: 'comp' };
    if (a?.access === 'due') return { ...base, kind: 'due', item: s.monthly != null ? item(p, s, 0) : null };
    if (a?.allowed && a.paidUntil) return { ...base, kind: 'paid' };
    if (s.monthly == null) return { ...base, kind: 'none' };
    const setup = !s.paid_until && s.setup ? s.setup : 0;
    return { ...base, kind: 'owed', setup: Number(setup), item: item(p, s, setup) };
  });
  if (ahead > 0 && !lines.some((l) => l.item)) {
    for (const l of lines) {
      const s = prices[l.product] || {};
      if (l.kind === 'paid' && l.access === 'paid' && s.monthly != null && addDays(l.paidUntil, 1 - ahead) <= today) Object.assign(l, { kind: 'ahead', item: item(l.product, s, 0) });
    }
  }
  const owed = lines.filter((l) => l.item).map((l) => l.item);
  const sum = owed.length ? payTotal(owed.flatMap((i) => i.parts)) : { total: 0, net: 0, vat: 0 };
  const withSetup = owed.some((i) => i.setup);
  const strip = ({ parts, ...i }) => i;
  return {
    items: owed.map(strip),
    net: sum.net,
    vat: sum.vat,
    total: sum.total,
    vatIncluded: owed.length > 0 && owed.every((i) => i.parts.every((x) => x.vat === 'included')),
    monthsAfter: withSetup ? payTotal(owed.map((i) => i.parts[0])).total : null,
    lines: lines.map((l) => ({ ...l, item: l.item ? strip(l.item) : null })),
  };
}

/** What a workspace owes on `today`, read fresh: dueOf() of its products turned on. `ahead` as dueOf() takes it. */
export function amountDue(db, workspaceId, today = israelToday(), { ahead = 0 } = {}) {
  return dueOf({ products: enabledProducts(db, workspaceId), access: accessAll(db, workspaceId, today), prices: subscriptionsOf(db, workspaceId), today, ahead });
}

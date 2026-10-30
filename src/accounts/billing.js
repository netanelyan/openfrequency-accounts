import { PHONE } from './phones.js';

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

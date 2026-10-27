// Paying for a subscription on the site. A card-clearing provider will take the payments; none is connected yet, so
// today the operator records each payment on /admin (subscriptions.js payMonth, which moves paid_until on) and the
// paywall (entitlement.js) opens a product once a recorded payment covers today. These are the hooks the provider
// plugs into, and nothing more: no provider is called from here.
//
//   OF_BILLING_PROVIDER   set (to the provider's name) once one is connected. Until then billingReady() is false: the
//                         setup page's payment step says the online payment opens soon and leads to us (our WhatsApp,
//                         OF_SUPPORT_WA, or the website's contact page), and the account page shows no next charge.

/** Is a payment provider connected? False until OF_BILLING_PROVIDER is set. */
export const billingReady = (env = process.env) => Boolean(String(env.OF_BILLING_PROVIDER || '').trim());

/**
 * Where a workspace's owner pays: the provider's checkout page. A placeholder until a provider is connected, so it is
 * null and the setup page's payment step has no checkout button yet.
 */
export const checkoutUrl = (/* workspace, env */) => null;

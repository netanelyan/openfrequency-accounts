import { describe } from './subscriptions.js';

// Paying for a subscription on the site. A card-clearing provider will take the payments; none is connected yet, so
// today the operator records each payment on /admin (subscriptions.js) and a new subscription waits as "open", on
// with nothing paid. These are the hooks the provider plugs into, and nothing more: no provider is called from here.
//
//   OF_BILLING_PROVIDER   set (to the provider's name) once one is connected. Until then billingReady() is false and
//                         the setup page shows payment as a step that is coming soon.

/** Is a payment provider connected? False until OF_BILLING_PROVIDER is set. */
export const billingReady = (env = process.env) => Boolean(String(env.OF_BILLING_PROVIDER || '').trim());

/**
 * Where a workspace's owner pays: the provider's checkout page. A placeholder until a provider is connected, so it is
 * null and the setup page's payment step has no button yet.
 */
export const checkoutUrl = (/* workspace, env */) => null;

/** Is every one of these subscriptions paid for today (active, or ending with days paid ahead)? */
export const allPaid = (rows, products) => products.length > 0 && products.every((p) => ['active', 'ending'].includes(describe(rows[p])?.status));

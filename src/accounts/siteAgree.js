// Accounts and the website say the same thing (TORAN-READINESS.md P0-9): the terms version a sign-up accepts is the day
// the website's sign-up terms and contracts were last changed, and every plan's price, setup fee and month is the one
// the website sells. Read by scripts/release-check.js against ../openfrequency-web/site.config.json when that checkout
// is beside this one; a test runs it on a sample. Each problem is one line in English for the release log.

import { TERMS_VERSION } from './signup.js';
import { PLANS } from './subscriptions.js';

/** What differs between this build and the website's config (site.config.json, parsed): [] when they agree. */
export function siteAgreement(site, { terms = TERMS_VERSION, plans = PLANS } = {}) {
  const problems = [];
  const legal = site?.legal || {};
  for (const key of ['signupUpdated', 'contractsUpdated']) {
    if (legal[key] !== terms) problems.push(`TERMS_VERSION is ${terms} and the website's legal.${key} is ${legal[key] ?? 'missing'}: change them together (openfrequency-web README, the launch)`);
  }
  const want = [];
  const teder = site?.teder || {};
  for (const [name, src] of [['full', teder], ['small', teder.small || {}]]) {
    want.push(['teder', name, 'monthly', src.monthly], ['teder', name, 'setup', src.setup], ['teder', name, 'slideshows', src.slideshows], ['teder', name, 'redos', src.redos]);
  }
  const price = site?.price || {};
  for (const name of ['store', 'big']) {
    const p = price.plans?.[name] || {};
    want.push(['toran', name, 'monthly', p.monthly], ['toran', name, 'setup', price.setup], ['toran', name, 'conversations', p.conversations]);
  }
  for (const [product, name, field, value] of want) {
    const have = plans[product]?.[name]?.[field];
    if (have !== value) problems.push(`${product} ${name} ${field}: accounts has ${have ?? 'nothing'}, the website ${value ?? 'nothing'}`);
  }
  return problems;
}

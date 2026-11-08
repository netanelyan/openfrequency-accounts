import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteAgreement } from '../src/accounts/siteAgree.js';
import { TERMS_VERSION } from '../src/accounts/signup.js';
import { PLANS } from '../src/accounts/subscriptions.js';

// The website's config as it sells today (openfrequency-web site.config.json, 2026-11-08): what release-check compares
// this build with (TORAN-READINESS.md P0-9).
const site = () => ({
  legal: { signupUpdated: TERMS_VERSION, contractsUpdated: TERMS_VERSION },
  teder: { monthly: 790, setup: 1490, slideshows: 40, redos: 10, small: { monthly: 490, setup: 990, slideshows: 15, redos: 4 } },
  price: { setup: 990, plans: { store: { monthly: 590, conversations: 300 }, big: { monthly: 1190, conversations: 1500 } } },
});

test('accounts and the website agree on the terms day and on every plan; a difference is one line each', () => {
  assert.deepEqual(siteAgreement(site()), []);
  assert.equal(PLANS.toran.big.monthly, 1190);

  const moved = site();
  moved.legal.contractsUpdated = '2099-01-01';
  assert.deepEqual(siteAgreement(moved), [`TERMS_VERSION is ${TERMS_VERSION} and the website's legal.contractsUpdated is 2099-01-01: change them together (openfrequency-web README, the launch)`]);

  const priced = site();
  priced.price.plans.big.monthly = 1290;
  delete priced.teder.small;
  const problems = siteAgreement(priced);
  assert.ok(problems.includes('toran big monthly: accounts has 1190, the website 1290'));
  assert.ok(problems.includes('teder small monthly: accounts has 490, the website nothing'));
});

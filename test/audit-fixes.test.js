import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { sampleSetup, startProduct } from './setup-fake.js';
import { setNow } from '../src/core/clock.js';
import { addDays, ensureSubscription, israelToday, payMonth } from '../src/accounts/subscriptions.js';
import { cancelSubscription } from '../src/accounts/entitlement.js';
import { setDisabled } from '../src/accounts/workspaces.js';
import { createInvite } from '../src/accounts/links.js';
import { AUDIT_NAMES } from '../src/web/copy.js';

// What the pre-launch audit of 2026-11-11 found on the customer's pages and the operator's console, each as it is now
// (the owner, 2026-11-11: "do a final run around EVERYTHING. correct everything that is incomplete").

const SUPPORT = '972500000000';

async function setup({ env = {}, answer = () => sampleSetup('teder', { done: true }) } = {}) {
  const h = tempHome();
  setNow('2026-11-11T10:00:00.000Z');
  const teder = await startProduct('teder', { answer });
  const site = await startSite(h.db, { env: { OF_TEDER_INTERNAL: teder.url, TEDER_URL: 'https://teder.openfrequency.co.il/', OF_SUPPORT_WA: SUPPORT, ...env } });
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true });
  const ws = makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', products: ['teder'], members: { 'dana@example.com': 'client_owner', 'noa@example.com': 'client_member' } });
  ensureSubscription(h.db, ws.id, 'teder', undefined, 'small');
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  const paidUntil = (d) => h.db.run("UPDATE subscriptions SET paid_until = ? WHERE workspace_id = ? AND product = 'teder'", d, ws.id);
  return { ...h, ...site, teder, ws, admin, user, paidUntil, as: (email) => signedIn(site, h.db, user(email)), done: async () => (await site.close(), await teder.close(), h.cleanup()) };
}

test('a cancelled product keeps its two buttons in one row: the resume form inside the card\'s buttons, not fallen out of a <p>', async () => {
  const t = await setup();
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: t.admin });
    cancelSubscription(t.db, t.ws.id, 'teder', { by: t.user('dana@example.com') });
    const home = (await t.as('dana@example.com').get('/')).body;
    assert.match(home, /<div class="go"><a class="button primary" href="https:\/\/teder\.openfrequency\.co\.il\/">כניסה לתדר<\/a><form method="post" action="\/subscription\/teder\/resume" class="inline">[^]*?להמשיך את המנוי<\/button><\/form><\/div>/);
    assert.doesNotMatch(home, /<p class="go">/);
  } finally {
    await t.done();
  }
});

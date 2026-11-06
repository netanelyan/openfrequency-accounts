import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkPhone, makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';

// One action per screen on the customer's pages (the owner, 2026-11-06: "dont give users too many things to do, or
// options. follow hicks law. every screen should have one action. main button should look the most important, advanced
// options hidden until someone needs them, and if an option isnt relevant dont show it"). The home page has one blue
// button, whatever the account's state; cancelling is a quiet link; the invite form waits behind its summary; a product
// that can't be bought now isn't offered; the product emails show only for a product that sends them; and the second
// way to sign out on every device (the header's "יציאה" leads to the same page) is gone.

const primaries = (html) => (html.match(/class="(?:button )?primary"/g) || []).length;

async function setup(env = {}) {
  const h = tempHome();
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true });
  const fresh = makeWorkspace(h.db, 'new-shop', { name: 'חנות חדשה', products: ['teder'], members: { 'new@example.com': 'client_owner' } });
  ensureSubscription(h.db, fresh.id, 'teder');
  const both = makeWorkspace(h.db, 'both-shop', { name: 'החנות של דנה', products: ['teder', 'toran'], members: { 'dana@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
  for (const p of ['teder', 'toran']) {
    ensureSubscription(h.db, both.id, p);
    payMonth(h.db, both.id, p, { by: admin });
  }
  const tederOnly = makeWorkspace(h.db, 'teder-shop', { name: 'חנות תדר', products: ['teder'], members: { 'tal@example.com': 'client_owner' } });
  ensureSubscription(h.db, tederOnly.id, 'teder');
  payMonth(h.db, tederOnly.id, 'teder', { by: admin });
  const toranOnly = makeWorkspace(h.db, 'toran-shop', { name: 'חנות תורן', products: ['toran'], members: { 'yael@example.com': 'client_owner' } });
  ensureSubscription(h.db, toranOnly.id, 'toran');
  payMonth(h.db, toranOnly.id, 'toran', { by: admin });
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  linkPhone(h.db, '972500000123', user('dana@example.com'), both);
  const site = await startSite(h.db, { env: { OF_SUPPORT_WA: '972500000000', OF_SIGNUP: '1', ...env } });
  const as = (email) => signedIn(site, h.db, user(email));
  return { ...h, ...site, as, both, done: async () => (await site.close(), h.cleanup()) };
}

test('the home page has one blue button in every state: new and unpaid, paid with two products, a member, one product', async () => {
  const t = await setup();
  try {
    for (const email of ['new@example.com', 'dana@example.com', 'ron@example.com', 'tal@example.com', 'yael@example.com']) {
      const home = (await t.as(email).get('/')).body;
      // The invite form's own button waits folded; outside it, one blue.
      const outside = home.replace(/<details class="team-more"[\s\S]*?<\/details>/g, '');
      assert.equal(primaries(outside), 1, `${email}: ${primaries(outside)} blue buttons`);
    }
    // New and unpaid: the setup card's button is the blue one; the product's own, to the same payment, is grey.
    const fresh = (await t.as('new@example.com').get('/')).body;
    assert.match(fresh, /<a class="button primary" href="\/setup">להמשך ההגדרה<\/a>/);
    assert.match(fresh, /<a class="button quiet" href="\/setup#setup-billing">להסדיר תשלום<\/a>/);
    // Paid, two products: into the first, the other grey; cancelling is a link under each card.
    const dana = (await t.as('dana@example.com').get('/')).body;
    assert.match(dana, /<a class="button primary" href="[^"]*">כניסה לתדר<\/a>/);
    assert.match(dana, /<a class="button quiet" href="[^"]*">כניסה לתורן<\/a>/);
    assert.match(dana, /<p class="links sub-cancel"><a href="\/subscription\/teder\/cancel" aria-label="לבטל את המנוי לתדר">לבטל את המנוי<\/a><\/p>/);
    assert.doesNotMatch(dana, /class="button quiet" href="\/subscription\//, 'cancelling is not a button');
    // Her number is linked: linking WhatsApp again is a grey pill.
    assert.match(dana, /<button class="quiet">לחבר את הוואטסאפ<\/button>/);
  } finally {
    await t.done();
  }
});

test("the invite form waits behind its summary, and opens by itself when it comes back with an error", async () => {
  const t = await setup();
  try {
    const b = t.as('dana@example.com');
    let home = (await b.get('/')).body;
    assert.match(home, /<details class="team-more"><summary>להזמין מישהו לחשבון<\/summary><form method="post" action="\/team\/invite" class="team-add">/);
    const r = await b.post('/team/invite', { email: 'not-an-email', role: 'client_member' });
    assert.equal(r.status, 400);
    assert.match(r.body, /<details class="team-more" open><summary>/);
    assert.match(r.body, /value="not-an-email"/);
  } finally {
    await t.done();
  }
});

test("a product that can't be bought now isn't offered, and the second way to sign out everywhere is gone", async () => {
  const t = await setup({ OF_SIGNUP_PRODUCTS: 'teder' });
  try {
    const home = (await t.as('tal@example.com').get('/')).body;
    assert.doesNotMatch(home, /עוד מאיתנו|openfrequency\.co\.il\/toran/, 'Toran, which sign-up does not sell yet');
    assert.doesNotMatch(home, /יציאה מכל המכשירים/, 'signing out everywhere is on /logout, where the header leads');
    assert.match(home, /<a class="button quiet" href="\/logout">יציאה<\/a>/);
    assert.match((await t.as('tal@example.com').get('/logout')).body, /יציאה מכל המכשירים/);
  } finally {
    await t.done();
  }
  // With both products sold, a Teder workspace is shown Toran.
  const u = await setup();
  try {
    assert.match((await u.as('tal@example.com').get('/')).body, /עוד מאיתנו[^]*openfrequency\.co\.il\/toran/);
  } finally {
    await u.done();
  }
});

test('the product emails offer only what a product sends: Teder\'s boxes, none for Toran, and no button without them', async () => {
  const t = await setup();
  try {
    const b = t.as('dana@example.com');
    const page = (await b.get('/notifications')).body;
    assert.match(page, /name="on" value="teder:weekly"/);
    assert.doesNotMatch(page, /value="toran:/, "Toran sends none of these (Teder's kinds)");
    await b.post('/notifications', { workspace: String(t.both.id), on: ['teder:weekly', 'toran:weekly'] });
    assert.deepEqual(t.db.all('SELECT DISTINCT product FROM notify_prefs').map((r) => r.product), ['teder'], 'nothing saved for Toran');
    // A Toran-only account has nothing to choose: no button on its home page.
    assert.doesNotMatch((await t.as('yael@example.com').get('/')).body, /href="\/notifications"/);
    assert.match((await t.as('yael@example.com').get('/notifications')).body, /כרגע אף מוצר בחשבון לא שולח מיילים, אז אין מה לבחור\./);
  } finally {
    await t.done();
  }
});

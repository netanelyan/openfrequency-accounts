import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome, withoutLoadJs } from './helpers.js';
import { signedIn, startSite, TOKEN, tokenOf } from './site.js';
import { setNow, MINUTE } from '../src/core/clock.js';
import { createLimiter } from '../src/auth/limiter.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { startViewAs } from '../src/accounts/workspaces.js';
import { readSetup, setupHref, setupState } from '../src/web/setup.js';
import { sampleSetup, startProduct } from './setup-fake.js';

// The setup page (/setup) end to end, with Toran and Teder played by fake internal servers (test/setup-fake.js):
// only the products a workspace has turned on are asked and shown, an answer is checked against the contract and
// escaped, a product that hangs or answers nonsense gets a line, and a customer lands on /setup until it is done.

const URLS = { TEDER_URL: 'https://teder.openfrequency.co.il/', TORAN_URL: 'https://toran.openfrequency.co.il/' };

// The workspace is complimentary unless a test says otherwise (comp: false): most of these are about the products'
// checklists, and the paywall's own tests are in test/paywall.test.js.
async function setup({ products = ['teder'], env = {}, toran, teder, setupMs, comp = true } = {}) {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const fakes = { toran: await startProduct('toran', toran), teder: await startProduct('teder', teder) };
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products, comp, members: { 'noa@example.com': 'client_owner' } });
  for (const p of products) ensureSubscription(h.db, ws.id, p);
  // These tests sign the same customer in many times: the link limits are not what they are about.
  const many = () => createLimiter({ rules: [{ max: 1000, windowMs: 15 * MINUTE }] });
  const limiters = { magicEmail: many(), magicIp: many(), adminLogin: many() };
  const site = await startSite(h.db, { env: { OF_TORAN_INTERNAL: fakes.toran.url, OF_TEDER_INTERNAL: fakes.teder.url, ...URLS, ...env }, limiters, ...(setupMs ? { setupMs } : {}) });
  const noa = h.db.get('SELECT * FROM users WHERE email = ?', 'noa@example.com');
  return {
    ...h,
    ...site,
    ws,
    noa,
    fakes,
    done: async () => {
      await site.close();
      await Promise.all(Object.values(fakes).map((f) => f.close()));
      h.cleanup();
    },
  };
}

/** Sign in with an emailed link, the way a customer does, and say where it landed. */
async function signIn(t, next) {
  const b = t.browser();
  await b.get('/login');
  await b.post('/login', { email: 'noa@example.com', ...(next ? { next } : {}) });
  const r = await b.post('/auth/link', { t: tokenOf(t.mails.at(-1).link) });
  assert.equal(r.status, 303);
  return { b, to: r.headers.location };
}

test('a Teder-only workspace: only Teder is asked and shown, never Toran; its steps, chips, buttons and progress', async () => {
  const t = await setup({ products: ['teder'] });
  try {
    const b = signedIn(t, t.db, t.noa);
    const r = await b.get('/setup');
    assert.equal(r.status, 200);
    assert.equal(t.fakes.toran.calls.length, 0);
    assert.equal(t.fakes.teder.calls.length, 1);
    assert.deepEqual(t.fakes.teder.calls[0], { method: 'GET', path: `/internal/setup?workspace=${t.ws.id}`, auth: `Bearer ${TOKEN}`, workspace: String(t.ws.id) });
    const body = r.body;
    assert.doesNotMatch(body, /תורן/);
    assert.doesNotMatch(body, /setup-toran|mark toran/);
    assert.match(body, /<section class="card setup-p" id="setup-teder">/);
    // Payment first: done, since this workspace is complimentary.
    assert.ok(body.indexOf('id="setup-billing"') < body.indexOf('id="setup-teder"'));
    assert.match(body, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>החשבון הזה אצלנו ללא תשלום\.<\/small>/);
    // The steps: done (no button), to do (the one blue button), and the optional one under "אפשר גם", no link.
    assert.match(body, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>לחבר את חשבון האינסטגרם<\/b><\/span><\/li>/);
    assert.match(body, /<li class="step st-todo"><span class="chip">עוד לא<\/span><span class="what"><b>לבדוק את התשובה הראשונה<\/b><small>זה לוקח בערך חמש דקות\.<\/small><\/span><a class="button primary" href="https:\/\/teder\.openfrequency\.co\.il\/first" aria-label="להתחיל, לבדוק את התשובה הראשונה">להתחיל<\/a><\/li>/);
    assert.ok(body.indexOf('אפשר גם') > body.indexOf('לבדוק את התשובה הראשונה'));
    assert.match(body, /<p class="section-l">אפשר גם<\/p><ol class="steps"><li class="step st-todo"><span class="chip">עוד לא<\/span><span class="what"><b>להוסיף עוד מישהו מהצוות<\/b><\/span><\/li>/);
    assert.match(body, /<span class="tag off">עוד לא מוכן<\/span>/);
    // 2 of the 4 steps: payment and the first one done.
    assert.match(body, /2 מתוך 4 צעדים/);
    assert.match(body, /<progress max="4" value="2"/);
    assert.doesNotMatch(withoutLoadJs(body), /<script/);
  } finally {
    await t.done();
  }
});

test('both products are asked at once; one that hangs gets a line and a link, and the page does not wait 3 seconds', async () => {
  const t = await setup({ products: ['teder', 'toran'], teder: { answer: () => 'hang' }, setupMs: 300 });
  try {
    const b = signedIn(t, t.db, t.noa);
    const started = Date.now();
    const r = await b.get('/setup');
    assert.ok(Date.now() - started < 2500);
    assert.equal(r.status, 200);
    assert.equal(t.fakes.toran.calls.length, 1);
    const teder = r.body.slice(r.body.indexOf('id="setup-teder"'));
    assert.match(teder, /לא הצלחנו לבדוק כרגע\./);
    assert.match(teder, /<a class="button quiet" href="https:\/\/teder\.openfrequency\.co\.il\/">לפתוח את תדר<\/a>/);
    assert.match(r.body, /חלק מהמוצרים לא ענו לנו עכשיו/);
    assert.match(r.body, /לחבר את האתר של החנות/);
  } finally {
    await t.done();
  }
});

test('hostile answers: HTML is escaped, a link that is not ours is dropped, and an answer off the contract is not used', async () => {
  const hostile = {
    product: 'toran',
    ready: false,
    steps: [
      { key: 'a', title: '<script>alert(1)</script>', status: 'todo', detail: '<img src=x onerror=alert(1)>', href: 'javascript:alert(1)', required: true },
      { key: 'b', title: 'evil', status: 'working', detail: null, href: 'https://evil.example/phish', required: true },
      { key: 'c', title: 'data', status: 'attention', href: 'data:text/html,<b>x</b>', required: true },
      { key: 'd', title: 'protocol-relative', status: 'todo', href: '//evil.example/x', required: false },
      { key: 'e', title: 'with a password', status: 'todo', href: 'https://user:pw@toran.openfrequency.co.il/', required: false },
      { key: 'f', title: 'a path', status: 'attention', href: '/settings?tab=store', required: false },
      { key: 'g', title: 'plain http on ours', status: 'todo', href: 'http://toran.openfrequency.co.il/x', required: false },
      { key: 'h', title: 'lookalike', status: 'todo', href: 'https://toran.openfrequency.co.il.evil.example/', required: false },
    ],
  };
  const t = await setup({ products: ['toran'], toran: { answer: () => hostile } });
  try {
    const b = signedIn(t, t.db, t.noa);
    const r = await b.get('/setup');
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(r.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.doesNotMatch(withoutLoadJs(r.body), /<script|<img|javascript:|evil\.example|data:text|user:pw|http:\/\/toran/);
    // The only link left: the path, on Toran's own address; attention and working say so.
    assert.match(r.body, /<a class="button primary" href="https:\/\/toran\.openfrequency\.co\.il\/settings\?tab=store" aria-label="לפתוח, a path">לפתוח<\/a>/);
    assert.match(r.body, /<span class="chip">צריך תשומת לב<\/span>/);
    assert.match(r.body, /<span class="chip">בתהליך<\/span>/);
    assert.equal((r.body.match(/class="button (?:primary|quiet)" href="https:\/\/toran/g) || []).length, 1);
  } finally {
    await t.done();
  }

  // Off the contract, each way: the product is "could not check", never a finished checklist.
  const bad = [
    { raw: '<html>not json</html>' },
    { status: 500, raw: '{"product":"toran","ready":true,"steps":[]}' },
    { ...sampleSetup('teder') },
    { product: 'toran', ready: 'yes', steps: [] },
    { product: 'toran', ready: true },
    { product: 'toran', ready: true, steps: [{ key: 'a', title: 'x', status: 'finished', required: true }] },
    { product: 'toran', ready: true, steps: [{ key: 'a', title: 'x', status: 'done', required: 'yes' }] },
    { product: 'toran', ready: true, steps: [{ key: 'a', title: '', status: 'done', required: true }] },
    { product: 'toran', ready: true, steps: [{ key: 'a b<', title: 'x', status: 'done', required: true }] },
    { product: 'toran', ready: true, steps: [{ key: 'a', title: 'x', status: 'done', required: true }, { key: 'a', title: 'y', status: 'done', required: true }] },
    { product: 'toran', ready: true, steps: [{ key: 'a', title: 'x', status: 'done', required: true, href: { evil: true } }] },
    { product: 'toran', ready: true, steps: Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, title: 'x', status: 'done', required: true })) },
    { raw: JSON.stringify({ product: 'toran', ready: true, steps: [{ key: 'a', title: 'x'.repeat(70_000), status: 'done', required: true }] }) },
  ];
  for (const answer of bad) {
    const u = await setup({ products: ['toran'], toran: { answer: () => answer } });
    try {
      const r = await signedIn(u, u.db, u.noa).get('/setup');
      assert.equal(r.status, 200);
      assert.match(r.body, /לא הצלחנו לבדוק כרגע/, JSON.stringify(answer).slice(0, 120));
    } finally {
      await u.done();
    }
  }
});

test('a customer lands on /setup after signing in while a required step is left; home once done; ?next= first', async () => {
  const t = await setup({ products: ['toran'] });
  try {
    assert.equal((await signIn(t)).to, '/setup');
    assert.equal((await signIn(t, 'https://toran.openfrequency.co.il/inbox')).to, 'https://toran.openfrequency.co.il/inbox');
    // The home page: the card, while a product says it is not done (the header's link gives way to it).
    const { b } = await signIn(t);
    let home = await b.get('/');
    assert.match(home.body, /<section class="card setup-card">/);
    assert.match(home.body, /2 מתוך 4 צעדים הושלמו\./);
    assert.match(home.body, /<a class="button primary" href="\/setup">להמשך ההגדרה<\/a>/);
    assert.doesNotMatch(home.body, /href="\/setup">הגדרה</);

    // Ready, but an optional step left: done.
    t.fakes.toran.state.answer = () => sampleSetup('toran', { done: true });
    assert.equal((await signIn(t)).to, '/');
    home = await b.get('/');
    assert.doesNotMatch(home.body, /setup-card|href="\/setup"/);
    const page = await b.get('/setup');
    assert.match(page.body, /כל הצעדים הושלמו\./);
    assert.match(page.body, /<span class="tag">מוכן<\/span>/);

    // Required steps done but the product says it is not ready yet: still setup.
    t.fakes.toran.state.answer = () => ({ ...sampleSetup('toran', { done: true }), ready: false });
    assert.equal((await signIn(t)).to, '/setup');

    // Toran does not answer: home, as before, with the header link (we do not know it is done) and no card.
    t.fakes.toran.state.answer = () => ({ raw: 'nope', status: 503 });
    assert.equal((await signIn(t)).to, '/');
    home = await b.get('/');
    assert.doesNotMatch(home.body, /setup-card/);
    assert.match(home.body, /href="\/setup">הגדרה</);
  } finally {
    await t.done();
  }
});

test('payment, once a provider is connected: a step to do until the payment is in, then done and the products open', async () => {
  const t = await setup({ products: ['toran'], comp: false, toran: { answer: () => sampleSetup('toran', { done: true }) }, env: { OF_BILLING_PROVIDER: 'test-provider' } });
  try {
    const { b, to } = await signIn(t);
    assert.equal(to, '/setup');
    let page = await b.get('/setup');
    // No checkout page yet (checkoutUrl() is a placeholder): the step still leads to us, never a dead end.
    assert.match(page.body, /<li class="step st-todo"><span class="chip">עוד לא<\/span><span class="what"><b>התשלום על המנוי<\/b><small>התשלום באתר ייפתח בקרוב\.[^<]*<\/small><\/span><a class="button primary" href="https:\/\/openfrequency\.co\.il\/join">ליצירת קשר<\/a><\/li>/);
    assert.match(page.body, /<section class="card setup-p locked" id="setup-toran">/);
    payMonth(t.db, t.ws.id, 'toran', { by: null });
    assert.equal((await signIn(t)).to, '/');
    page = await b.get('/setup');
    assert.match(page.body, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>המנוי שולם\.<\/small>/);
    assert.match(page.body, /תורן: שולם עד 21\.11\.2026/);
    assert.match(page.body, /<section class="card setup-p" id="setup-toran">/);
  } finally {
    await t.done();
  }
});

test('the superadmin sees /setup only in view-as, read-only with no buttons; outside it, /admin', async () => {
  const t = await setup({ products: ['toran'] });
  try {
    const admin = makeUser(t.db, 'boss@example.com', { superadmin: true });
    const b = signedIn(t, t.db, admin);
    assert.equal((await b.get('/setup')).headers.location, '/admin');
    const session = t.db.get('SELECT * FROM sessions WHERE user_id = ?', admin.id);
    startViewAs(t.db, session, t.ws.id, { by: admin });
    const r = await b.get('/setup');
    assert.equal(r.status, 200);
    assert.match(r.body, /אתם צופים ב-Noa Shop/);
    assert.match(r.body, /לחבר את האתר של החנות/);
    assert.doesNotMatch(r.body, /class="button primary" href="https:\/\/toran/);
    assert.equal((await t.browser().get('/setup')).headers.location, '/login');
  } finally {
    await t.done();
  }
});

test('the contract, without a network: links, shapes and the summary', () => {
  const urls = { teder: 'http://localhost:4700/', toran: 'https://toran.openfrequency.co.il/' };
  assert.equal(setupHref('https://openfrequency.co.il/x', 'toran', urls), 'https://openfrequency.co.il/x');
  assert.equal(setupHref('http://localhost:4700/a', 'teder', urls), 'http://localhost:4700/a');
  assert.equal(setupHref('/a', 'teder', urls), 'http://localhost:4700/a');
  assert.equal(setupHref('http://localhost:9999/a', 'teder', urls), null);
  assert.equal(setupHref(' JavaScript:alert(1)', 'toran', urls), null);
  assert.equal(setupHref('/\\evil.example', 'toran', urls), null);
  assert.equal(setupHref('https://toran.openfrequency.co.il/a b', 'toran', urls), null);
  assert.deepEqual(readSetup({ product: 'teder', ready: true, steps: [] }, 'teder'), { ready: true, steps: [] });
  assert.equal(readSetup([], 'teder'), null);
  assert.equal(readSetup(null, 'teder'), null);

  const ok = { ok: true, ready: true, steps: [{ key: 'a', status: 'done', required: true }, { key: 'b', status: 'soon', required: false }] };
  const open = { allowed: true, access: 'paid' };
  // Paid for: payment and the one step done ("soon" is not counted).
  let s = setupState({ teder: ok }, ['teder'], { access: { teder: open } });
  assert.deepEqual([s.done, s.total, s.complete, s.incomplete, s.unknown, s.billing.status], [2, 2, true, false, false, 'done']);
  // Not paid for: payment to do, the product locked and not done, even though its own steps are.
  s = setupState({ teder: ok }, ['teder'], { access: { teder: { allowed: false, access: 'unpaid' } }, contact: 'https://wa.me/972500000100' });
  assert.deepEqual([s.done, s.total, s.complete, s.incomplete, s.billing.status, s.billing.href, s.sections[0].locked, s.sections[0].done], [1, 2, false, true, 'todo', 'https://wa.me/972500000100', true, false]);
  // A provider with a checkout page: there, and not to us.
  s = setupState({ teder: ok }, ['teder'], { billingReady: true, checkout: 'https://pay.example/x', contact: 'https://wa.me/1' });
  assert.deepEqual([s.billing.href, s.billing.checkout], ['https://pay.example/x', true]);
  s = setupState({ teder: ok, toran: { ok: false } }, ['teder', 'toran'], { access: { teder: open, toran: open } });
  assert.deepEqual([s.complete, s.incomplete, s.unknown], [false, false, true]);
  s = setupState({}, [], { billingReady: true });
  assert.equal(s.complete, true);
});

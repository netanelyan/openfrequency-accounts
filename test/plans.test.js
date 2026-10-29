import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { pathOf, signedIn, startSite, tokenOf } from './site.js';
import { now, setNow } from '../src/core/clock.js';
import { ensureSubscription, listPrice, payMonth, planFor, planOut, PLANS, plansOf } from '../src/accounts/subscriptions.js';
import { entitlement } from '../src/accounts/entitlement.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';
import { startProduct } from './setup-fake.js';

// Teder's two plans (full: 790 ₪, 1,490 ₪ setup, 40 slideshows, 10 redos; small: 490 ₪, 990 ₪ setup, 15 and 4), from
// the sign-up form to GET /internal/entitlement, the pages, the emails and the console; the 14 days of grace after a
// paid period ends (ACC-01) as the customer's pages show them; and the console's payment button, which records one
// month however often it is pressed and tells the owners (ACC-03).

const T0 = '2026-10-22T10:00:00.000Z';
const ADMIN = 'admin@example.com';
const PASSWORD = 'a long enough password';

async function setup({ env = {}, ws = true } = {}) {
  const h = tempHome();
  setNow(T0);
  const teder = await startProduct('teder');
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: ADMIN, password: PASSWORD, totpSecret: secret });
  const w = ws ? makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner', 'dan@example.com': 'client_owner' } }) : null;
  if (w) ensureSubscription(h.db, w.id, 'teder');
  const site = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder', OF_TEDER_INTERNAL: teder.url, TEDER_URL: 'https://teder.openfrequency.co.il/', OF_SUPPORT_WA: '972500000100', ...env } });
  const admin = site.browser({ ip: '192.0.2.1' });
  await admin.get('/admin/login');
  await admin.post('/admin/login', { email: ADMIN, password: PASSWORD, code: totpCode(secret, stepAt(now())) });
  await admin.get('/admin/accounts');
  const noa = h.db.get("SELECT * FROM users WHERE email = 'noa@example.com'");
  return { ...h, ...site, ws: w, noa, admin, teder, done: async () => (await site.close(), await teder.close(), h.cleanup()) };
}

const sub = (db, id) => db.get("SELECT * FROM subscriptions WHERE workspace_id = ? AND product = 'teder'", id);

test('the plans: what each gives and costs, the full one by default, and a product without plans has none', () => {
  assert.deepEqual(PLANS.teder, { full: { monthly: 790, setup: 1490, slideshows: 40, redos: 10 }, small: { monthly: 490, setup: 990, slideshows: 15, redos: 4 } });
  assert.deepEqual(plansOf('teder'), ['full', 'small']);
  assert.deepEqual(plansOf('toran'), []);
  assert.equal(planFor('teder', 'small'), 'small');
  assert.equal(planFor('teder', 'huge'), 'full');
  assert.equal(planFor('teder', null), 'full');
  assert.equal(planFor('toran', 'small'), null);
  assert.deepEqual(planOut('teder', 'small'), { name: 'small', slideshows: 15, redos: 4 });
  assert.deepEqual(listPrice('teder', 'small'), { monthly: 490, setup: 990, vat: 'excluded' });
  assert.deepEqual(listPrice('toran'), { monthly: 590, setup: 990, vat: 'excluded' });
});

test('a sign-up for the small plan: its price and setup fee, 15 slideshows and 4 redos to Teder, and the plan on every page and email', async () => {
  const t = await setup({ ws: false, env: { OF_PAYMENT_METHOD: 'העברה בנקאית או ביט' } });
  try {
    const b = t.browser();
    await b.get('/signup?p=teder&plan=small');
    const r = await b.post('/signup', { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa@example.com', products: ['teder'], plan: 'small', terms: '1', website: '', via: 'email' });
    assert.equal(r.status, 200);
    const confirm = await b.get(pathOf(t.mails[0].link));
    assert.match(confirm.body, /המוצרים שבחרתם: תדר, החבילה הקטנה\./);
    await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) });
    const ws = t.db.get('SELECT * FROM workspaces');
    const s = sub(t.db, ws.id);
    assert.deepEqual([s.plan, s.monthly, s.setup, s.vat, s.paid_until], ['small', 490, 990, 'excluded', null]);

    // What Teder reads: the plan's month, for the whole workspace.
    assert.deepEqual(entitlement(t.db, ws.id, 'teder').plan, { name: 'small', slideshows: 15, redos: 4 });
    const ent = await t.owners('GET', `/internal/entitlement?workspace=${ws.id}&product=teder`);
    assert.deepEqual(ent.json.plan, { name: 'small', slideshows: 15, redos: 4 });

    // The welcome email: the plan and its price, and how payment works today.
    const welcome = t.mails.find((m) => m.subject === 'החשבון של Noa Ceramics נפתח');
    assert.match(welcome.text, /תדר, החבילה הקטנה: 490 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת\./);
    assert.match(welcome.text, /איך משלמים: העברה בנקאית או ביט/);

    // /setup: the payment step with the plan and the way to pay.
    const setup_ = (await b.get('/setup')).body;
    assert.match(setup_, /<li>תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 990 ₪ פעם אחת<\/li>/);
    assert.match(setup_, /<p>איך משלמים: העברה בנקאית או ביט<\/p>/);
    // The home page: the plan and what it gives.
    assert.match((await b.get('/')).body, /החבילה הקטנה: 15 מצגות בחודש, ו-4 החלפות למצגות שדחיתם/);

    // A plan that does not exist is refused, and nothing is kept.
    const c = t.browser({ ip: '203.0.113.99' });
    await c.get('/signup');
    const bad = await c.post('/signup', { name: 'Gal', business: 'Gal Shop', email: 'gal@example.com', products: ['teder'], plan: 'huge', terms: '1', website: '', via: 'email' });
    assert.equal(bad.status, 400);
    assert.match(bad.body, /צריך לבחור אחת מהחבילות של תדר\./);
  } finally {
    await t.done();
  }
});

test('the console changes the plan: a price still at the old list price moves to the new one, a price agreed by hand stays', async () => {
  const t = await setup();
  try {
    const page = (await t.admin.get('/admin/accounts')).body;
    assert.match(page, /<select name="plan"><option value="full" selected>החבילה המלאה \(40\)<\/option><option value="small">החבילה הקטנה \(15\)<\/option><\/select>/);
    const save = (fields) => t.admin.post(`/admin/workspaces/${t.ws.id}/subscription`, { product: 'teder', vat: 'excluded', started_on: '2026-10-22', paid_until: '', ends_on: '', ...fields });
    assert.equal((await save({ plan: 'small', monthly: '790', setup: '1490' })).status, 303);
    assert.deepEqual([sub(t.db, t.ws.id).plan, sub(t.db, t.ws.id).monthly, sub(t.db, t.ws.id).setup], ['small', 490, 990]);
    assert.deepEqual(entitlement(t.db, t.ws.id, 'teder').plan, { name: 'small', slideshows: 15, redos: 4 });
    // Back to full with a price agreed by hand: the plan moves, the price stays.
    await save({ plan: 'full', monthly: '650', setup: '990' });
    assert.deepEqual([sub(t.db, t.ws.id).plan, sub(t.db, t.ws.id).monthly, sub(t.db, t.ws.id).setup], ['full', 650, 1490]);
    // No plan in the form keeps the one there; one that does not exist is refused.
    await save({ monthly: '650', setup: '1490' });
    assert.equal(sub(t.db, t.ws.id).plan, 'full');
    const bad = await save({ plan: 'huge', monthly: '650', setup: '1490' });
    assert.equal(bad.status, 400);
    assert.match(bad.body, /החבילה הזאת לא קיימת\./);
  } finally {
    await t.done();
  }
});

test('the payment button records one month however often it is pressed, and each owner hears it came', async () => {
  const t = await setup();
  try {
    let page = (await t.admin.get('/admin/accounts')).body;
    assert.match(page, /<input type="hidden" name="expect" value="">/);
    const press = () => t.admin.post(`/admin/workspaces/${t.ws.id}/subscription/pay`, { product: 'teder', expect: '' });
    assert.equal((await press()).status, 303);
    assert.equal(sub(t.db, t.ws.id).paid_until, '2026-11-21');
    // The same button again (a double press, or the page left open): nothing more is recorded.
    const again = await press();
    assert.equal(again.status, 400);
    assert.match(again.body, /התשלום הזה כבר נרשם/);
    assert.equal(sub(t.db, t.ws.id).paid_until, '2026-11-21');
    // From the page as it is now, the next month.
    page = (await t.admin.get('/admin/accounts')).body;
    assert.match(page, /<input type="hidden" name="expect" value="2026-11-21">/);
    await t.admin.post(`/admin/workspaces/${t.ws.id}/subscription/pay`, { product: 'teder', expect: '2026-11-21' });
    assert.equal(sub(t.db, t.ws.id).paid_until, '2026-12-21');
    // Both owners, once for each payment.
    const paid = t.mails.filter((m) => m.subject === 'קיבלנו את התשלום על תדר');
    assert.deepEqual(paid.map((m) => m.to).sort(), ['dan@example.com', 'dan@example.com', 'noa@example.com', 'noa@example.com']);
    assert.match(paid[0].text, /קיבלנו את התשלום על תדר בחשבון של Noa Shop\. המנוי שולם עד 21\.11\.2026\./);
    // payMonth without `expect` (a script) records as before.
    assert.equal(payMonth(t.db, t.ws.id, 'teder', { by: null }), '2027-01-21');
  } finally {
    await t.done();
  }
});

test('the grace on the pages: due, it still opens and asks to pay, with the day it stops; past it, closed until paid', async () => {
  const t = await setup();
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: null }); // paid until 21.11.2026
    setNow('2026-11-25T10:00:00.000Z');
    let b = signedIn(t, t.db, t.noa);
    let home = (await b.get('/')).body;
    assert.match(home, /התשלום לחודש שהתחיל ב-22\.11\.2026 עוד לא הגיע אלינו\. המנוי ממשיך לעבוד עד 6\.12\.2026, ואם התשלום לא יגיע עד אז הוא ייעצר עד שישולם\./);
    assert.match(home, /<a class="button primary" href="https:\/\/teder\.openfrequency\.co\.il\/">כניסה לתדר<\/a><a class="button quiet" href="\/setup#setup-billing">להסדיר תשלום<\/a>/);
    // The payment step is not done while it is owed, and says until when it works.
    const setup_ = (await b.get('/setup')).body;
    assert.match(setup_, /<li>תדר, החבילה המלאה: התשלום על החודש הנוכחי עוד לא הגיע\. המנוי עובד עד 6\.12\.2026, ואחרי זה נעצר עד שישולם\.<\/li>/);
    assert.match(setup_, /<li class="step st-todo"><span class="chip">עוד לא<\/span><span class="what"><b>התשלום על המנוי<\/b>/);
    // The console: due, open, until the grace's last day.
    const admin = signedIn(t, t.db, t.db.get('SELECT * FROM users WHERE is_superadmin = 1'));
    assert.match((await admin.get('/admin/accounts')).body, /גישה: מחכה לתשלום, בתקופת החסד, פתוח, עד 6\.12\.2026/);

    setNow('2026-12-07T10:00:00.000Z');
    b = signedIn(t, t.db, t.noa);
    home = (await b.get('/')).body;
    assert.match(home, /התשלום לחודש שהתחיל ב-22\.11\.2026 לא הגיע, אז המנוי נעצר\. הוא ייפתח שוב כשהתשלום יגיע\./);
    assert.doesNotMatch(home, /כניסה לתדר/);
    assert.equal(entitlement(t.db, t.ws.id, 'teder').allowed, false);
  } finally {
    await t.done();
  }
});

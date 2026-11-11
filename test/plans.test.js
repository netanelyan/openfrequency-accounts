import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { pathOf, signedIn, startSite, tokenOf } from './site.js';
import { advance, now, setNow } from '../src/core/clock.js';
import { ensureSubscription, listPrice, payMonth, planFor, planOut, PLANS, plansOf } from '../src/accounts/subscriptions.js';
import { entitlement } from '../src/accounts/entitlement.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';
import { startProduct } from './setup-fake.js';

// Teder's two plans (full: 790 ₪, 1,490 ₪ setup, 40 slideshows, 10 redos; small: 490 ₪, 990 ₪ setup, 15 and 4), from
// the sign-up form to GET /internal/entitlement, the pages, the emails and the console; the 72 hours of grace after a
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

test('the plans: what each gives and costs, the default when none is named (Teder full, Toran store)', () => {
  assert.deepEqual(PLANS.teder, { full: { monthly: 790, setup: 1490, slideshows: 40, redos: 10 }, small: { monthly: 490, setup: 990, slideshows: 15, redos: 4 } });
  assert.deepEqual(plansOf('teder'), ['full', 'small']);
  assert.deepEqual(PLANS.toran, { store: { monthly: 590, setup: 990, conversations: 300 }, big: { monthly: 1190, setup: 990, conversations: 1500 } });
  assert.deepEqual(plansOf('toran'), ['store', 'big']);
  assert.equal(planFor('teder', 'small'), 'small');
  assert.equal(planFor('teder', 'huge'), 'full');
  assert.equal(planFor('teder', null), 'full');
  assert.equal(planFor('toran', 'small'), 'store', 'a Teder name is not a Toran plan');
  assert.equal(planFor('toran', 'big'), 'big');
  assert.deepEqual(planOut('toran', 'big'), { name: 'big', conversations: 1500 });
  assert.deepEqual(listPrice('toran', 'big'), { monthly: 1190, setup: 990, vat: 'excluded' });
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
    assert.match(confirm.body, /<ul class="prices picked"><li>תדר, החבילה הקטנה<\/li><\/ul>/);
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

test("a sign-up for Toran's big plan: the website's button chooses it, 1,190 ₪ and 1,500 conversations to Toran, and the plan in the email and on the invoice line", async () => {
  const toran = await startProduct('toran');
  const t = await setup({ ws: false, env: { OF_SIGNUP_PRODUCTS: 'teder,toran', OF_TORAN_INTERNAL: toran.url, TORAN_URL: 'https://toran.openfrequency.co.il/' } });
  try {
    const b = t.browser();
    // The website's card under the big plan: signup?p=toran&plan=big starts Toran ticked with the big plan chosen.
    const form = (await b.get('/signup?p=toran&plan=big')).body;
    assert.match(form, /<input type="radio" name="plan_toran" value="big" checked>/);
    assert.match(form, /עד 1,500 שיחות בחודש/);
    assert.match(form, /איזו חבילה של תורן/);
    const r = await b.post('/signup', { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa@example.com', products: ['toran'], plan_toran: 'big', terms: '1', website: '', via: 'email' });
    assert.equal(r.status, 200);
    await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) });
    const ws = t.db.get('SELECT * FROM workspaces');
    const s = t.db.get("SELECT * FROM subscriptions WHERE workspace_id = ? AND product = 'toran'", ws.id);
    assert.deepEqual([s.plan, s.monthly, s.setup, s.vat], ['big', 1190, 990, 'excluded']);
    assert.deepEqual(entitlement(t.db, ws.id, 'toran').plan, { name: 'big', conversations: 1500 });
    const welcome = t.mails.find((m) => m.subject === 'החשבון של Noa Ceramics נפתח');
    assert.match(welcome.text, /תורן, חנות גדולה: 1,190 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת\./);
    // A Toran plan that does not exist is refused.
    const c = t.browser({ ip: '203.0.113.98' });
    await c.get('/signup');
    const bad = await c.post('/signup', { name: 'Dan Cohen', business: 'Dan Shop', email: 'dan2@example.com', products: ['toran'], plan_toran: 'small', terms: '1', website: '', via: 'email' });
    assert.equal(bad.status, 400);
    // In Toran's own words (the audit of 2026-11-11: it said "של תדר"), beside the products it is about.
    assert.match(bad.body, /<\/fieldset>\n<p class="error" id="su-err" role="alert">צריך לבחור אחת מהחבילות של תורן\.<\/p>/);
  } finally {
    await t.done();
    await toran.close();
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
    // The same button again (a double press, or the page left open): nothing more is recorded, and the console says
    // so at the top (test/pay-once.test.js has the button's one-time token and the 60 seconds).
    const again = await press();
    assert.deepEqual([again.status, again.headers.location], [303, '/admin/accounts']);
    assert.match((await t.admin.get('/admin/accounts')).body, /<p class="flash" role="status">התשלום כבר נרשם\. Noa Shop: תדר שולם עד 21\.11\.2026\.<\/p>/);
    assert.equal(sub(t.db, t.ws.id).paid_until, '2026-11-21');
    // From the page as it is now, the next month.
    page = (await t.admin.get('/admin/accounts')).body;
    assert.match(page, /<input type="hidden" name="expect" value="2026-11-21">/);
    await t.admin.post(`/admin/workspaces/${t.ws.id}/subscription/pay`, { product: 'teder', expect: '2026-11-21' });
    assert.equal(sub(t.db, t.ws.id).paid_until, '2026-12-21');
    // Both owners, once for each payment: the first opened Teder, the second paid the next month while it was open
    // (test/paid-email.test.js).
    const opened = t.mails.filter((m) => m.subject === 'תדר פתוח. אפשר להתחיל');
    const paid = t.mails.filter((m) => m.subject === 'קיבלנו את התשלום על תדר');
    assert.deepEqual([...opened, ...paid].map((m) => m.to).sort(), ['dan@example.com', 'dan@example.com', 'noa@example.com', 'noa@example.com']);
    assert.deepEqual([opened.length, paid.length], [2, 2]);
    assert.match(opened[0].text, /קיבלנו את התשלום על תדר בחשבון של Noa Shop\. המנוי שולם עד 21\.11\.2026\./);
    assert.match(paid[0].text, /תדר ממשיך לעבוד כרגיל\.\n\nקיבלנו את התשלום על תדר בחשבון של Noa Shop\. המנוי שולם עד 21\.12\.2026\./);
    // payMonth without `expect` or a form's token (a script): not within 60 seconds of the last month; a minute on, it
    // records.
    assert.throws(() => payMonth(t.db, t.ws.id, 'teder', { by: null }), (e) => e.code === 'already_paid');
    advance(60_000);
    assert.equal(payMonth(t.db, t.ws.id, 'teder', { by: null }), '2027-01-21');
  } finally {
    await t.done();
  }
});

test('the grace on the pages: due, it still opens and asks to pay, with the day it stops; past it, closed until paid', async () => {
  const t = await setup();
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: null }); // paid until 21.11.2026
    // Before the week it falls due in: paid until that day, and the payment step done.
    setNow('2026-11-14T10:00:00.000Z');
    let b = signedIn(t, t.db, t.noa);
    let before = (await b.get('/setup')).body;
    assert.match(before, /<li>תדר, החבילה המלאה: שולם עד 21\.11\.2026<\/li>/);
    assert.match(before, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>המנוי שולם\.<\/small>/);
    assert.doesNotMatch(before, /נעצר עד שישולם/);
    // On the paid month's last day: still done, and the next month can be paid already (test/pay-site.test.js).
    setNow('2026-11-21T10:00:00.000Z');
    b = signedIn(t, t.db, t.noa);
    before = (await b.get('/setup')).body;
    assert.match(before, /<li>תדר, החבילה המלאה: 790 ₪ לחודש, לא כולל מע״מ, על החודש שמתחיל ב-22\.11\.2026<\/li>/);
    assert.match(before, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>המנוי שולם\. אפשר כבר לשלם על החודש הבא\.<\/small>/);
    assert.doesNotMatch(before, /נעצר עד שישולם/);

    setNow('2026-11-23T10:00:00.000Z'); // the second of the 72 hours' 3 days
    b = signedIn(t, t.db, t.noa);
    let home = (await b.get('/')).body;
    assert.match(home, /התשלום לחודש שהתחיל ב-22\.11\.2026 עוד לא הגיע אלינו\. המנוי ממשיך לעבוד עד סוף יום שלישי, 24\.11\.2026, ואם התשלום לא יגיע עד אז הוא ייעצר עד שישולם\./);
    // It still opens, and the payment is the page's one blue, the setup card's (the owner, 2026-11-06).
    assert.match(home, /<a class="button quiet" href="https:\/\/teder\.openfrequency\.co\.il\/">כניסה לתדר<\/a><a class="button quiet" href="\/setup#setup-billing">להסדיר תשלום<\/a>/);
    assert.match(home, /<a class="button primary" href="\/setup">להמשך ההגדרה<\/a>/);
    // The payment step is not done while it is owed, and says until when it works.
    const setup_ = (await b.get('/setup')).body;
    assert.match(setup_, /<li>תדר, החבילה המלאה: התשלום על החודש החדש עוד לא הגיע\. המנוי עובד עד סוף יום שלישי, 24\.11\.2026, ואחרי זה נעצר עד שישולם\.<\/li>/);
    // Its step is not done, and its button is how to pay (here, our WhatsApp: OF_SUPPORT_WA without payment details).
    assert.match(setup_, /<li class="step st-todo"><span class="chip">עוד לא<\/span><span class="what"><b>התשלום על המנוי<\/b><small>[^<]*<\/small><\/span><a class="button [a-z]+" href="https:\/\/wa\.me\/972500000100[^"]*">כתבו לנו בוואטסאפ<\/a><\/li>/);
    // The console: due, open, until the grace's last day.
    const admin = signedIn(t, t.db, t.db.get('SELECT * FROM users WHERE is_superadmin = 1'));
    assert.match((await admin.get('/admin/accounts')).body, /גישה: מחכה לתשלום, בתקופת החסד, פתוח, עד 24\.11\.2026/);

    setNow('2026-11-25T10:00:00.000Z'); // the 72 hours are over
    b = signedIn(t, t.db, t.noa);
    home = (await b.get('/')).body;
    assert.match(home, /התשלום לחודש שהתחיל ב-22\.11\.2026 לא הגיע, אז המנוי נעצר\. הוא ייפתח שוב כשהתשלום יגיע\./);
    assert.doesNotMatch(home, /כניסה לתדר/);
    assert.equal(entitlement(t.db, t.ws.id, 'teder').allowed, false);
  } finally {
    await t.done();
  }
});

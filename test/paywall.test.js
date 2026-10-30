import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite, tokenOf } from './site.js';
import { now, setNow } from '../src/core/clock.js';
import { Db } from '../src/db/index.js';
import { MIGRATIONS } from '../src/db/schema.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { openWorkspace, setProduct } from '../src/accounts/workspaces.js';
import { accessOf, endOfIsraelDay, entitlement } from '../src/accounts/entitlement.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';
import { startProduct } from './setup-fake.js';

// The paywall: GET /internal/entitlement in each of its states and the moves between them (paid, complimentary,
// unpaid, cancelled, off), the migration that keeps every workspace made before it working, the console's comp and
// payment, what the customer's pages show while a product is not paid for, cancelling online and taking it back, and
// the welcome email after a sign-up.

const T0 = '2026-10-22T10:00:00.000Z'; // 12:00 in Israel, 22.10.2026
const ADMIN = 'admin@example.com';
const PASSWORD = 'a long enough password';
const NOTIFY_TO = 'boss@example.com';

async function setup({ env = {}, products = ['teder'], comp = false, members = { 'noa@example.com': 'client_owner' } } = {}) {
  const h = tempHome();
  setNow(T0);
  const teder = await startProduct('teder');
  const toran = await startProduct('toran');
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: ADMIN, password: PASSWORD, totpSecret: secret });
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products, comp, members });
  for (const p of products) ensureSubscription(h.db, ws.id, p);
  const site = await startSite(h.db, {
    env: { OF_TEDER_INTERNAL: teder.url, OF_TORAN_INTERNAL: toran.url, TEDER_URL: 'https://teder.openfrequency.co.il/', TORAN_URL: 'https://toran.openfrequency.co.il/', OF_SIGNUP_NOTIFY: NOTIFY_TO, ...env },
  });
  const admin = site.browser({ ip: '192.0.2.1' });
  await admin.get('/admin/login');
  await admin.post('/admin/login', { email: ADMIN, password: PASSWORD, code: totpCode(secret, stepAt(now())) });
  await admin.get('/admin/accounts');
  const noa = h.db.get("SELECT * FROM users WHERE email = 'noa@example.com'");
  const ent = (product = 'teder', id = ws.id) => site.owners('GET', `/internal/entitlement?workspace=${id}&product=${product}`);
  return {
    ...h,
    ...site,
    ws,
    noa,
    admin,
    teder,
    toran,
    ent,
    done: async () => {
      await site.close();
      await teder.close();
      await toran.close();
      h.cleanup();
    },
  };
}

const END_21_11 = '2026-11-21T21:59:59.999Z'; // the end of 21.11.2026 in Israel (UTC+2 in November)

test('the migration marks every workspace that exists before it complimentary, for the products it has on; nothing made after it is', () => {
  const h = tempHome();
  try {
    // A database as it is on the server today: six migrations, two workspaces set up by hand.
    const file = path.join(h.home, 'data', 'before-paywall.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA foreign_keys = ON;');
    for (const m of MIGRATIONS.slice(0, 6)) raw.exec(m);
    raw.exec('PRAGMA user_version = 6');
    raw.exec(`
      INSERT INTO workspaces (id, slug, name, created_at) VALUES (1, 'owner', 'The owner', '2026-01-01T00:00:00.000Z'), (2, 'shop', 'A shop', '2026-02-01T00:00:00.000Z');
      INSERT INTO workspace_products (workspace_id, product, enabled, updated_at) VALUES
        (1, 'teder', 1, '2026-01-01T00:00:00.000Z'), (1, 'toran', 1, '2026-01-01T00:00:00.000Z'),
        (2, 'teder', 1, '2026-02-01T00:00:00.000Z'), (2, 'toran', 0, '2026-02-01T00:00:00.000Z');
      INSERT INTO subscriptions (workspace_id, product, monthly, vat, setup, started_on, updated_at) VALUES (2, 'teder', 790, 'excluded', 1490, '2026-02-01', '2026-02-01T00:00:00.000Z');
    `);
    raw.close();

    const db = new Db(file);
    try {
      assert.equal(db.get('PRAGMA user_version').user_version, MIGRATIONS.length);
      const comp = db.all('SELECT workspace_id, product, comp FROM workspace_products ORDER BY workspace_id, product').map((r) => [r.workspace_id, r.product, r.comp]);
      assert.deepEqual(comp, [[1, 'teder', 1], [1, 'toran', 1], [2, 'teder', 1], [2, 'toran', 0]]);
      // Nothing that works today stops: unpaid, and still open.
      assert.deepEqual(entitlement(db, 2, 'teder', '2026-10-22'), { workspace: 2, product: 'teder', enabled: true, access: 'comp', allowed: true, paidThrough: null, cancelAt: null, graceUntil: null, plan: { name: 'full', slideshows: 40, redos: 10 } });
      assert.equal(entitlement(db, 1, 'toran', '2026-10-22').allowed, true);
      assert.equal(entitlement(db, 2, 'toran', '2026-10-22').access, 'off');
      // A product turned on later, and a workspace opened later, are not complimentary.
      setProduct(db, 2, 'toran', true, { by: null });
      assert.deepEqual([entitlement(db, 2, 'toran').access, entitlement(db, 2, 'toran').allowed], ['unpaid', false]);
      const fresh = openWorkspace(db, { name: 'New', slug: 'new-shop', products: ['teder'] }, { by: null });
      assert.deepEqual([entitlement(db, fresh.id, 'teder').access, entitlement(db, fresh.id, 'teder').allowed], ['unpaid', false]);
    } finally {
      db.close();
    }
  } finally {
    h.cleanup();
  }
});

test('access from the rows: every state, and the days at their edges', () => {
  const on = { enabled: true };
  const none = { lastDay: null, graceUntil: null };
  assert.deepEqual(accessOf({ enabled: false, comp: true }, '2026-10-22'), { access: 'off', allowed: false, paidUntil: null, ...none });
  assert.deepEqual(accessOf({ ...on, comp: true }, '2026-10-22'), { access: 'comp', allowed: true, paidUntil: null, ...none });
  assert.deepEqual(accessOf(on, '2026-10-22'), { access: 'unpaid', allowed: false, paidUntil: null, ...none });
  // Paid through its last day; then due, still open, for the 14 days of grace from the day it fell due (ACC-01); then
  // unpaid and closed.
  assert.deepEqual(accessOf({ ...on, paidUntil: '2026-11-21' }, '2026-11-21'), { access: 'paid', allowed: true, paidUntil: '2026-11-21', ...none });
  assert.deepEqual(accessOf({ ...on, paidUntil: '2026-11-21' }, '2026-11-22'), { access: 'due', allowed: true, paidUntil: '2026-11-21', lastDay: null, graceUntil: '2026-12-06' });
  assert.deepEqual(accessOf({ ...on, paidUntil: '2026-11-21' }, '2026-12-06').access, 'due');
  assert.deepEqual(accessOf({ ...on, paidUntil: '2026-11-21' }, '2026-12-07'), { access: 'unpaid', allowed: false, paidUntil: '2026-11-21', ...none });
  // Cancelled: open until the last day paid for, then closed, with no grace; cancelled with nothing paid, closed.
  const cancelled = { ...on, paidUntil: '2026-11-21', endsOn: '2026-11-21', cancelledAt: T0 };
  assert.deepEqual(accessOf(cancelled, '2026-11-21'), { access: 'cancelled', allowed: true, paidUntil: '2026-11-21', lastDay: '2026-11-21', graceUntil: null });
  assert.deepEqual(accessOf(cancelled, '2026-11-22').allowed, false);
  assert.deepEqual(accessOf({ ...on, endsOn: '2026-10-22', cancelledAt: T0 }, '2026-10-22'), { access: 'cancelled', allowed: false, paidUntil: null, lastDay: '2026-10-22', graceUntil: null });
  // A last day the superadmin set before the paid one ends it first.
  assert.equal(accessOf({ ...on, paidUntil: '2026-11-21', endsOn: '2026-11-10' }, '2026-11-11').allowed, false);
  // Complimentary wins over everything but off.
  assert.equal(accessOf({ ...cancelled, comp: true }, '2027-01-01').access, 'comp');

  // The end of an Israel day, in UTC: winter (+2), summer (+3), and the night the clocks go back (25.10.2026).
  assert.equal(endOfIsraelDay('2026-11-21'), END_21_11);
  assert.equal(endOfIsraelDay('2026-07-01'), '2026-07-01T20:59:59.999Z');
  assert.equal(endOfIsraelDay('2026-10-24'), '2026-10-24T20:59:59.999Z');
  assert.equal(endOfIsraelDay('2026-10-25'), '2026-10-25T21:59:59.999Z');
});

test('GET /internal/entitlement: the documented shape, each state as the console moves it, and what it refuses', async () => {
  const t = await setup();
  try {
    let r = await t.ent();
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(r.json, { workspace: t.ws.id, product: 'teder', enabled: true, access: 'unpaid', allowed: false, paidThrough: null, cancelAt: null, graceUntil: null, plan: { name: 'full', slideshows: 40, redos: 10 } });
    // Toran has no plans: no plan in its answer.
    assert.deepEqual((await t.ent('toran')).json, { workspace: t.ws.id, product: 'toran', enabled: false, access: 'off', allowed: false, paidThrough: null, cancelAt: null, graceUntil: null });

    // The console: each product's access, and a month's payment recorded.
    let page = (await t.admin.get('/admin/accounts')).body;
    assert.match(page, /גישה: לא שולם, סגור/);
    await t.admin.post(`/admin/workspaces/${t.ws.id}/subscription/pay`, { product: 'teder' });
    r = await t.ent();
    assert.deepEqual(r.json, { workspace: t.ws.id, product: 'teder', enabled: true, access: 'paid', allowed: true, paidThrough: END_21_11, cancelAt: null, graceUntil: null, plan: { name: 'full', slideshows: 40, redos: 10 } });
    page = (await t.admin.get('/admin/accounts')).body;
    assert.match(page, /גישה: שולם, פתוח, עד 21\.11\.2026/);
    // A second payment extends it by a month; the date can also be set by hand.
    await t.admin.post(`/admin/workspaces/${t.ws.id}/subscription/pay`, { product: 'teder' });
    assert.equal((await t.ent()).json.paidThrough, endOfIsraelDay('2026-12-21'));
    await t.admin.post(`/admin/workspaces/${t.ws.id}/subscription`, { product: 'teder', monthly: '790', setup: '1490', vat: 'excluded', started_on: '2026-10-22', paid_until: '2026-11-21', ends_on: '' });
    assert.equal((await t.ent()).json.paidThrough, END_21_11);

    // Complimentary, from the console, and back.
    await t.admin.post(`/admin/workspaces/${t.ws.id}/comp`, { product: 'teder', comp: '1' });
    assert.deepEqual([(await t.ent()).json.access, (await t.ent()).json.allowed], ['comp', true]);
    assert.match((await t.admin.get('/admin/accounts')).body, /תדר ב-Noa Shop מסומן ללא תשלום\.[^]*גישה: ללא תשלום, פתוח[^]*לבטל את הפטור מתשלום/);
    await t.admin.post(`/admin/workspaces/${t.ws.id}/comp`, { product: 'teder', comp: '0' });
    assert.equal((await t.ent()).json.access, 'paid');
    // A product that is not on cannot be complimentary.
    const refused = await t.admin.post(`/admin/workspaces/${t.ws.id}/comp`, { product: 'toran', comp: '1' });
    assert.equal(refused.status, 400);
    assert.match(refused.body, /המוצר הזה לא פעיל בחשבון\./);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'comp_set'") && t.db.get("SELECT 1 FROM audit WHERE action = 'comp_cleared'"));

    // A disabled workspace is off, whatever it paid.
    await t.admin.post(`/admin/workspaces/${t.ws.id}/comp`, { product: 'teder', comp: '1' });
    await t.admin.post(`/admin/workspaces/${t.ws.id}/disable`);
    assert.deepEqual([(await t.ent()).json.access, (await t.ent()).json.enabled, (await t.ent()).json.allowed], ['off', false, false]);
    await t.admin.post(`/admin/workspaces/${t.ws.id}/enable`);
    assert.equal((await t.ent()).json.access, 'comp');

    // What it refuses: a bad workspace or product (400), one that does not exist (404), no token (401), POST (405).
    for (const q of ['workspace=abc&product=teder', 'workspace=0&product=teder', 'workspace=1.5&product=teder', 'product=teder', `workspace=${t.ws.id}&product=other`, `workspace=${t.ws.id}`]) {
      const bad = await t.owners('GET', `/internal/entitlement?${q}`);
      assert.equal(bad.status, 400, q);
      assert.match(bad.json.error, /^bad_(workspace|product)$/, q);
    }
    assert.deepEqual((await t.ent('teder', 999)).json, { error: 'no_workspace' });
    assert.equal((await t.ent('teder', 999)).status, 404);
    assert.equal((await t.owners('GET', `/internal/entitlement?workspace=${t.ws.id}&product=teder`, null, { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await t.owners('POST', `/internal/entitlement?workspace=${t.ws.id}&product=teder`, {})).status, 405);

    // Past the last day paid for: due, and still allowed, until the grace is over; then unpaid.
    await t.admin.post(`/admin/workspaces/${t.ws.id}/comp`, { product: 'teder', comp: '0' });
    setNow('2026-11-22T10:00:00.000Z');
    const due = (await t.ent()).json;
    assert.deepEqual([due.access, due.allowed, due.paidThrough, due.graceUntil], ['due', true, END_21_11, endOfIsraelDay('2026-12-06')]);
    setNow('2026-12-07T10:00:00.000Z');
    assert.deepEqual([(await t.ent()).json.access, (await t.ent()).json.allowed, (await t.ent()).json.paidThrough, (await t.ent()).json.graceUntil], ['unpaid', false, END_21_11, null]);
  } finally {
    await t.done();
  }
});

test('the paywall on the pages: payment first and required, the steps locked, the home page asks to pay, and it all opens once paid', async () => {
  const t = await setup({ env: { OF_SUPPORT_WA: '972500000100' } });
  try {
    const b = signedIn(t, t.db, t.noa);
    // Signed in: they land on /setup while it is not paid.
    assert.equal((await b.get('/login')).headers.location, '/setup');
    let page = (await b.get('/setup')).body;
    const billing = page.slice(page.indexOf('id="setup-billing"'), page.indexOf('id="setup-teder"'));
    assert.ok(page.indexOf('id="setup-billing"') < page.indexOf('id="setup-teder"'), 'payment first');
    // Manual payment (OF_PAYMENT unset): we email the details, Teder opens once the payment reaches us, and the button
    // (quiet: nothing to start here) reaches us on WhatsApp for questions, with the words written.
    assert.match(billing, /<li class="step st-todo"><span class="chip">עוד לא<\/span><span class="what"><b>התשלום על המנוי<\/b><small>את פרטי התשלום אנחנו שולחים לכם במייל\. תדר נפתח אחרי שהתשלום מגיע אלינו\.<\/small><\/span><a class="button quiet" href="https:\/\/wa\.me\/972500000100\?text=[^"]+">כתבו לנו בוואטסאפ<\/a><\/li>/);
    assert.ok(billing.includes(encodeURIComponent('היי, כותבים מ״Noa Shop״. יש לנו שאלה על התשלום.')));
    assert.doesNotMatch(billing, /בקרוב|ונשלח לכם פרטים/);
    // The price: the subscription's, before VAT, with the setup fee until the first payment.
    assert.match(billing, /<li>תדר, החבילה המלאה: 790 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 1,490 ₪ פעם אחת<\/li>/);
    assert.match(billing, /<p class="muted">יש שאלה על התשלום\? כתבו לנו בוואטסאפ, או ענו לאחד המיילים שקיבלתם מאיתנו\.<\/p>/);
    // Teder's steps are there, locked: no button into Teder, "אחרי התשלום", a done step still done.
    const teder = page.slice(page.indexOf('id="setup-teder"'));
    assert.match(page, /<section class="card setup-p locked" id="setup-teder">[^]*<span class="tag off">נפתח אחרי התשלום<\/span>/);
    assert.match(teder, /הצעדים של תדר נפתחים אחרי התשלום\./);
    assert.match(teder, /<li class="step st-locked"><span class="chip">אחרי התשלום<\/span><span class="what"><b>לבדוק את התשובה הראשונה<\/b>/);
    assert.match(teder, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>לחבר את חשבון האינסטגרם<\/b>/);
    assert.doesNotMatch(teder, /href="https:\/\/teder\.openfrequency\.co\.il\/first"/);
    // The home page: the setup card, and the product's button leads to the payment.
    let home = (await b.get('/')).body;
    assert.match(home, /<section class="card setup-card">/);
    assert.match(home, /<span class="tag">עוד לא שולם<\/span>/);
    assert.match(home, /<a class="button primary" href="\/setup#setup-billing">להסדיר תשלום<\/a>/);
    assert.doesNotMatch(home, /כניסה לתדר/);

    // The payment is recorded on /admin: open.
    payMonth(t.db, t.ws.id, 'teder', { by: null });
    page = (await b.get('/setup')).body;
    assert.match(page, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>המנוי שולם\.<\/small>/);
    assert.match(page, /<li>תדר, החבילה המלאה: שולם עד 21\.11\.2026<\/li>/);
    assert.match(page, /<section class="card setup-p" id="setup-teder">/);
    assert.match(page, /<a class="button primary" href="https:\/\/teder\.openfrequency\.co\.il\/first"/);
    home = (await b.get('/')).body;
    assert.match(home, /<span class="tag">פעיל<\/span>/);
    assert.match(home, /כניסה לתדר/);
    assert.match(home, /שולם עד 21\.11\.2026/);
  } finally {
    await t.done();
  }
});

test('the account page: the next payment only with OF_PAYMENT=provider; a payment step that leads to its payment page or, in manual mode, to us', async () => {
  const t = await setup({ env: { OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'https://pay.example.com/of' } });
  try {
    const b = signedIn(t, t.db, t.noa);
    // Before paying: "לתשלום", the one blue button, opens the provider's payment page.
    const page = (await b.get('/setup')).body;
    assert.match(page, /<small>משלמים בכרטיס אשראי בדף התשלום\. תדר נפתח אחרי שהתשלום מאושר\.<\/small><\/span><a class="button primary" href="https:\/\/pay\.example\.com\/of">לתשלום<\/a>/);
    payMonth(t.db, t.ws.id, 'teder', { by: null });
    const home = (await b.get('/')).body;
    // The next payment, not a "charge": nothing is taken from a card by itself.
    assert.match(home, /התשלום הבא: 790 ₪ ועוד מע״מ, ב-22\.11\.2026/);
    assert.doesNotMatch(home, /החיוב הבא/);
    assert.match(home, /790 ₪ לחודש, לא כולל מע״מ/);
  } finally {
    await t.done();
  }
  // No OF_SUPPORT_WA: the website's contact page, never a dead end.
  const u = await setup();
  try {
    const page = (await signedIn(u, u.db, u.noa).get('/setup')).body;
    assert.match(page, /<a class="button quiet" href="https:\/\/openfrequency\.co\.il\/join">ליצירת קשר<\/a>/);
    assert.match(page, /<p class="muted">יש שאלה על התשלום\? ענו לאחד המיילים שקיבלתם מאיתנו\.<\/p>/);
  } finally {
    await u.done();
  }
});

test('/signup shows each product with its price, VAT excluded, and its setup fee', async () => {
  const t = await setup({ env: { OF_SIGNUP: '1' } });
  try {
    const page = (await t.browser().get('/signup')).body;
    // Teder: its two plans, each with what a month gives and its price; the full one chosen to start with.
    assert.match(page, /<input type="radio" name="plan" value="full" checked><span><b>החבילה המלאה<\/b><small>40 מצגות בחודש, ו-10 החלפות למצגות שדחיתם<\/small><small class="price">790 ₪ לחודש ועוד מע״מ, ודמי הקמה של 1,490 ₪ פעם אחת<\/small>/);
    assert.match(page, /<input type="radio" name="plan" value="small"><span><b>החבילה הקטנה<\/b><small>15 מצגות בחודש, ו-4 החלפות למצגות שדחיתם<\/small><small class="price">490 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת<\/small>/);
    // ?plan=small, from the website's button under that plan, starts it chosen.
    assert.match((await t.browser().get('/signup?p=teder&plan=small')).body, /value="small" checked/);
    assert.match(page, /<b>תורן<\/b><small>[^<]+<\/small><small class="price">590 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת<\/small>/);
    // How paying works (manual: OF_PAYMENT unset), and under the plans Teder's setup fee: one time, not refunded.
    assert.match(page, /<small>אחרי שהחשבון נפתח, נשלח לכם במייל את פרטי התשלום, והמוצרים נפתחים אחרי שהתשלום מגיע אלינו\. אפשר לבטל את המנוי מהדף הראשי, והוא עובד עד סוף התקופה ששולמה\.<\/small>/);
    assert.match(page, /<small>חל רק כשבוחרים בתדר\. אפשר לעבור חבילה אחר כך, בכתיבה אלינו\. דמי ההקמה לא מוחזרים, ומשלמים אותם פעם אחת, עם החודש הראשון\.<\/small><\/fieldset>/);
  } finally {
    await t.done();
  }
});

test('cancelling online: owners only, a confirmation page, it works until the last day paid for, emails, and the undo before that day', async () => {
  const t = await setup({ products: ['teder', 'toran'], members: { 'noa@example.com': 'client_owner', 'dana@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: null });
    let b = signedIn(t, t.db, t.noa);
    let home = (await b.get('/')).body;
    assert.match(home, /<a class="button quiet" href="\/subscription\/teder\/cancel" aria-label="לבטל את המנוי לתדר">לבטל את המנוי<\/a>/);
    // A member sees no button, and is refused.
    const ron = signedIn(t, t.db, t.db.get("SELECT * FROM users WHERE email = 'ron@example.com'"));
    assert.doesNotMatch((await ron.get('/')).body, /subscription\/teder\/cancel/);
    const no = await ron.get('/subscription/teder/cancel');
    assert.equal(no.status, 403);
    assert.match(no.body, /רק בעלי החשבון יכולים לבטל את המנוי\./);

    // The confirmation page says what happens, and nothing is cancelled by opening it.
    const confirm = await b.get('/subscription/teder/cancel');
    assert.equal(confirm.status, 200);
    assert.match(confirm.body, /ביטול המנוי לתדר/);
    assert.match(confirm.body, /אם תבטלו, תדר ימשיך לעבוד עד 21\.11\.2026, היום האחרון ששילמתם עליו\. אחרי זה הוא נעצר, ולא נחייב אתכם יותר\./);
    assert.match(confirm.body, /עד 21\.11\.2026 אפשר לחזור בכם מהדף הראשי/);
    assert.match(confirm.body, /<form method="post" action="\/subscription\/teder\/cancel" class="inline">/);
    assert.equal(t.db.get("SELECT cancelled_at FROM subscriptions WHERE product = 'teder'").cancelled_at, null);

    const done = await b.post('/subscription/teder/cancel', {});
    assert.equal(done.status, 303);
    assert.equal(done.headers.location, '/');
    const row = t.db.get("SELECT * FROM subscriptions WHERE workspace_id = ? AND product = 'teder'", t.ws.id);
    assert.deepEqual([row.cancelled_at, row.ends_on, row.paid_until], [T0, '2026-11-21', '2026-11-21']);
    assert.deepEqual((await t.ent()).json, { workspace: t.ws.id, product: 'teder', enabled: true, access: 'cancelled', allowed: true, paidThrough: END_21_11, cancelAt: END_21_11, graceUntil: null, plan: { name: 'full', slideshows: 40, redos: 10 } });
    // A confirmation to each owner (not the member), and a notice to OF_SIGNUP_NOTIFY.
    const confirmations = t.mails.filter((m) => m.subject === 'ביטלתם את המנוי לתדר');
    assert.deepEqual(confirmations.map((m) => m.to).sort(), ['dana@example.com', 'noa@example.com']);
    assert.match(confirmations[0].text, /תדר ימשיך לעבוד עד 21\.11\.2026, ואז ייעצר\. לא נחייב אתכם יותר\./);
    assert.match(confirmations[0].text, /התחרטתם\? עד 21\.11\.2026 אפשר להמשיך את המנוי מהדף הראשי/);
    const notice = t.mails.find((m) => m.to === NOTIFY_TO);
    assert.equal(notice.subject, 'ביטול מנוי: Noa Shop, תדר');
    assert.match(notice.text, /מי ביטל: noa@example\.com[^]*עובד עד: 21\.11\.2026/);

    // The home page says so, keeps the way in until then, and offers the undo.
    home = (await b.get('/')).body;
    assert.match(home, /ביטלנו את המנוי לתדר\. הוא עובד עד 21\.11\.2026, ושלחנו לכם אישור במייל\./);
    assert.match(home, /<span class="tag">בוטל<\/span>/);
    assert.match(home, /ביטלתם את המנוי\. הוא עובד עד 21\.11\.2026 ואז נעצר, ולא נחייב אתכם יותר\./);
    assert.match(home, /כניסה לתדר/);
    assert.match(home, /<form method="post" action="\/subscription\/teder\/resume" class="inline">/);
    const again = await b.get('/subscription/teder/cancel');
    assert.equal(again.status, 400);
    assert.match(again.body, /המנוי הזה כבר בוטל\./);

    // Taken back before the day: it goes on, and the owner hears of it.
    await b.get('/');
    assert.equal((await b.post('/subscription/teder/resume', {})).status, 303);
    assert.deepEqual(Object.values(t.db.get("SELECT cancelled_at, ends_on FROM subscriptions WHERE product = 'teder'")), [null, null]);
    assert.equal((await t.ent()).json.access, 'paid');
    assert.ok(t.mails.some((m) => m.to === NOTIFY_TO && m.subject === 'מנוי ממשיך: Noa Shop, תדר'));
    assert.match((await b.get('/')).body, /המנוי לתדר ממשיך כרגיל\./);

    // Cancelled again, and the day passes: closed, and too late to take back.
    await b.get('/subscription/teder/cancel');
    await b.post('/subscription/teder/cancel', {});
    setNow('2026-11-22T10:00:00.000Z');
    assert.deepEqual([(await t.ent()).json.access, (await t.ent()).json.allowed], ['cancelled', false]);
    // A month on, a fresh sign-in (the old one has been idle too long).
    b = signedIn(t, t.db, t.noa);
    home = (await b.get('/')).body;
    assert.match(home, /המנוי הסתיים ב-21\.11\.2026\./);
    assert.doesNotMatch(home, /subscription\/teder\/resume|כניסה לתדר/);
    await b.get('/');
    const late = await b.post('/subscription/teder/resume', {});
    assert.equal(late.status, 400);
    assert.match(late.body, /המנוי כבר הסתיים\. כדי לחדש אותו, כתבו לנו\./);

    // Toran, never paid for: the page says it stops today, and nothing is charged.
    const unpaid = await b.get('/subscription/toran/cancel');
    assert.match(unpaid.body, /עוד לא שילמתם על תורן, אז הביטול חל מהיום, ולא נחייב אתכם עליו\./);
    await b.post('/subscription/toran/cancel', {});
    assert.equal(t.db.get("SELECT ends_on FROM subscriptions WHERE product = 'toran'").ends_on, '2026-11-22');
    assert.deepEqual([(await t.ent('toran')).json.access, (await t.ent('toran')).json.allowed], ['cancelled', false]);
    assert.ok(t.mails.some((m) => m.subject === 'ביטלתם את המנוי לתורן' && /לא נחייב אתכם עליו\./.test(m.text)));
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'subscription_cancelled'") && t.db.get("SELECT 1 FROM audit WHERE action = 'subscription_resumed'"));
  } finally {
    await t.done();
  }
});

test('cancelling: nothing to cancel on a complimentary product, nothing from view-as, nothing signed out', async () => {
  const t = await setup({ comp: true });
  try {
    const b = signedIn(t, t.db, t.noa);
    const home = (await b.get('/')).body;
    assert.match(home, /<span class="tag">ללא תשלום<\/span>/);
    assert.match(home, /המנוי הזה אצלנו ללא תשלום\./);
    assert.doesNotMatch(home, /subscription\/teder\/cancel|790 ₪/);
    const r = await b.get('/subscription/teder/cancel');
    assert.equal(r.status, 400);
    assert.match(r.body, /המנוי הזה ללא תשלום, אז אין מה לבטל\./);
    await b.get('/');
    assert.equal((await b.post('/subscription/teder/cancel', {})).status, 400);
    assert.equal(t.db.get('SELECT cancelled_at FROM subscriptions').cancelled_at, null);
    // The superadmin, and someone signed out.
    assert.equal((await t.admin.get('/subscription/teder/cancel')).status, 403);
    assert.equal((await t.browser().get('/subscription/teder/cancel')).headers.location, '/login');
  } finally {
    await t.done();
  }
});

test('the welcome email, right after a sign-up is confirmed: pay, then set up, with the prices and a link to /setup', async () => {
  const t = await setup({ env: { OF_SIGNUP: '1', OF_SIGNUP_NOTIFY: '' } });
  try {
    const b = t.browser();
    await b.get('/signup');
    await b.post('/signup', { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa.c@example.com', products: ['teder', 'toran'], terms: '1', website: '', via: 'email' });
    assert.equal(t.mails.length, 1, 'the link only, before it is confirmed');
    await b.get(`/signup/confirm?t=${tokenOf(t.mails[0].link)}`);
    assert.equal((await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) })).headers.location, '/setup');
    const w = t.mails[1];
    assert.equal(w.to, 'noa.c@example.com');
    assert.equal(w.subject, 'החשבון של Noa Ceramics נפתח');
    assert.equal(w.link, 'https://accounts.openfrequency.co.il/setup');
    // Manual payment: we email the details to this address, and both open once the payment reaches us.
    assert.match(w.text, /קודם התשלום על המנוי\. את פרטי התשלום נשלח לכם במייל, לכתובת הזאת\. תדר ותורן נפתחים אחרי שהתשלום מגיע אלינו\./);
    assert.doesNotMatch(w.text, /בקרוב|ונשלח לכם פרטים/);
    // Teder's setup fee is not refunded, as its terms say; Toran's terms say it otherwise, so its line does not.
    assert.match(w.text, /תדר, החבילה המלאה: 790 ₪ לחודש ועוד מע״מ, ודמי הקמה של 1,490 ₪ פעם אחת\. דמי ההקמה לא מוחזרים\./);
    assert.match(w.text, /תורן: 590 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת\.\n/);
    // No OF_SUPPORT_WA here: questions are a reply.
    assert.match(w.text, /יש שאלה על התשלום\? ענו למייל הזה\./);
    assert.match(w.text, /אחר כך ההגדרה\./);
    assert.ok(w.text.indexOf('התשלום') < w.text.indexOf('ההגדרה'), 'pay first, then set up');
    assert.match(w.html, /<a href="https:\/\/accounts\.openfrequency\.co\.il\/setup"[^>]*>לדף ההגדרה<\/a>/);
    assert.equal(t.mails.length, 2);
    // A new sign-up is not complimentary: it lands behind the paywall.
    const ws = t.db.get("SELECT id FROM workspaces WHERE name = 'Noa Ceramics'");
    assert.deepEqual([(await t.ent('teder', ws.id)).json.access, (await t.ent('toran', ws.id)).json.allowed], ['unpaid', false]);
  } finally {
    await t.done();
  }
});

test('the welcome email with OF_PAYMENT=provider says to pay by card on the setup page, and when Teder opens', async () => {
  const t = await setup({ env: { OF_SIGNUP: '1', OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'https://pay.example.com/of', OF_PAYMENT_METHOD: 'העברה בנקאית' } });
  try {
    const b = t.browser();
    await b.get('/signup');
    await b.post('/signup', { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa.c@example.com', products: ['teder'], terms: '1', website: '', via: 'email' });
    await b.get('/signup');
    await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) });
    const w = t.mails.find((m) => m.subject === 'החשבון של Noa Ceramics נפתח');
    assert.match(w.text, /קודם התשלום על המנוי\. משלמים בכרטיס אשראי בדף ההגדרה, בכפתור "לתשלום"\. תדר נפתח אחרי שהתשלום מאושר\./);
    assert.equal(w.link, 'https://accounts.openfrequency.co.il/setup');
    // OF_PAYMENT_METHOD is manual mode's: not said with a provider, nor anything about emailing details.
    assert.doesNotMatch(w.text, /בקרוב|איך משלמים|פרטי התשלום/);
  } finally {
    await t.done();
  }
});

test('a member of a workspace never makes it complimentary, and the console shows the button only for a product that is on', async () => {
  const t = await setup({ members: { 'noa@example.com': 'client_owner' } });
  try {
    const b = signedIn(t, t.db, t.noa);
    await b.get('/');
    const r = await b.post(`/admin/workspaces/${t.ws.id}/comp`, { product: 'teder', comp: '1' });
    assert.equal(r.status, 403);
    assert.equal(t.db.get('SELECT comp FROM workspace_products').comp, 0);
    const page = (await t.admin.get('/admin/accounts')).body;
    assert.equal((page.match(/action="\/admin\/workspaces\/\d+\/comp"/g) || []).length, 1);
  } finally {
    await t.done();
  }
});

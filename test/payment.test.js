import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeWorkspace, tempHome } from './helpers.js';
import { pathOf, signedIn, startSite, tokenOf } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ROOT } from '../src/core/paths.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { billingReady, checkoutUrl, payHow, paymentMode, paymentProblem, supportWa } from '../src/accounts/billing.js';
import { runDaily } from '../src/web/daily.js';
import { startProduct } from './setup-fake.js';

// The payment switch, OF_PAYMENT (src/accounts/billing.js): manual (the default) or provider, and what each tells the
// customer wherever payment is described: the sign-up form and its confirmation page, the welcome email, /setup's
// payment step and the billing emails; what the owner's sign-up notice says to do; and the service refusing to start
// on a value it does not know, or on provider without an https OF_PAYMENT_URL.

const PAY_URL = 'https://pay.example.com/openfrequency';
// OF_PAYMENT_METHOD is set in both, to show that only manual mode says it.
const MANUAL = { OF_PAYMENT_METHOD: 'העברה בנקאית או ביט', OF_SUPPORT_WA: '972500000100' };
const PROVIDER = { ...MANUAL, OF_PAYMENT: 'provider', OF_PAYMENT_URL: PAY_URL };
const BASE = 'https://accounts.openfrequency.co.il';

test('OF_PAYMENT: manual when unset, provider only with an https OF_PAYMENT_URL; anything else is a problem, in one line', () => {
  for (const env of [{}, { OF_PAYMENT: '' }, { OF_PAYMENT: 'manual' }, { OF_PAYMENT: ' manual ' }, { OF_PAYMENT: 'manual', OF_PAYMENT_URL: 'not a url' }]) {
    assert.equal(paymentProblem(env), null, JSON.stringify(env));
    assert.equal(paymentMode(env), 'manual');
    assert.equal(billingReady(env), false);
    assert.equal(checkoutUrl(1, env), null);
  }
  const good = { OF_PAYMENT: 'provider', OF_PAYMENT_URL: PAY_URL };
  assert.equal(paymentProblem(good), null);
  assert.equal(paymentMode(good), 'provider');
  assert.equal(billingReady(good), true);
  assert.equal(checkoutUrl(1, good), PAY_URL);
  assert.equal(checkoutUrl(2, good), PAY_URL, 'the same page for every workspace');

  const bad = [
    [{ OF_PAYMENT: 'card' }, 'OF_PAYMENT is "card": it can be manual (the default, when unset) or provider'],
    [{ OF_PAYMENT: 'Provider', OF_PAYMENT_URL: PAY_URL }, 'OF_PAYMENT is "Provider": it can be manual (the default, when unset) or provider'],
    [{ OF_PAYMENT: 'provider' }, "OF_PAYMENT=provider needs OF_PAYMENT_URL, the https address of the payment provider's payment page"],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: ' ' }, "OF_PAYMENT=provider needs OF_PAYMENT_URL, the https address of the payment provider's payment page"],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'http://pay.example.com/x' }, "OF_PAYMENT_URL is not an https address: with OF_PAYMENT=provider it is the payment provider's payment page"],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'pay.example.com/x' }, "OF_PAYMENT_URL is not an https address: with OF_PAYMENT=provider it is the payment provider's payment page"],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'https://user:secret@pay.example.com/x' }, "OF_PAYMENT_URL is not an https address: with OF_PAYMENT=provider it is the payment provider's payment page"],
  ];
  for (const [env, said] of bad) {
    assert.equal(paymentProblem(env), said, JSON.stringify(env));
    // Were it to run anyway, nothing would send a customer to a page that is not there.
    assert.equal(paymentMode(env), 'manual');
    assert.equal(checkoutUrl(1, env), null);
  }
  // A long value is cut, and the line stays one line.
  assert.ok(!paymentProblem({ OF_PAYMENT: `x\n${'y'.repeat(100)}` }).includes('\n'));
  assert.ok(paymentProblem({ OF_PAYMENT: 'y'.repeat(100) }).length < 120);

  // How they pay (OF_PAYMENT_METHOD) is manual mode's only; our WhatsApp written the usual ways.
  assert.equal(payHow(MANUAL), 'העברה בנקאית או ביט');
  assert.equal(payHow(PROVIDER), '');
  assert.equal(supportWa({ OF_SUPPORT_WA: '+972 50-000-0100' }), '972500000100');
  assert.equal(supportWa({ OF_SUPPORT_WA: '0500000100' }), null);
  assert.equal(supportWa({}), null);
});

// ---- the service will not start (scripts/web.js), nor `npm run daily`

const run = (script, env) =>
  spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', INTERNAL_PORT: '0', OF_PAYMENT: '', OF_PAYMENT_URL: '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

test('a bad OF_PAYMENT, or provider without an https OF_PAYMENT_URL: the service and the daily jobs refuse to start, in one line, before the database is opened', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'of-accounts-pay-'));
  try {
    const cases = [
      [{ OF_PAYMENT: 'card' }, 'OF_PAYMENT is "card": it can be manual (the default, when unset) or provider'],
      [{ OF_PAYMENT: 'provider' }, "OF_PAYMENT=provider needs OF_PAYMENT_URL, the https address of the payment provider's payment page"],
      [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'http://pay.example.com/x' }, "OF_PAYMENT_URL is not an https address: with OF_PAYMENT=provider it is the payment provider's payment page"],
    ];
    for (const [env, said] of cases) {
      const web = run('web.js', { OF_HOME: home, ...env });
      assert.equal(web.status, 1, web.stdout + web.stderr);
      assert.equal(web.stderr.trim(), `of-accounts will not start: ${said}`);
      const daily = run('daily.js', { OF_HOME: home, ...env });
      assert.equal(daily.status, 1, daily.stdout + daily.stderr);
      assert.equal(daily.stderr.trim(), `npm run daily will not run: ${said}`);
    }
    assert.equal(existsSync(path.join(home, 'data', 'accounts.db')), false, 'stopped before the database was opened');
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 3 });
  }
});

/** Start the service, wait for its first lines, stop it: what it printed. */
function boot(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'web.js')], { cwd: ROOT, env: { ...process.env, PORT: '0', INTERNAL_PORT: '0', OF_PAYMENT: '', OF_PAYMENT_URL: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), 20_000);
    const read = (c) => {
      out += c;
      if (/^Payment: /m.test(out)) child.kill();
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', reject);
    child.on('close', () => (clearTimeout(timer), resolve(out)));
  });
}

test('both good settings start the service, which says which mode it is in', async () => {
  for (const [env, said] of [
    [{}, /^Payment: manual \(OF_PAYMENT unset or manual\)/m],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: PAY_URL }, /^Payment: provider \(OF_PAYMENT\): customers pay on OF_PAYMENT_URL, and each payment is still recorded on \/admin/m],
  ]) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'of-accounts-pay-'));
    try {
      const out = await boot({ OF_HOME: home, ...env });
      assert.match(out, /^of-accounts: http:\/\/127\.0\.0\.1:\d+/m, out);
      assert.match(out, said, out);
      assert.doesNotMatch(out, /will not start/);
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});

// ---- what the customer is told, and the owner

async function site(env) {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const teder = await startProduct('teder');
  const s = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_NOTIFY: 'boss@example.com', OF_TEDER_INTERNAL: teder.url, TEDER_URL: 'https://teder.openfrequency.co.il/', ...env } });
  return { ...h, ...s, done: async () => (await s.close(), await teder.close(), h.cleanup()) };
}

/** Sign up for Teder's small plan by the emailed link: the confirmation page, then the emails after it. */
async function signUp(t) {
  const b = t.browser();
  await b.get('/signup?p=teder&plan=small');
  await b.post('/signup', { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa@example.com', products: ['teder'], plan: 'small', terms: '1', website: '', via: 'email' });
  const confirm = (await b.get(pathOf(t.mails[0].link))).body;
  assert.equal((await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) })).headers.location, '/setup');
  return {
    confirm,
    welcome: t.mails.find((m) => m.subject === 'החשבון של Noa Ceramics נפתח'),
    notice: t.mails.find((m) => m.subject === 'הרשמה חדשה: Noa Ceramics'),
    setup: (await b.get('/setup')).body,
  };
}

const billingOf = (page) => page.slice(page.indexOf('id="setup-billing"'), page.indexOf('id="setup-teder"'));

test("manual with the owner's details (OF_PAYMENT_METHOD): the welcome email, /setup and the owner's notice give them or say they were given, Teder opens once the payment reaches us, and questions come to us", async () => {
  const t = await site(MANUAL);
  try {
    const form = (await t.browser().get('/signup')).body;
    assert.match(form, /<small>אחרי שהחשבון נפתח, נשלח לכם במייל את פרטי התשלום, והמוצרים נפתחים אחרי שהתשלום מגיע אלינו\. אפשר לבטל את המנוי מהדף הראשי, והוא עובד עד סוף התקופה ששולמה\.<\/small>/);
    assert.match(form, /דמי ההקמה לא מוחזרים, ומשלמים אותם פעם אחת, עם החודש הראשון\./);
    const { confirm, welcome, notice, setup } = await signUp(t);

    assert.match(confirm, /<p class="muted">אחרי שהחשבון נפתח, נשלח לכם במייל את פרטי התשלום\. תדר נפתח אחרי שהתשלום מגיע אלינו\.<\/p>/);

    assert.equal(welcome.link, `${BASE}/setup`);
    for (const line of [
      'קודם התשלום על המנוי, לפי פרטי התשלום שכאן למטה. תדר נפתח אחרי שהתשלום מגיע אלינו.',
      'תדר, החבילה הקטנה: 490 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת. דמי ההקמה לא מוחזרים.',
      'איך משלמים: העברה בנקאית או ביט',
      'יש שאלה על התשלום? ענו למייל הזה, או כתבו לנו בוואטסאפ ל-050-000-0100.',
    ])
      assert.ok(welcome.text.includes(line), line);
    assert.doesNotMatch(welcome.text, /בקרוב|ונשלח לכם פרטים|נשלח לכם במייל|כרטיס אשראי/);

    // The owner: the plan and its price, and that the details are already with the customer.
    assert.equal(notice.to, 'boss@example.com');
    assert.ok(notice.text.includes('תדר, החבילה הקטנה: 490 ₪ לחודש + 990 ₪ דמי הקמה, לא כולל מע״מ'), notice.text);
    assert.ok(notice.text.includes('פרטי התשלום כבר אצל noa@example.com, במייל הפתיחה. כשהתשלום מגיע, רושמים אותו בקונסולה ("התקבל תשלום לחודש"), ורק אז תדר נפתח ללקוח.'), notice.text);
    assert.doesNotMatch(notice.text, /צריך לשלוח/);

    // /setup: the details, no button to start, a quiet one to ask us on WhatsApp.
    const billing = billingOf(setup);
    assert.match(billing, /<small>משלמים לפי פרטי התשלום שכאן למטה\. תדר נפתח אחרי שהתשלום מגיע אלינו\.<\/small><\/span><a class="button quiet" href="https:\/\/wa\.me\/972500000100\?text=[^"]+">כתבו לנו בוואטסאפ<\/a>/);
    assert.ok(billing.includes(encodeURIComponent('היי, כותבים מ״Noa Ceramics״. יש לנו שאלה על התשלום.')));
    assert.match(billing, /<li>תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 990 ₪ פעם אחת<\/li>/);
    assert.match(billing, /<p>איך משלמים: העברה בנקאית או ביט<\/p>/);
    assert.match(billing, /<p class="muted">יש שאלה על התשלום\? כתבו לנו בוואטסאפ, או ענו לאחד המיילים שקיבלתם מאיתנו\.<\/p>/);
    assert.doesNotMatch(billing, /button primary|בקרוב|ונשלח לכם פרטים|כרטיס אשראי/);
  } finally {
    await t.done();
  }
});

test("manual without the owner's details: we email them, the owner's notice says to send them, and nothing says how", async () => {
  const t = await site({ OF_SUPPORT_WA: '972500000100' });
  try {
    const { welcome, notice, setup } = await signUp(t);
    assert.ok(welcome.text.includes('קודם התשלום על המנוי. את פרטי התשלום נשלח לכם במייל, לכתובת הזאת. תדר נפתח אחרי שהתשלום מגיע אלינו.'), welcome.text);
    assert.doesNotMatch(welcome.text, /איך משלמים|שכאן למטה/);
    assert.ok(notice.text.includes('צריך לשלוח ל-noa@example.com במייל את פרטי התשלום. כשהתשלום מגיע, רושמים אותו בקונסולה ("התקבל תשלום לחודש"), ורק אז תדר נפתח ללקוח.'), notice.text);
    const billing = billingOf(setup);
    assert.match(billing, /<small>את פרטי התשלום אנחנו שולחים לכם במייל\. תדר נפתח אחרי שהתשלום מגיע אלינו\.<\/small>/);
    assert.doesNotMatch(billing, /איך משלמים|שכאן למטה/);
  } finally {
    await t.done();
  }
});

test('provider: they pay by card on the payment page from /setup, and Teder opens once the payment is confirmed, never at once', async () => {
  const t = await site(PROVIDER);
  try {
    const form = (await t.browser().get('/signup')).body;
    assert.match(form, /<small>אחרי שהחשבון נפתח, משלמים בו בכרטיס אשראי, והמוצרים נפתחים אחרי שהתשלום מאושר\. אפשר לבטל את המנוי מהדף הראשי, והוא עובד עד סוף התקופה ששולמה\.<\/small>/);
    assert.match(form, /דמי ההקמה לא מוחזרים, ומשלמים אותם פעם אחת, עם החודש הראשון\./);
    const { confirm, welcome, notice, setup } = await signUp(t);

    assert.match(confirm, /<p class="muted">אחרי שהחשבון נפתח, משלמים בו בכרטיס אשראי\. תדר נפתח אחרי שהתשלום מאושר\.<\/p>/);

    assert.equal(welcome.link, `${BASE}/setup`);
    assert.ok(welcome.text.includes('קודם התשלום על המנוי. משלמים בכרטיס אשראי בדף ההגדרה, בכפתור "לתשלום". תדר נפתח אחרי שהתשלום מאושר.'), welcome.text);
    assert.ok(welcome.text.includes('תדר, החבילה הקטנה: 490 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת. דמי ההקמה לא מוחזרים.'));
    // OF_PAYMENT_METHOD is set, but it is manual mode's.
    assert.doesNotMatch(welcome.text, /איך משלמים|פרטי התשלום|בקרוב|(^|\s)מיד(\s|[.,]|$)/);

    assert.ok(notice.text.includes('תדר, החבילה הקטנה: 490 ₪ לחודש + 990 ₪ דמי הקמה, לא כולל מע״מ'));
    assert.ok(notice.text.includes('הלקוח משלם בכרטיס אשראי בדף התשלום. כשהתשלום עובר, רושמים אותו בקונסולה ("התקבל תשלום לחודש"), ורק אז תדר נפתח ללקוח.'), notice.text);
    assert.doesNotMatch(notice.text, /צריך לשלוח/);

    const billing = billingOf(setup);
    assert.match(billing, /<small>משלמים בכרטיס אשראי בדף התשלום\. תדר נפתח אחרי שהתשלום מאושר\.<\/small><\/span><a class="button primary" href="https:\/\/pay\.example\.com\/openfrequency">לתשלום<\/a>/);
    assert.doesNotMatch(billing, /איך משלמים|wa\.me|פרטי התשלום|(^|\s|>)מיד(\s|[.,<]|$)/);
  } finally {
    await t.done();
  }
});

test('/setup names the products still closed: both, or only the one not paid for yet', async () => {
  const t = await site(MANUAL);
  try {
    const ws = makeWorkspace(t.db, 'two-shop', { name: 'Two Shop', products: ['teder', 'toran'], members: { 'dana@example.com': 'client_owner' } });
    for (const p of ['teder', 'toran']) ensureSubscription(t.db, ws.id, p);
    const b = signedIn(t, t.db, t.db.get("SELECT * FROM users WHERE email = 'dana@example.com'"));
    assert.match((await b.get('/setup')).body, /משלמים לפי פרטי התשלום שכאן למטה\. תדר ותורן נפתחים אחרי שהתשלום מגיע אלינו\./);
    payMonth(t.db, ws.id, 'teder', { by: null });
    assert.match((await b.get('/setup')).body, /משלמים לפי פרטי התשלום שכאן למטה\. תורן נפתח אחרי שהתשלום מגיע אלינו\./);
  } finally {
    await t.done();
  }
});

test("the billing emails: manual gives the owner's details (without them, points to the ones we emailed) and whom to ask; provider leads soon and due to the payment page", async () => {
  for (const [env, check] of [
    [
      { OF_SUPPORT_WA: '972500000100' },
      (soon, due) => {
        for (const m of [soon, due]) {
          assert.match(m.text, /משלמים לפי פרטי התשלום ששלחנו לכם במייל\.\n\nיש שאלה על התשלום\?/);
          assert.doesNotMatch(m.text, /איך משלמים/);
        }
      },
    ],
    [
      MANUAL,
      (soon, due, stopped) => {
        for (const m of [soon, due]) {
          // The owner's details are in the email itself; nothing points to an earlier one.
          assert.match(m.text, /איך משלמים: העברה בנקאית או ביט\n\nיש שאלה על התשלום\? ענו למייל הזה, או כתבו לנו בוואטסאפ ל-050-000-0100\./);
          assert.doesNotMatch(m.text, /ששלחנו לכם במייל/);
          assert.equal(m.link, `${BASE}/setup`);
          assert.match(m.html, />לחשבון<\/a>/);
          assert.doesNotMatch(m.text, /בקרוב|כרטיס אשראי/);
        }
        assert.equal(stopped.link, `${BASE}/setup`);
      },
    ],
    [
      PROVIDER,
      (soon, due, stopped) => {
        for (const m of [soon, due]) {
          assert.match(m.text, /משלמים בכרטיס אשראי, בדף התשלום:\n\nhttps:\/\/pay\.example\.com\/openfrequency/);
          assert.equal(m.link, PAY_URL);
          assert.match(m.html, /<a href="https:\/\/pay\.example\.com\/openfrequency"[^>]*>לתשלום<\/a>/);
          assert.doesNotMatch(m.text, /איך משלמים|פרטי התשלום/);
        }
        // Stopped says nothing of how to pay: it leads to the account, where the payment step is.
        assert.equal(stopped.link, `${BASE}/setup`);
        assert.match(stopped.html, />לחשבון<\/a>/);
      },
    ],
  ]) {
    const h = tempHome();
    try {
      setNow('2026-10-22T07:00:00.000Z');
      const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
      ensureSubscription(h.db, ws.id, 'teder');
      payMonth(h.db, ws.id, 'teder', { by: null }); // paid until 21.11.2026
      const mails = [];
      const day = async (at) => (setNow(at), runDaily(h.db, { env: { PUBLIC_HOST: 'accounts.openfrequency.co.il', ...env }, mailer: { send: (m) => mails.push(m) }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {} }));
      await day('2026-11-15T08:00:00.000Z');
      await day('2026-11-22T08:00:00.000Z');
      await day('2026-12-07T08:00:00.000Z');
      const to = (subject) => mails.find((m) => m.to === 'noa@example.com' && m.subject === subject);
      check(to('התשלום הבא על תדר: 22.11.2026'), to('התשלום על תדר עוד לא הגיע'), to('תדר נעצר עד שהתשלום יגיע'));
    } finally {
      h.cleanup();
    }
  }
});

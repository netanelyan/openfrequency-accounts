import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { pathOf, signedIn, startSite, tokenOf } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { cancelSubscription } from '../src/accounts/entitlement.js';
import { setProduct, startViewAs } from '../src/accounts/workspaces.js';
import { eraseWorkspace } from '../src/accounts/erase.js';
import { dueForPay, openPayCode, PAY_CODE, payCodeFor } from '../src/accounts/pay.js';
import { payAnswer } from '../src/web/pay.js';
import { RETENTION, runDaily } from '../src/web/daily.js';
import { startProduct } from './setup-fake.js';

// Paying over WhatsApp, as people see it: the customer's one button on /setup and in the welcome and billing emails
// (only in manual mode with OF_PAYMENT_METHOD and OF_ASSISTANT_WA both set; otherwise everything says what it said
// before), and the operator's side on /admin: the receipts waiting near the top, each one's page with its picture, and
// the two buttons, "התשלום הגיע" (a month recorded, guarded like the console's button, the owners told) and "לא הגיע"
// (nothing recorded). Then the days the privacy policy gives: the codes, and the pictures.

const HOW = 'העברה בנקאית לחשבון 12-345-678901';
const ASSISTANT = '972500000200';
const WA = { OF_PAYMENT_METHOD: HOW, OF_ASSISTANT_WA: ASSISTANT, OF_SUPPORT_WA: '972500000100' };
const T0 = '2026-10-22T10:00:00.000Z';
const BASE = 'https://accounts.openfrequency.co.il';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('the rest of a picture')]);
const PDF = Buffer.from('%PDF-1.7\n% a transfer\n%%EOF\n');
const PAY_TEXT = (business, code) => `היי, אני רוצה לשלם על המנוי של ${business}. ${code}`;
const EXPLAIN = 'לוחצים על הכפתור ושולחים את ההודעה כמו שהיא. תורן עונה בוואטסאפ עם הסכום ופרטי ההעברה.';

async function site(env = WA) {
  const h = tempHome();
  setNow(T0);
  const teder = await startProduct('teder');
  const s = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_NOTIFY: 'boss@example.com', OF_TEDER_INTERNAL: teder.url, TEDER_URL: 'https://teder.openfrequency.co.il/', ...env } });
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
  ensureSubscription(h.db, ws.id, 'teder', '2026-10-22', 'small');
  const noa = h.db.get("SELECT * FROM users WHERE email = 'noa@example.com'");
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'Admin' });
  const receipt = async (data = PNG, type = 'image/png', workspaceId = ws.id) => {
    const r = await s.owners('POST', '/internal/pay/receipt', { code: payCodeFor(h.db, workspaceId).code, phone: '972500000123', file: { name: 'shot', type, data: data.toString('base64') } });
    assert.equal(r.status, 201, r.body);
    return r.json.id;
  };
  return { ...h, ...s, ws, noa, admin, receipt, done: async () => (await s.close(), await teder.close(), h.cleanup()) };
}

const billingOf = (page) => page.slice(page.indexOf('id="setup-billing"'), page.indexOf('id="setup-teder"'));
const waText = (href) => new URL(href.replace(/&amp;/g, '&')).searchParams.get('text');

// ---- the customer

test('/setup with both settings: one blue "לתשלום בוואטסאפ" to our owner line with the code in the message, the details kept, the line under them; the code stays the same', async () => {
  const t = await site();
  try {
    const b = signedIn(t, t.db, t.noa);
    const billing = billingOf((await b.get('/setup')).body);
    const m = /<a class="button primary" href="(https:\/\/wa\.me\/972500000200\?text=[^"]+)">לתשלום בוואטסאפ<\/a>/.exec(billing);
    assert.ok(m, billing);
    const { code } = t.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', t.ws.id);
    assert.match(code, PAY_CODE);
    assert.equal(waText(m[1]), PAY_TEXT('Noa Shop', code));
    assert.match(billing, /<p class="pay-total"><b>סך הכול לתשלום עכשיו: 1,746\.40 ₪, כולל מע״מ \(1,480 ₪ ועוד 266\.40 ₪ מע״מ\)\.<\/b> אחר כך 578\.20 ₪ לחודש, כולל מע״מ\.<\/p>/);
    assert.ok(billing.includes(`<p>איך משלמים: ${HOW}</p>\n<p class="pay-receipt">${EXPLAIN}</p>`), billing);
    assert.doesNotMatch(billing.replace(m[1], ''), /אסמכתא|לשלוח אסמכתא בוואטסאפ|PAY-/, 'no receipt button or line, and the code only in the link');
    assert.equal((billing.match(/class="button /g) || []).length, 1, 'one button');
    // Again: the same code, one row.
    assert.equal(waText(/href="(https:\/\/wa\.me\/[^"]+)"/.exec(billingOf((await b.get('/setup')).body))[1]), PAY_TEXT('Noa Shop', code));
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, 1);

    // Paid: the step is done, and no button.
    payMonth(t.db, t.ws.id, 'teder', { by: null });
    const paid = billingOf((await b.get('/setup')).body);
    assert.match(paid, /המנוי שולם\./);
    assert.doesNotMatch(paid, /לתשלום בוואטסאפ|wa\.me/);
  } finally {
    await t.done();
  }
});

test('/setup without one of the two settings, or with a provider: what it said before, and no code made', async () => {
  for (const [env, check] of [
    [{ OF_PAYMENT_METHOD: HOW, OF_SUPPORT_WA: '972500000100' }, (billing) => assert.match(billing, /<a class="button quiet" href="https:\/\/wa\.me\/972500000100\?text=[^"]+">לשלוח אסמכתא בוואטסאפ<\/a>/)],
    [{ OF_ASSISTANT_WA: ASSISTANT, OF_SUPPORT_WA: '972500000100' }, (billing) => assert.match(billing, /<a class="button quiet" href="https:\/\/wa\.me\/972500000100\?text=[^"]+">כתבו לנו בוואטסאפ<\/a>/)],
    [{ ...WA, OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'https://pay.example.com/of' }, (billing) => assert.match(billing, /<a class="button primary" href="https:\/\/pay\.example\.com\/of">לתשלום<\/a>/)],
  ]) {
    const t = await site(env);
    try {
      const billing = billingOf((await signedIn(t, t.db, t.noa).get('/setup')).body);
      check(billing);
      assert.doesNotMatch(billing, /לתשלום בוואטסאפ|972500000200|לוחצים על הכפתור/, JSON.stringify(env));
      assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, 0);
    } finally {
      await t.done();
    }
  }
});

// The week before the next month (Teder's banner, "אפשר כבר לשלם על החודש הבא", leads here): /setup offers it, as
// Toran quotes it (dueForPay()) and as the billing emails a week and a day before ask for it, on the same days.
test('/setup in the week before the next month: the month ahead, its total and the one button, from 7 days before it falls due to the last paid day', async () => {
  const t = await site();
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: null }); // paid until 21.11.2026, the small plan: 490 ₪ before VAT
    const mails = [];
    const daily = (at) => runDaily(t.db, { env: { PUBLIC_HOST: 'accounts.openfrequency.co.il', ...WA }, mailer: { send: (m) => mails.push(m) }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {} });
    const LINE = '<li>תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, על החודש שמתחיל ב-22.11.2026</li>';
    const TOTAL = 'סך הכול לתשלום עכשיו: 578.20 ₪, כולל מע״מ (490 ₪ ועוד 88.20 ₪ מע״מ).';
    const day = async (at) => {
      setNow(at);
      return billingOf((await signedIn(t, t.db, t.noa).get('/setup')).body);
    };

    // A week and a day before it falls due: paid, nothing to pay, no button, as before.
    let card = await day('2026-11-14T10:00:00.000Z');
    assert.match(card, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>המנוי שולם\.<\/small><\/span><\/li>/);
    assert.match(card, /<li>תדר, החבילה הקטנה: שולם עד 21\.11\.2026<\/li>/);
    assert.doesNotMatch(card, /<a class="button|סך הכול/);
    assert.deepEqual(dueForPay(t.db, t.ws.id).items, []);

    // From the 15th (6 days before the last paid day, the day soon7 goes) to the 21st (the last paid day, soon1's): the
    // step stays done, and the card offers the next month, what Toran would quote, with "לתשלום בוואטסאפ".
    for (const at of ['2026-11-15T07:00:00.000Z', '2026-11-18T10:00:00.000Z', '2026-11-21T21:00:00.000Z']) {
      card = await day(at);
      assert.match(card, /<li class="step st-done"><span class="chip">✓ בוצע<\/span><span class="what"><b>התשלום על המנוי<\/b><small>המנוי שולם\. אפשר כבר לשלם על החודש הבא\.<\/small><\/span><a class="button primary" href="https:\/\/wa\.me\/972500000200\?text=[^"]+">לתשלום בוואטסאפ<\/a><\/li>/, at);
      assert.ok(card.includes(LINE), at);
      assert.ok(card.includes(`<b>${TOTAL}</b>`), at);
      assert.ok(card.includes(`איך משלמים: ${HOW}`) && card.includes(EXPLAIN), at);
      assert.equal((card.match(/<a class="button/g) || []).length, 1, `${at}: one button`);
      const due = dueForPay(t.db, t.ws.id);
      assert.deepEqual([due.total, due.lines[0].kind, due.lines[0].paidUntil], [578.2, 'ahead', '2026-11-21'], at);
      const { code } = t.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', t.ws.id);
      assert.equal(waText(/href="([^"]+)">לתשלום בוואטסאפ/.exec(card)[1]), PAY_TEXT('Noa Shop', code), at);
      // The billing email of that week, the same day: the same month, the same amount, the same button.
      if (at.startsWith('2026-11-15') || at.startsWith('2026-11-21')) {
        mails.length = 0;
        await daily(at);
        const m = mails.find((x) => x.to === 'noa@example.com');
        assert.equal(m.subject, 'התשלום הבא על תדר: 22.11.2026', at);
        assert.ok(m.text.includes('מתחיל ב-22.11.2026. הסכום: 490 ₪ ועוד מע״מ, 578.20 ₪ בסך הכול.'), at);
        assert.equal(m.link, /href="([^"]+)">לתשלום בוואטסאפ/.exec(card)[1].replace(/&amp;/g, '&'), `${at}: the email's button is the card's`);
      }
    }

    // The first day after it: the payment is owed now, and the card is the due one.
    card = await day('2026-11-22T10:00:00.000Z');
    assert.match(card, /<li class="step st-todo">/);
    assert.match(card, /<li>תדר, החבילה הקטנה: התשלום על החודש החדש עוד לא הגיע\. המנוי עובד עד סוף יום שלישי, 24\.11\.2026, ואחרי זה נעצר עד שישולם\.<\/li>/);
    assert.ok(card.includes(`<b>${TOTAL}</b>`));
    assert.equal(dueForPay(t.db, t.ws.id).total, 578.2);
  } finally {
    await t.done();
  }
});

test('/setup in the week before the next month, in the other ways of paying: our WhatsApp for the receipt, or the payment page', async () => {
  for (const [env, button] of [
    [{ OF_PAYMENT_METHOD: HOW, OF_SUPPORT_WA: '972500000100' }, /<a class="button quiet" href="https:\/\/wa\.me\/972500000100\?text=[^"]+">לשלוח אסמכתא בוואטסאפ<\/a>/],
    [{ OF_SUPPORT_WA: '972500000100' }, /<a class="button quiet" href="https:\/\/wa\.me\/972500000100\?text=[^"]+">כתבו לנו בוואטסאפ<\/a>/],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'https://pay.example.com/openfrequency' }, /<a class="button primary" href="https:\/\/pay\.example\.com\/openfrequency[^"]*">לתשלום<\/a>/],
  ]) {
    const t = await site(env);
    try {
      payMonth(t.db, t.ws.id, 'teder', { by: null }); // paid until 21.11.2026
      setNow('2026-11-18T10:00:00.000Z');
      const card = billingOf((await signedIn(t, t.db, t.noa).get('/setup')).body);
      assert.match(card, button, JSON.stringify(env));
      assert.equal((card.match(/<a class="button/g) || []).length, 1, 'one button');
      assert.ok(card.includes('<li>תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, על החודש שמתחיל ב-22.11.2026</li>'));
      assert.ok(card.includes('סך הכול לתשלום עכשיו: 578.20 ₪'));
      // Cancelled, it is never asked for the month after its last day.
      cancelSubscription(t.db, t.ws.id, 'teder', { by: null });
      const after = billingOf((await signedIn(t, t.db, t.noa).get('/setup')).body);
      assert.doesNotMatch(after, /<a class="button|סך הכול|על החודש שמתחיל/);
    } finally {
      await t.done();
    }
  }
});

test('/setup in view-as: the customer\'s card without its button, and no code made for it', async () => {
  const t = await site();
  try {
    const b = signedIn(t, t.db, t.admin);
    startViewAs(t.db, t.db.get('SELECT * FROM sessions WHERE user_id = ?', t.admin.id), t.ws.id, { by: t.admin });
    const billing = billingOf((await b.get('/setup')).body);
    assert.ok(billing.includes(`<p class="pay-receipt">${EXPLAIN}</p>`), billing);
    assert.doesNotMatch(billing, /class="button|wa\.me/);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, 0);
  } finally {
    await t.done();
  }
});

test('the welcome email with both settings: the details, the line, then "לתשלום בוואטסאפ" before the setup\'s button; the address under it only in the text part', async () => {
  const t = await site();
  try {
    const b = t.browser();
    await b.get('/signup');
    await b.post('/signup', { name: 'Gal Cohen', business: 'Gal Ceramics', email: 'gal@example.com', products: ['teder'], plan: 'small', terms: '1', website: '', via: 'email' });
    await b.get(pathOf(t.mails[0].link));
    await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) });
    const welcome = t.mails.find((m) => m.subject === 'החשבון של Gal Ceramics נפתח');
    const ws = t.db.get("SELECT id FROM workspaces WHERE name = 'Gal Ceramics'");
    const { code } = t.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', ws.id);
    const href = `https://wa.me/${ASSISTANT}?text=${encodeURIComponent(PAY_TEXT('Gal Ceramics', code))}`;
    assert.ok(welcome.text.includes(`איך משלמים: ${HOW}\n\n${EXPLAIN}\n\n${href}\n\nיש שאלה על התשלום?`), welcome.text);
    assert.ok(welcome.text.includes('סך הכול לתשלום עכשיו: 1,746.40 ₪, כולל מע״מ'));
    assert.ok(welcome.text.includes(`${BASE}/setup`));
    assert.doesNotMatch(welcome.text, /אסמכתא/);
    const pay = welcome.html.indexOf('>לתשלום בוואטסאפ</a>');
    const setup = welcome.html.indexOf('>לדף ההגדרה</a>');
    assert.ok(pay > 0 && setup > pay, 'the payment first, then the setup');
    assert.ok(welcome.html.includes(`href="${href}"`));
    assert.doesNotMatch(welcome.html, /word-break:break-all">https:\/\/wa\.me/, 'the WhatsApp address is not printed');
    assert.match(welcome.html, /word-break:break-all">https:\/\/accounts\.openfrequency\.co\.il\/setup</);
  } finally {
    await t.done();
  }
});

test('the billing emails with both settings: soon, due and last lead to "לתשלום בוואטסאפ", whose code Toran answers with that month; stopped leads to the account', async () => {
  const h = tempHome();
  try {
    setNow('2026-10-22T07:00:00.000Z');
    const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
    ensureSubscription(h.db, ws.id, 'teder');
    payMonth(h.db, ws.id, 'teder', { by: null }); // paid until 21.11.2026
    const mails = [];
    const env = { PUBLIC_HOST: 'accounts.openfrequency.co.il', ...WA };
    const day = async (at) => (setNow(at), runDaily(h.db, { env, mailer: { send: (m) => mails.push(m) }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {} }));
    await day('2026-11-15T08:00:00.000Z');
    const soon7 = mails.find((m) => m.subject === 'התשלום הבא על תדר: 22.11.2026');
    const { code } = h.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', ws.id);
    const href = `https://wa.me/${ASSISTANT}?text=${encodeURIComponent(PAY_TEXT('Noa Shop', code))}`;
    // What Toran is told for that code that day: the month that starts on the 22nd.
    const answer = payAnswer(openPayCode(h.db, code), dueForPay(h.db, ws.id), env);
    assert.deepEqual([answer.total, answer.summary[0]], [932.2, 'תדר, החבילה המלאה: 790 ₪ לחודש, לא כולל מע״מ, על החודש שמתחיל ב-22.11.2026.']);
    for (const at of ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']) await day(`${at}T08:00:00.000Z`);
    const to = (subject) => mails.find((m) => m.to === 'noa@example.com' && m.subject === subject);
    const soon1 = mails.filter((m) => m.subject === 'התשלום הבא על תדר: 22.11.2026')[1];
    for (const m of [soon7, soon1, to('התשלום על החודש החדש של תדר עוד לא הגיע'), to('תדר ייעצר מחר אם התשלום לא יגיע היום')]) {
      assert.equal(m.link, href, m.subject);
      assert.match(m.html, />לתשלום בוואטסאפ<\/a>/);
      assert.ok(m.text.includes(`איך משלמים: ${HOW}\n\n${EXPLAIN}\n\nיש שאלה על התשלום?`), m.text);
      assert.doesNotMatch(m.text, /אסמכתא/);
      assert.doesNotMatch(m.html, /word-break:break-all">https:\/\/wa\.me/);
    }
    const stopped = to('תדר נעצר עד שהתשלום יגיע');
    assert.equal(stopped.link, `${BASE}/setup`);
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, 1, 'one code for all of them');
  } finally {
    h.cleanup();
  }
});

test('a product cancelled and stopped is never asked for: /setup says it ended and totals only the other, Toran quotes only the other; with nothing else, no payment step at all', async () => {
  const t = await site();
  try {
    setProduct(t.db, t.ws.id, 'toran', true, { by: null });
    ensureSubscription(t.db, t.ws.id, 'toran', '2026-10-22');
    cancelSubscription(t.db, t.ws.id, 'teder', { by: null }); // nothing paid: it stops today
    const b = signedIn(t, t.db, t.noa);
    const page = (await b.get('/setup')).body;
    const billing = billingOf(page);
    assert.match(billing, /<li>תדר, החבילה הקטנה: המנוי הסתיים ב-22\.10\.2026, ואין עליו מה לשלם<\/li><li>תורן: 590 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 990 ₪ פעם אחת<\/li>/);
    assert.match(billing, /סך הכול לתשלום עכשיו: 1,864\.40 ₪, כולל מע״מ \(1,580 ₪ ועוד 284\.40 ₪ מע״מ\)\./);
    assert.match(billing, /<small>משלמים לפי פרטי התשלום שכאן למטה\. תורן נפתח אחרי שהתשלום מגיע אלינו\.<\/small>/);
    const { code } = t.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', t.ws.id);
    const answer = (await t.owners('GET', `/internal/pay?code=${code}`)).json;
    assert.deepEqual([answer.items.map((i) => i.product), answer.total], [['toran'], 1864.4]);
    // Its own section: ended, no steps, nothing about a payment.
    const teder = page.slice(page.indexOf('id="setup-teder"'), page.indexOf('</section>', page.indexOf('id="setup-teder"')));
    assert.match(teder, /<span class="tag off">הסתיים<\/span>/);
    assert.match(teder, /<p class="muted">המנוי לתדר הסתיים, אז הצעדים שלו סגורים\.<\/p>/);
    assert.doesNotMatch(teder, /class="steps"|אחרי התשלום/);

    // Toran cancelled too: nothing to pay for anywhere, so no payment step, no button, no code made for it.
    const only = makeWorkspace(t.db, 'gal-shop', { name: 'Gal Shop', products: ['teder'], members: { 'gal@example.com': 'client_owner' } });
    ensureSubscription(t.db, only.id, 'teder', '2026-10-22', 'small');
    cancelSubscription(t.db, only.id, 'teder', { by: null });
    const gal = (await signedIn(t, t.db, t.db.get("SELECT * FROM users WHERE email = 'gal@example.com'")).get('/setup')).body;
    assert.doesNotMatch(gal, /id="setup-billing"|לתשלום בוואטסאפ|התשלום על המנוי|לשלוח אסמכתא/);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes WHERE workspace_id = ?', only.id).n, 0);
  } finally {
    await t.done();
  }
});

test('the billing email a week before one product\'s payment, beside another cancelled and stopped: its button leads Toran to that month, not to the ended one', async () => {
  const h = tempHome();
  try {
    setNow('2026-10-22T07:00:00.000Z');
    const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder', 'toran'], members: { 'noa@example.com': 'client_owner' } });
    for (const p of ['teder', 'toran']) ensureSubscription(h.db, ws.id, p);
    payMonth(h.db, ws.id, 'teder', { by: null }); // paid until 21.11.2026
    cancelSubscription(h.db, ws.id, 'toran', { by: null }); // never paid: stopped today
    const mails = [];
    const env = { PUBLIC_HOST: 'accounts.openfrequency.co.il', ...WA };
    setNow('2026-11-15T08:00:00.000Z');
    await runDaily(h.db, { env, mailer: { send: (m) => mails.push(m) }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {} });
    assert.deepEqual(mails.map((m) => m.subject), ['התשלום הבא על תדר: 22.11.2026'], 'nothing about Toran');
    const { code } = h.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', ws.id);
    assert.equal(mails[0].link, `https://wa.me/${ASSISTANT}?text=${encodeURIComponent(PAY_TEXT('Noa Shop', code))}`);
    const answer = payAnswer(openPayCode(h.db, code), dueForPay(h.db, ws.id), env);
    assert.deepEqual([answer.items.map((i) => [i.product, i.setup]), answer.total], [[['teder', 0]], 932.2]);
  } finally {
    h.cleanup();
  }
});

// ---- the operator

test('/admin lists the receipts waiting, newest first, near the top; none, no section; a decided one leaves it', async () => {
  const t = await site();
  try {
    const op = signedIn(t, t.db, t.admin);
    assert.doesNotMatch((await op.get('/admin')).body, /אישורי העברה שמחכים/);
    const first = await t.receipt();
    setNow('2026-10-22T11:00:00.000Z');
    const other = makeWorkspace(t.db, 'gal-shop', { name: 'Gal <Shop>', products: ['toran'], members: { 'gal@example.com': 'client_owner' } });
    ensureSubscription(t.db, other.id, 'toran');
    const second = await t.receipt(PNG, 'image/png', other.id);
    const page = (await op.get('/admin')).body;
    const at = page.indexOf('<section id="receipts">');
    assert.ok(at > 0 && at < page.indexOf('class="kpis top-kpis"'), 'before the numbers');
    assert.match(page, /<h2>אישורי העברה שמחכים<\/h2><p class="muted">צילומים של העברות שלקוחות שלחו לתורן\. לפני שמאשרים, בודקים בבנק שהכסף נכנס\.<\/p>/);
    const a = page.indexOf(`href="/admin/receipts/${second}">Gal &lt;Shop&gt;</a>`);
    const b = page.indexOf(`href="/admin/receipts/${first}">Noa Shop</a>`);
    assert.ok(a > 0 && b > a, 'newest first, the name escaped');
    assert.match(page, /Noa Shop<\/a><span class="muted">1,746\.40 ₪<\/span>/);
    await op.post(`/admin/receipts/${first}/not-paid`);
    const after = (await op.get('/admin')).body;
    assert.ok(!after.includes(`/admin/receipts/${first}"`) && after.includes(`/admin/receipts/${second}"`));
  } finally {
    await t.done();
  }
});

test('a receipt\'s page and its file are the superadmin\'s only: the picture inline, nosniff, never cached; a PDF as a link', async () => {
  const t = await site();
  try {
    const id = await t.receipt();
    const op = signedIn(t, t.db, t.admin);
    const page = (await op.get(`/admin/receipts/${id}`)).body;
    assert.match(page, new RegExp(`<img class="receipt-shot" src="/admin/receipts/${id}/file" alt="צילום ההעברה מ״Noa Shop״">`));
    assert.match(page, /<dt>נשלח מהמספר<\/dt><dd><bdi class="ltr">050-000-0123<\/bdi><\/dd>/);
    assert.match(page, /<dt>מתי<\/dt><dd>22\.10\.2026, 13:00<\/dd>/);
    assert.match(page, /<h3>מה היה לתשלום כשהאישור הגיע<\/h3>\n<ul class="prices"><li>תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 990 ₪ פעם אחת\.<\/li><\/ul><p class="pay-total"><b>סך הכול לתשלום עכשיו: 1,746\.40 ₪/);
    assert.match(page, /<h3>מה לתשלום היום<\/h3>\n<ul class="prices">/);
    // The two buttons, apart, the paid-until day the page showed riding with "התשלום הגיע".
    assert.match(page, new RegExp(`<div class="row"><form method="post" action="/admin/receipts/${id}/paid" class="inline"><input type="hidden" name="_csrf" value="[^"]+"><input type="hidden" name="expect_teder" value=""><button class="primary">התשלום הגיע</button></form><form method="post" action="/admin/receipts/${id}/not-paid" class="inline"><input type="hidden" name="_csrf" value="[^"]+"><button class="quiet">לא הגיע</button></form></div>`));
    assert.match(page, /&quot;התשלום הגיע&quot; רושם חודש על תדר ושולח לבעלי החשבון מייל שהתשלום התקבל\./);

    const f = await op.get(`/admin/receipts/${id}/file`);
    assert.equal(f.status, 200);
    assert.deepEqual([f.headers['content-type'], f.headers['content-disposition'], f.headers['x-content-type-options'], f.headers['cache-control']], ['image/png', `inline; filename="receipt-${id}.png"`, 'nosniff', 'no-store']);
    assert.match(f.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(f.raw.equals(PNG));

    const pdf = await t.receipt(PDF, 'application/pdf');
    const pdfPage = (await op.get(`/admin/receipts/${pdf}`)).body;
    assert.match(pdfPage, new RegExp(`<a class="button quiet" href="/admin/receipts/${pdf}/file" target="_blank" rel="noopener">לפתוח את הקובץ \\(PDF\\)</a>`));
    assert.doesNotMatch(pdfPage, /<img class="receipt-shot"/);
    assert.equal((await op.get(`/admin/receipts/${pdf}/file`)).headers['content-type'], 'application/pdf');
    assert.equal((await op.get('/admin/receipts/999')).status, 404);
    assert.equal((await op.get('/admin/receipts/999/file')).status, 404);

    // A customer, and nobody: to the operator's sign-in; a POST refused, and nothing recorded.
    const noa = signedIn(t, t.db, t.noa);
    await noa.get('/');
    for (const b of [noa, t.browser()]) {
      for (const p of [`/admin/receipts/${id}`, `/admin/receipts/${id}/file`]) {
        const r = await b.get(p);
        assert.deepEqual([r.status, r.headers.location], [303, '/admin/login'], p);
      }
    }
    assert.equal((await noa.post(`/admin/receipts/${id}/paid`, { expect_teder: '' })).status, 403);
    assert.deepEqual(Object.values(t.db.get('SELECT decided_at, decision FROM pay_receipts WHERE id = ?', id)), [null, null]);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, null);
  } finally {
    await t.done();
  }
});

test('"התשלום הגיע": the month recorded, the owners told, the receipt closed; pressed again, nothing more; without the CSRF token, nothing at all', async () => {
  const t = await site();
  try {
    const id = await t.receipt();
    const op = signedIn(t, t.db, t.admin);
    await op.get(`/admin/receipts/${id}`);
    assert.equal((await op.go('POST', `/admin/receipts/${id}/paid`, { _csrf: 'nope', expect_teder: '' })).status, 403);
    assert.equal(t.db.get('SELECT decided_at FROM pay_receipts WHERE id = ?', id).decided_at, null);

    t.mails.length = 0;
    const r = await op.post(`/admin/receipts/${id}/paid`, { expect_teder: '' });
    assert.deepEqual([r.status, r.headers.location], [303, '/admin']);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-11-21');
    const row = t.db.get('SELECT * FROM pay_receipts WHERE id = ?', id);
    assert.deepEqual([row.decision, row.decided_by, row.decided_at], ['paid', t.admin.id, T0]);
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'תדר פתוח. אפשר להתחיל']]);
    assert.match(t.mails[0].text, /המנוי שולם עד 21\.11\.2026\./);
    assert.match((await op.get('/admin')).body, /Noa Shop: התשלום נרשם\. תדר שולם עד 21\.11\.2026\./);
    const a = t.db.get("SELECT * FROM audit WHERE action = 'pay_receipt_paid'");
    assert.deepEqual([a.actor, a.workspace_id, JSON.parse(a.detail_json)], ['admin@example.com', t.ws.id, { receipt: id, recorded: [{ product: 'teder', until: '2026-11-21' }] }]);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'subscription_paid' AND workspace_id = ?", t.ws.id));

    // Its page says so, with no buttons; pressing again records nothing.
    const page = (await op.get(`/admin/receipts/${id}`)).body;
    assert.match(page, /סימנתם ב-22\.10\.2026, 13:00 שהתשלום הגיע\./);
    assert.doesNotMatch(page, /<button class="primary">התשלום הגיע/);
    const again = await op.post(`/admin/receipts/${id}/paid`, { expect_teder: '2026-11-21' });
    assert.deepEqual([again.status, again.headers.location], [303, `/admin/receipts/${id}`]);
    assert.match((await op.get(`/admin/receipts/${id}`)).body, /<p class="flash" role="status">התשלום כבר נרשם\.<\/p>/);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-11-21');
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM audit WHERE action = 'subscription_paid'").n, 1);
  } finally {
    await t.done();
  }
});

test('"התשלום הגיע" on a page left open after the month was recorded elsewhere: the console\'s already_paid, nothing recorded, the receipt still waiting', async () => {
  const t = await site();
  try {
    const id = await t.receipt();
    const op = signedIn(t, t.db, t.admin);
    await op.get(`/admin/receipts/${id}`); // shows expect_teder ""
    payMonth(t.db, t.ws.id, 'teder', { by: t.admin }); // the console's button, meanwhile
    const r = await op.post(`/admin/receipts/${id}/paid`, { expect_teder: '' });
    assert.equal(r.status, 409);
    assert.match(r.body, /<p class="error" role="alert">התשלום כבר נרשם\.<\/p>/);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-11-21', 'one month, not two');
    assert.equal(t.db.get('SELECT decided_at FROM pay_receipts WHERE id = ?', id).decided_at, null);
    // The page says what changed since the receipt came.
    assert.match(r.body, /<p class="warn">מאז שהאישור הגיע נרשם תשלום על תדר, ועכשיו הוא שולם עד 21\.11\.2026\.<\/p>/);
  } finally {
    await t.done();
  }
});

test('"לא הגיע": the receipt closed, nothing recorded, nobody emailed', async () => {
  const t = await site();
  try {
    const id = await t.receipt();
    const op = signedIn(t, t.db, t.admin);
    await op.get(`/admin/receipts/${id}`);
    t.mails.length = 0;
    const r = await op.post(`/admin/receipts/${id}/not-paid`);
    assert.deepEqual([r.status, r.headers.location], [303, '/admin']);
    assert.deepEqual([t.db.get('SELECT decision FROM pay_receipts WHERE id = ?', id).decision, t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until], ['not_paid', null]);
    assert.equal(t.mails.length, 0);
    assert.match((await op.get('/admin')).body, /סימנו שהתשלום מ״Noa Shop״ לא הגיע\. שום דבר לא נרשם\./);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'pay_receipt_not_paid' AND workspace_id = ?", t.ws.id));
    assert.match((await op.get(`/admin/receipts/${id}`)).body, /סימנתם ב-22\.10\.2026, 13:00 שהתשלום לא הגיע\./);
  } finally {
    await t.done();
  }
});

test('a receipt that came when nothing was owed: nothing to record from it, until something is owed; then what is owed now', async () => {
  const t = await site();
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: null }); // paid until 21.11.2026
    const id = await t.receipt();
    const op = signedIn(t, t.db, t.admin);
    const page = (await op.get(`/admin/receipts/${id}`)).body;
    assert.match(page, /<h3>מה היה לתשלום כשהאישור הגיע<\/h3>\n<p class="muted">לא היה מה לשלם\.<\/p>/);
    assert.match(page, /<p class="muted">היום אין מה לשלם\.<\/p>/);
    assert.match(page, new RegExp(`אין מה לרשום מהאישור הזה\\. אם צריך לרשום תשלום, רושמים אותו בדף החשבונות\\. <a href="/admin/accounts#ws-${t.ws.id}">לחשבון בקונסולה</a>`));
    assert.doesNotMatch(page, /<button class="primary">התשלום הגיע/);
    assert.match(page, /<button class="quiet">לא הגיע<\/button>/);
    const r = await op.post(`/admin/receipts/${id}/paid`, {});
    assert.equal(r.status, 409);
    assert.equal(t.db.get('SELECT decided_at FROM pay_receipts WHERE id = ?', id).decided_at, null);

    // A week before the next payment: that month is what "התשלום הגיע" records.
    setNow('2026-11-16T10:00:00.000Z');
    const later = signedIn(t, t.db, t.admin); // the operator's session from the 22nd has ended
    const soon = (await later.get(`/admin/receipts/${id}`)).body;
    assert.match(soon, /כשהאישור הגיע לא היה מה לשלם, אז &quot;התשלום הגיע&quot; ירשום את מה שלתשלום היום\./);
    assert.match(soon, /name="expect_teder" value="2026-11-21"/);
    assert.equal((await later.post(`/admin/receipts/${id}/paid`, { expect_teder: '2026-11-21' })).status, 303);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-12-21');
  } finally {
    await t.done();
  }
});

// ---- retention, and a deleted workspace

test('retention: a payment code 30 days after it ended, a receipt\'s file 90 days after it came (its row kept, its page says so); a deleted workspace takes both', async () => {
  const t = await site();
  try {
    assert.equal(RETENTION.receiptFileDays, 90);
    const old = await t.receipt();
    t.db.run('UPDATE pay_codes SET expires_at = ?', '2026-09-21T10:00:00.000Z'); // ended 31 days before T0
    setNow('2026-08-01T10:00:00.000Z');
    t.db.insert('pay_codes', { code: 'PAY-ABCDEF', workspace_id: t.ws.id, created_at: '2026-08-01T10:00:00.000Z', expires_at: '2026-09-23T10:00:00.000Z' }); // ended 29 days before
    setNow(T0);
    t.db.run('UPDATE pay_receipts SET created_at = ? WHERE id = ?', '2026-07-23T10:00:00.000Z', old); // 91 days
    const recent = await t.receipt(PDF, 'application/pdf');
    t.db.run('UPDATE pay_receipts SET created_at = ? WHERE id = ?', '2026-07-25T10:00:00.000Z', recent); // 89 days
    const r = await runDaily(t.db, { env: {}, mailer: { send: () => {} }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {}, t: Date.parse('2026-10-22T08:00:00.000Z') });
    assert.deepEqual([r.retention.payCodes, r.retention.receiptFiles], [1, 1]);
    assert.deepEqual(t.db.all('SELECT code FROM pay_codes ORDER BY code').map((x) => x.code).includes('PAY-ABCDEF'), true);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, 2, 'the one ended 29 days ago, and the live one');
    const rows = t.db.all('SELECT id, file IS NULL AS gone, size FROM pay_receipts ORDER BY id');
    assert.deepEqual(rows.map((x) => [x.id, x.gone]), [[old, 1], [recent, 0]]);
    assert.equal(rows[0].size, PNG.length, 'the row kept');

    const op = signedIn(t, t.db, t.admin);
    assert.match((await op.get(`/admin/receipts/${old}`)).body, /הקובץ נמחק, 90 יום אחרי שהגיע\. שאר הפרטים נשארו כאן\./);
    assert.equal((await op.get(`/admin/receipts/${old}/file`)).status, 404);

    eraseWorkspace(t.db, t.ws.id, { source: 'owner' });
    assert.deepEqual([t.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, t.db.get('SELECT COUNT(*) AS n FROM pay_receipts').n], [0, 0]);
  } finally {
    await t.done();
  }
});

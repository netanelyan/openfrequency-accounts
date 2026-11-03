import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ensureSubscription } from '../src/accounts/subscriptions.js';
import { payCodeFor } from '../src/accounts/pay.js';
import { accessOf } from '../src/accounts/entitlement.js';
import * as messages from '../src/mail/messages.js';

// Read off the module, so that on the code before this change each test fails on what it checks, not all at import.
const { paidMail, paidOpening } = messages;

// The email each owner gets once a payment is recorded (the owner's audit, 2026-11-02, accounts item 4: "After a
// payment is recorded, send the customer an email (Resend, hebrew-voice, "we" voice): "תדר פתוח. אפשר להתחיל" with a
// link."). It is the one email that was already sent then ("קיבלנו את התשלום על תדר"), not a second one: when the
// payment opened the product, its subject and first line say so, and its one button leads into the product (TEDER_URL,
// TORAN_URL); a month paid while the product was open already (ahead of time, in its grace, or complimentary) says it
// goes on; a product that stopped and opens again says that; and one the payment did not open (cancelled, turned off)
// gets the email as it was. What was paid, until when and the invoice's line stay in every one. Both places that record
// a month send it: the console's "התקבל תשלום לחודש" and a receipt's "התשלום הגיע"; a refused duplicate ("התשלום כבר
// נרשם") and "לא הגיע" send nothing.

const T0 = '2026-10-22T10:00:00.000Z'; // 22.10.2026 in Israel
/** TEDER_URL and TORAN_URL here, so the button is seen to come from the setting. */
const TEDER = 'https://teder-staging.openfrequency.co.il/';
const TORAN = 'https://toran-staging.openfrequency.co.il/';
const ACCOUNT = 'https://accounts.openfrequency.co.il/';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a picture')]);
const INVOICE = 'כשהחשבונית מוכנה, היא תופיע בדף הראשי של החשבון, ואפשר יהיה להוריד אותה משם.';
const OWNERS = ['dan@example.com', 'noa@example.com'];

async function site({ env = {}, name = 'Noa Shop', comp = false } = {}) {
  const h = tempHome();
  setNow(T0);
  const s = await startSite(h.db, { env: { OF_PAYMENT_METHOD: 'העברה בנקאית לחשבון 12-345-678901', OF_ASSISTANT_WA: '972500000200', TEDER_URL: TEDER, TORAN_URL: TORAN, ...env } });
  // Two owners and a member: the owners are emailed, the member is not.
  const ws = makeWorkspace(h.db, 'noa-shop', { name, comp, products: ['teder', 'toran'], members: { 'noa@example.com': 'client_owner', 'dan@example.com': 'client_owner', 'tal@example.com': 'client_member' } });
  for (const p of ['teder', 'toran']) ensureSubscription(h.db, ws.id, p, '2026-10-22');
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'Admin' });
  const op = signedIn(s, h.db, admin);
  const sub = (product, fields) => {
    for (const [k, v] of Object.entries(fields)) h.db.run(`UPDATE subscriptions SET ${k} = ? WHERE workspace_id = ? AND product = ?`, v, ws.id, product);
  };
  const paidUntil = (product = 'teder') => h.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ? AND product = ?', ws.id, product).paid_until;
  /** The console's "התקבל תשלום לחודש" for one product, as the page draws it now (its one-time token and date). */
  const payForm = async (product = 'teder') => {
    const page = (await op.get('/admin/accounts')).body;
    const f = forms(page).find((x) => x.action === `/admin/workspaces/${ws.id}/subscription/pay` && x.fields.product === product);
    // A product the console draws no button for (turned off): the same request, with the date it is paid until.
    return f || { action: `/admin/workspaces/${ws.id}/subscription/pay`, fields: { product, expect: paidUntil(product) ?? '' } };
  };
  const pay = async (product = 'teder') => {
    const f = await payForm(product);
    s.mails.length = 0;
    const r = await op.post(f.action, f.fields);
    assert.equal(r.status, 303, r.body);
    return s.mails.slice();
  };
  const receipt = async () => {
    const r = await s.owners('POST', '/internal/pay/receipt', { code: payCodeFor(h.db, ws.id).code, phone: '972500000123', file: { name: 'shot.png', type: 'image/png', data: PNG.toString('base64') } });
    assert.equal(r.status, 201, r.body);
    return r.json.id;
  };
  const receiptForm = async (id, decision = 'paid') => {
    const page = (await op.get(`/admin/receipts/${id}`)).body;
    const f = forms(page).find((x) => x.action === `/admin/receipts/${id}/${decision}`);
    assert.ok(f, `no ${decision} button on receipt ${id}`);
    return f;
  };
  return { ...h, ...s, ws, op, sub, paidUntil, payForm, pay, receipt, receiptForm, done: async () => (await s.close(), h.cleanup()) };
}

const forms = (page) =>
  [...page.matchAll(/<form method="post" action="([^"]+)"[^>]*>([^]*?)<\/form>/g)].map((m) => ({
    action: m[1],
    fields: Object.fromEntries([...m[2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((x) => [x[1], x[2]])),
  }));
/** The button of an email's HTML: its link and its label. */
const buttonOf = (html) => {
  const m = /<td bgcolor="#[0-9a-f]{6}" style="background:#[0-9a-f]{6};border-radius:12px"><a href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(html);
  return m ? { href: m[1], label: m[2] } : null;
};
/** The paragraphs of an email's card, in order, as written in the HTML. */
const paragraphsOf = (html) => [...html.matchAll(/<p class="of-ink"[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);
/** The lines of an email's text part, without the empty lines. */
const linesOf = (text) => text.split('\n').filter(Boolean);

// ---- the first payment

test('the first payment, on the console: each owner gets one email, "תדר פתוח. אפשר להתחיל", what was paid and until when, one button into Teder (TEDER_URL) and the invoice\'s line; the member gets none', async () => {
  const t = await site();
  try {
    const mails = await t.pay('teder');
    assert.equal(t.paidUntil(), '2026-11-21');
    assert.deepEqual(mails.map((m) => m.to).sort(), OWNERS, 'each owner, once; not the member');
    const m = mails.find((x) => x.to === 'noa@example.com');
    assert.equal(m.subject, 'תדר פתוח. אפשר להתחיל');
    assert.equal(
      m.text,
      [
        'שלום,',
        'תדר פתוח. אפשר להתחיל.',
        'קיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.',
        TEDER,
        INVOICE,
        'OpenFrequency',
      ].join('\n\n')
    );
    assert.equal(m.link, TEDER);
    // The HTML: the line first, the one button into Teder with its address written under it, the paid details, the
    // invoice's line, in the layout every email has (the mark, the card, the foot).
    assert.deepEqual(buttonOf(m.html), { href: TEDER, label: 'להיכנס לתדר' });
    assert.equal(m.html.match(/border-radius:12px"><a href=/g).length, 1, 'one button');
    assert.deepEqual(paragraphsOf(m.html).slice(0, 2), ['שלום,', 'תדר פתוח. אפשר להתחיל.'], 'the line comes first');
    assert.match(m.html, /קיבלנו את התשלום על תדר בחשבון של Noa Shop\. המנוי שולם עד <span dir="ltr" style="white-space:nowrap">21\.11\.2026<\/span>\./);
    assert.ok(m.html.includes(`>${TEDER}</p>`), 'the address written out under the button');
    assert.ok(m.html.includes(INVOICE));
    assert.ok(m.html.includes('src="https://openfrequency.co.il/mail/openfrequency.png"'));
    assert.match(m.html, /OpenFrequency™ · <a href="https:\/\/openfrequency\.co\.il"/);
    // The inbox's preview is the payment's line, not the subject again.
    assert.match(m.html, /<div style="display:none[^"]*">קיבלנו את התשלום על תדר בחשבון של Noa Shop\. המנוי שולם עד 21\.11\.2026\.<\/div>/);
    // A transactional email, like the billing ones: no line to turn it off.
    assert.ok(!m.html.includes('/notifications'));
    assert.ok(!m.text.includes('/notifications'));
  } finally {
    await t.done();
  }
});

test('without TEDER_URL, the button leads to https://teder.openfrequency.co.il/', async () => {
  const t = await site({ env: { TEDER_URL: '' } });
  try {
    const [m] = await t.pay('teder');
    assert.deepEqual(buttonOf(m.html), { href: 'https://teder.openfrequency.co.il/', label: 'להיכנס לתדר' });
    assert.ok(m.text.includes('\n\nhttps://teder.openfrequency.co.il/\n\n'));
  } finally {
    await t.done();
  }
});

test('the first payment from a receipt\'s "התשלום הגיע": the same email to each owner, once; pressed again ("התשלום כבר נרשם"), none', async () => {
  const t = await site();
  try {
    t.sub('toran', { paid_until: '2026-10-28' }); // only Teder is owed: the receipt records Teder's month
    const id = await t.receipt();
    const form = await t.receiptForm(id);
    t.mails.length = 0;
    const r = await t.op.post(form.action, form.fields);
    assert.deepEqual([r.status, r.headers.location], [303, '/admin']);
    assert.equal(t.paidUntil(), '2026-11-21');
    assert.deepEqual(t.mails.map((m) => `${m.to} ${m.subject}`).sort(), OWNERS.map((o) => `${o} תדר פתוח. אפשר להתחיל`));
    const m = t.mails[0];
    assert.ok(m.text.includes('תדר פתוח. אפשר להתחיל.\n\nקיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.'));
    assert.equal(buttonOf(m.html).href, TEDER);

    t.mails.length = 0;
    const again = await t.op.post(form.action, form.fields);
    assert.deepEqual([again.status, again.headers.location], [303, `/admin/receipts/${id}`]);
    assert.equal(t.paidUntil(), '2026-11-21');
    assert.deepEqual(t.mails, [], 'nothing for the duplicate');
  } finally {
    await t.done();
  }
});

test('a receipt for both products: each owner gets one email for each, Teder\'s into Teder and Toran\'s into Toran', async () => {
  const t = await site();
  try {
    const id = await t.receipt();
    const form = await t.receiptForm(id);
    t.mails.length = 0;
    assert.equal((await t.op.post(form.action, form.fields)).status, 303);
    assert.deepEqual(
      t.mails.map((m) => `${m.to} ${m.subject} ${buttonOf(m.html).href}`).sort(),
      [`dan@example.com תדר פתוח. אפשר להתחיל ${TEDER}`, `dan@example.com תורן פתוח. אפשר להתחיל ${TORAN}`, `noa@example.com תדר פתוח. אפשר להתחיל ${TEDER}`, `noa@example.com תורן פתוח. אפשר להתחיל ${TORAN}`]
    );
  } finally {
    await t.done();
  }
});

test('"לא הגיע" emails nobody, and the console\'s form sent again ("התשלום כבר נרשם") emails nobody', async () => {
  const t = await site();
  try {
    const id = await t.receipt();
    const no = await t.receiptForm(id, 'not-paid');
    t.mails.length = 0;
    assert.equal((await t.op.post(no.action, no.fields)).status, 303);
    assert.equal(t.paidUntil(), null);
    assert.deepEqual(t.mails, []);

    const form = await t.payForm('teder');
    assert.equal((await t.op.post(form.action, form.fields)).status, 303);
    assert.equal(t.mails.length, 2);
    t.mails.length = 0;
    const again = await t.op.post(form.action, form.fields);
    assert.equal(again.status, 303);
    assert.equal(t.paidUntil(), '2026-11-21', 'one month');
    assert.deepEqual(t.mails, [], 'nothing for the duplicate');
  } finally {
    await t.done();
  }
});

// ---- a month paid while Teder was open already

test('a renewal paid ahead (a week left): "קיבלנו את התשלום על תדר", first "תדר ממשיך לעבוד כרגיל.", never "פתוח"; the button still into Teder', async () => {
  const t = await site();
  try {
    t.sub('teder', { paid_until: '2026-10-28' });
    const mails = await t.pay('teder');
    assert.equal(t.paidUntil(), '2026-11-28');
    assert.deepEqual(mails.map((m) => m.to).sort(), OWNERS);
    const m = mails[0];
    assert.equal(m.subject, 'קיבלנו את התשלום על תדר');
    assert.deepEqual(linesOf(m.text), ['שלום,', 'תדר ממשיך לעבוד כרגיל.', 'קיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 28.11.2026.', TEDER, INVOICE, 'OpenFrequency']);
    assert.doesNotMatch(m.subject + m.text + m.html, /פתוח|להתחיל/);
    assert.deepEqual(buttonOf(m.html), { href: TEDER, label: 'להיכנס לתדר' });
  } finally {
    await t.done();
  }
});

test('a renewal in the grace (the month ran out, Teder still works): the same "תדר ממשיך לעבוד כרגיל."', async () => {
  const t = await site();
  try {
    t.sub('teder', { paid_until: '2026-10-15' }); // fell due on 16.10, the grace runs to 29.10
    const [m] = await t.pay('teder');
    assert.equal(t.paidUntil(), '2026-11-21');
    assert.equal(m.subject, 'קיבלנו את התשלום על תדר');
    assert.deepEqual(linesOf(m.text).slice(0, 3), ['שלום,', 'תדר ממשיך לעבוד כרגיל.', 'קיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.']);
    assert.doesNotMatch(m.text, /פתוח/);
  } finally {
    await t.done();
  }
});

test('a payment for a complimentary product: it was open, so "ממשיך לעבוד"', async () => {
  const t = await site({ comp: true });
  try {
    const [m] = await t.pay('teder');
    assert.equal(m.subject, 'קיבלנו את התשלום על תדר');
    assert.equal(linesOf(m.text)[1], 'תדר ממשיך לעבוד כרגיל.');
  } finally {
    await t.done();
  }
});

test('a payment after Teder stopped (the grace over): "תדר פתוח שוב. אפשר להמשיך"', async () => {
  const t = await site();
  try {
    t.sub('teder', { paid_until: '2026-09-01' }); // the grace ended on 15.9
    const mails = await t.pay('teder');
    assert.deepEqual(mails.map((m) => m.to).sort(), OWNERS);
    const m = mails[0];
    assert.equal(m.subject, 'תדר פתוח שוב. אפשר להמשיך');
    assert.deepEqual(linesOf(m.text), ['שלום,', 'תדר פתוח שוב. אפשר להמשיך.', 'קיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.', TEDER, INVOICE, 'OpenFrequency']);
    assert.deepEqual(buttonOf(m.html), { href: TEDER, label: 'להיכנס לתדר' });
  } finally {
    await t.done();
  }
});

// ---- a payment that does not open it

test('a payment the product stays closed after (cancelled and past its last day, or turned off): the email as it was, to the account, never "פתוח"', async () => {
  const t = await site();
  try {
    t.sub('teder', { paid_until: '2026-10-10', ends_on: '2026-10-10', cancelled_at: '2026-10-01T10:00:00.000Z' });
    const [m] = await t.pay('teder');
    assert.equal(m.subject, 'קיבלנו את התשלום על תדר');
    assert.deepEqual(linesOf(m.text), ['שלום,', 'קיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.', INVOICE, ACCOUNT, 'OpenFrequency']);
    assert.deepEqual(buttonOf(m.html), { href: ACCOUNT, label: 'לדף הראשי' });
    assert.doesNotMatch(m.subject + m.text + m.html, /פתוח|ממשיך|להתחיל/);

    t.db.run("UPDATE workspace_products SET enabled = 0 WHERE workspace_id = ? AND product = 'toran'", t.ws.id);
    const [off] = await t.pay('toran');
    assert.equal(off.subject, 'קיבלנו את התשלום על תורן');
    assert.deepEqual(buttonOf(off.html), { href: ACCOUNT, label: 'לדף הראשי' });
    assert.doesNotMatch(off.text, /פתוח|ממשיך/);
  } finally {
    await t.done();
  }
});

// ---- Toran

test("Toran's first payment: \"תורן פתוח. אפשר להתחיל\", its button into Toran (TORAN_URL); a renewal \"תורן ממשיך לעבוד כרגיל.\"", async () => {
  const t = await site();
  try {
    const mails = await t.pay('toran');
    assert.deepEqual(mails.map((m) => m.to).sort(), OWNERS);
    const m = mails[0];
    assert.equal(m.subject, 'תורן פתוח. אפשר להתחיל');
    assert.deepEqual(linesOf(m.text), ['שלום,', 'תורן פתוח. אפשר להתחיל.', 'קיבלנו את התשלום על תורן בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.', TORAN, INVOICE, 'OpenFrequency']);
    assert.deepEqual(buttonOf(m.html), { href: TORAN, label: 'להיכנס לתורן' });
    assert.ok(!m.html.includes(TEDER));

    const [next] = await t.pay('toran');
    assert.equal(next.subject, 'קיבלנו את התשלום על תורן');
    assert.equal(linesOf(next.text)[1], 'תורן ממשיך לעבוד כרגיל.');
  } finally {
    await t.done();
  }
});

// ---- what the customer typed

test("the business's name is escaped in the HTML and made one line, in every variant", async () => {
  const name = 'Noa <b>"Shop"</b> & <img src=x onerror=alert(1)>‮';
  const t = await site({ name });
  try {
    const [first] = await t.pay('teder');
    t.sub('toran', { paid_until: '2026-10-28' });
    const [renewal] = await t.pay('toran');
    for (const m of [first, renewal]) {
      assert.ok(m.html.includes('Noa &lt;b&gt;&quot;Shop&quot;&lt;/b&gt; &amp; &lt;img src=x onerror=alert(1)&gt;'), m.html);
      assert.ok(!/<b>|<img src=x/.test(m.html), 'no markup of theirs');
      assert.ok(!m.html.includes('‮') && !m.text.includes('‮') && !m.subject.includes('‮'), 'no bidi override');
    }
  } finally {
    await t.done();
  }
});

// ---- the pure parts

test('paidOpening(): what the payment did, from the access just before and just after it', () => {
  const at = (rows) => accessOf({ enabled: true, ...rows }, '2026-10-22');
  const after = at({ paidUntil: '2026-11-21' });
  assert.equal(paidOpening(at({}), after), 'first', 'never paid: opened');
  assert.equal(paidOpening(at({ paidUntil: '2026-09-01' }), after), 'again', 'stopped after its grace: opened again');
  assert.equal(paidOpening(at({ paidUntil: '2026-10-28' }), at({ paidUntil: '2026-11-28' })), 'on', 'paid ahead: goes on');
  assert.equal(paidOpening(at({ paidUntil: '2026-10-15' }), after), 'on', 'in its grace: goes on');
  assert.equal(paidOpening(at({ comp: true }), at({ comp: true, paidUntil: '2026-11-21' })), 'on', 'complimentary: goes on');
  assert.equal(paidOpening(at({ paidUntil: '2026-10-10', endsOn: '2026-10-10' }), at({ paidUntil: '2026-11-21', endsOn: '2026-10-10' })), null, 'cancelled and ended: not open');
  assert.equal(paidOpening(at({ paidUntil: '2026-10-28', endsOn: '2026-10-28' }), at({ paidUntil: '2026-11-28', endsOn: '2026-10-28' })), null, 'cancelled, still running: said as before');
  assert.equal(paidOpening(accessOf({ enabled: false }), accessOf({ enabled: false, paidUntil: '2026-11-21' })), null, 'off: not open');
  assert.equal(paidOpening(null, null), null);
});

test('paidMail() without a product link, or with no opening, is the email as it was', () => {
  const was = paidMail('noa@example.com', { business: 'Noa Shop', product: 'teder', until: '2026-11-21', link: ACCOUNT });
  assert.equal(was.subject, 'קיבלנו את התשלום על תדר');
  assert.deepEqual(linesOf(was.text), ['שלום,', 'קיבלנו את התשלום על תדר בחשבון של Noa Shop. המנוי שולם עד 21.11.2026.', INVOICE, ACCOUNT, 'OpenFrequency']);
  const noLink = paidMail('noa@example.com', { business: 'Noa Shop', product: 'teder', until: '2026-11-21', link: ACCOUNT, opening: 'first' });
  assert.deepEqual([noLink.subject, noLink.text], [was.subject, was.text]);
});

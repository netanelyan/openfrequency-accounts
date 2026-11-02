import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { advance, now, setNow } from '../src/core/clock.js';
import { ensureSubscription, payMonth, setSubscription } from '../src/accounts/subscriptions.js';
import { payCodeFor } from '../src/accounts/pay.js';
import { MORNING_URLS } from '../src/accounts/morning.js';

// Recording a payment on /admin happens once for each form (the owner's audit, 2026-11-02, item 2: "A double-click or
// a resend of the same form records one month, not two."). Both places that record one are here: the console's
// "התקבל תשלום לחודש" (POST /admin/workspaces/<id>/subscription/pay) and a receipt's "התשלום הגיע"
// (POST /admin/receipts/<id>/paid). The same form sent twice, at once (a double click) or later (the browser sending
// it again, back and send), records one month, emails each owner once, asks Morning for one invoice and writes one
// audit entry; the second answer is "התשלום כבר נרשם". A request without the form's token is refused within 60
// seconds of the last month for that product. Two payments meant as two (the next month from the page drawn again,
// another product, another workspace) both record, at the same moment too.

const T0 = '2026-10-22T10:00:00.000Z';
const ALREADY = 'התשלום כבר נרשם.';
const PAID_SUBJECT = /^קיבלנו את התשלום על /;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a picture')]);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Morning, slow on purpose (each answer `delayMs` late), so a second press arrives while the first one waits on it. */
function fakeMorning({ delayMs = 30 } = {}) {
  const issued = [];
  const fetch = async (url, init = {}) => {
    await new Promise((r) => setTimeout(r, delayMs));
    const u = new URL(url);
    if (u.href === MORNING_URLS.production.token) return json(200, { accessToken: 'tok-for-tests-only', tokenType: 'Bearer', expiresAt: Math.floor(now() / 1000) + 3600 });
    if (u.pathname === '/api/v1/documents/info') return json(200, { exemption: false, vatRate: 0.18 });
    if (u.pathname === '/api/v1/documents' && init.method === 'POST') {
      issued.push(JSON.parse(init.body));
      return json(201, { id: `doc-${issued.length}`, number: String(40000 + issued.length), url: { he: `https://www.greeninvoice.co.il/doc/${issued.length}` } });
    }
    return new Response('no', { status: 404 });
  };
  return { fetch, issued };
}

async function site({ morning = null } = {}) {
  const h = tempHome();
  setNow(T0);
  const env = {
    OF_PAYMENT_METHOD: 'העברה בנקאית לחשבון 12-345-678901',
    OF_ASSISTANT_WA: '972500000200',
    OF_SIGNUP_NOTIFY: 'boss@example.com',
    ...(morning ? { OF_MORNING_CLIENT_ID: 'morning-id-for-tests', OF_MORNING_CLIENT_SECRET: 'morning-secret-for-tests-only' } : {}),
  };
  const s = await startSite(h.db, { env, ...(morning ? { morningFetch: morning.fetch } : {}) });
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder', 'toran'], members: { 'noa@example.com': 'client_owner', 'dan@example.com': 'client_owner' } });
  for (const p of ['teder', 'toran']) ensureSubscription(h.db, ws.id, p, '2026-10-22');
  const other = makeWorkspace(h.db, 'ron-studio', { name: 'Ron Studio', products: ['teder'], members: { 'ron@example.com': 'client_owner' } });
  ensureSubscription(h.db, other.id, 'teder', '2026-10-22');
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'Admin' });
  const op = signedIn(s, h.db, admin);
  const receipt = async (workspaceId = ws.id) => {
    const r = await s.owners('POST', '/internal/pay/receipt', { code: payCodeFor(h.db, workspaceId).code, phone: '972500000123', file: { name: 'shot.png', type: 'image/png', data: PNG.toString('base64') } });
    assert.equal(r.status, 201, r.body);
    return r.json.id;
  };
  return { ...h, ...s, ws, other, admin, op, morning, receipt, done: async () => (await s.close(), h.cleanup()) };
}

/** Every form on a page that posts, with its hidden fields as the browser would send them. */
const forms = (page) =>
  [...page.matchAll(/<form method="post" action="([^"]+)"[^>]*>([^]*?)<\/form>/g)].map((m) => ({
    action: m[1],
    fields: Object.fromEntries([...m[2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((x) => [x[1], x[2]])),
  }));
/** The console's "התקבל תשלום לחודש" for one product of a workspace, as the page draws it now. */
const payForm = (page, wsId, product) => {
  const f = forms(page).find((x) => x.action === `/admin/workspaces/${wsId}/subscription/pay` && x.fields.product === product);
  assert.ok(f, `no payment button for ${product} of workspace ${wsId}`);
  return f;
};
const receiptForm = (page, id) => {
  const f = forms(page).find((x) => x.action === `/admin/receipts/${id}/paid`);
  assert.ok(f, `no "התשלום הגיע" on receipt ${id}`);
  return f;
};
/** The one-request message a response left for the next page (the flash cookie), or ''. */
const flashOf = (res) => {
  const c = [].concat(res.headers['set-cookie'] || []).find((x) => /^(__Host-)?of_flash=[^;]/.test(x));
  return c ? decodeURIComponent(c.slice(c.indexOf('=') + 1, c.indexOf(';'))).replace(/^!/, '') : '';
};
const paidUntil = (t, wsId, product = 'teder') => t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ? AND product = ?', wsId, product).paid_until;
const audits = (t, action) => t.db.get('SELECT COUNT(*) AS n FROM audit WHERE action = ?', action).n;
const paidMails = (t) => t.mails.filter((m) => PAID_SUBJECT.test(m.subject));

// ---- the console's "התקבל תשלום לחודש"

test('the console\'s button sent twice, one after the other (a double click, the browser sending it again): one month, each owner told once, one audit entry; the second says "התשלום כבר נרשם" on the console', async () => {
  const t = await site();
  try {
    const page = (await t.op.get('/admin/accounts')).body;
    const form = payForm(page, t.ws.id, 'teder');
    t.mails.length = 0;
    const first = await t.op.post(form.action, form.fields);
    assert.deepEqual([first.status, first.headers.location], [303, '/admin/accounts']);
    assert.equal(flashOf(first), 'Noa Shop: תדר שולם עד 21.11.2026.');
    const again = await t.op.post(form.action, form.fields);
    assert.deepEqual([again.status, again.headers.location], [303, '/admin/accounts']);
    assert.equal(flashOf(again), `${ALREADY} Noa Shop: תדר שולם עד 21.11.2026.`);
    // Where the operator sees it: the console's own line at the top, in its usual look.
    const shown = (await t.op.get('/admin/accounts')).body;
    assert.ok(shown.includes(`<p class="flash" role="status">${ALREADY} Noa Shop: תדר שולם עד 21.11.2026.</p>`), shown.slice(0, 3000));

    assert.equal(paidUntil(t, t.ws.id), '2026-11-21', 'one month, not two');
    assert.deepEqual(paidMails(t).map((m) => m.to).sort(), ['dan@example.com', 'noa@example.com']);
    assert.equal(audits(t, 'subscription_paid'), 1);
  } finally {
    await t.done();
  }
});

test('the console\'s button double-clicked (two requests at once): one month, one email to each owner, one audit entry; one answer is the payment, the other "התשלום כבר נרשם"', async () => {
  const t = await site();
  try {
    const form = payForm((await t.op.get('/admin/accounts')).body, t.ws.id, 'teder');
    t.mails.length = 0;
    const answers = await Promise.all([t.op.post(form.action, form.fields), t.op.post(form.action, form.fields)]);
    assert.deepEqual(answers.map((r) => [r.status, r.headers.location]), [[303, '/admin/accounts'], [303, '/admin/accounts']]);
    assert.deepEqual(answers.map(flashOf).sort(), [`${ALREADY} Noa Shop: תדר שולם עד 21.11.2026.`, 'Noa Shop: תדר שולם עד 21.11.2026.'].sort());
    assert.equal(paidUntil(t, t.ws.id), '2026-11-21');
    assert.equal(paidMails(t).length, 2);
    assert.equal(audits(t, 'subscription_paid'), 1);
  } finally {
    await t.done();
  }
});

test('the same form sent again later (back, then send) finds its token used, even when the date it carries is right again: nothing recorded', async () => {
  const t = await site();
  try {
    const form = payForm((await t.op.get('/admin/accounts')).body, t.ws.id, 'teder');
    assert.match(form.fields.once ?? '', /^[A-Za-z0-9_-]{22}$/, 'a one-time token rides with the button');
    assert.equal((await t.op.post(form.action, form.fields)).status, 303);
    assert.equal(paidUntil(t, t.ws.id), '2026-11-21');
    // The operator takes the month back by hand (it went to the wrong business), so "שולם עד" is empty again, the
    // day the old page carries. Ten minutes on, the browser sends the old form again: refused by its token.
    setSubscription(t.db, t.ws.id, 'teder', { monthly: '790', setup: '1490', vat: 'excluded', started_on: '2026-10-22', paid_until: '', ends_on: '' }, { by: t.admin });
    advance(10 * 60_000);
    t.mails.length = 0;
    const again = await t.op.post(form.action, form.fields);
    assert.deepEqual([again.status, again.headers.location, flashOf(again)], [303, '/admin/accounts', ALREADY]);
    assert.equal(paidUntil(t, t.ws.id), null);
    assert.equal(paidMails(t).length, 0);
    assert.equal(audits(t, 'subscription_paid'), 1);
    // The token is kept as its SHA-256 only, like every token here.
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM paid_months WHERE once_hash = ?', form.fields.once).n, 0);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM paid_months WHERE once_hash IS NOT NULL').n, 1);
    // The page as it is drawn now has a new token: that press records.
    const fresh = payForm((await t.op.get('/admin/accounts')).body, t.ws.id, 'teder');
    assert.notEqual(fresh.fields.once, form.fields.once);
    assert.equal((await t.op.post(fresh.action, fresh.fields)).status, 303);
    assert.equal(paidUntil(t, t.ws.id), '2026-11-21');
    assert.equal(audits(t, 'subscription_paid'), 2);
  } finally {
    await t.done();
  }
});

test('a request without the form\'s token (a script, an old page) twice within 60 seconds: one month, "התשלום כבר נרשם"; a minute on, it records', async () => {
  const t = await site();
  try {
    await t.op.get('/admin/accounts');
    t.mails.length = 0;
    const action = `/admin/workspaces/${t.ws.id}/subscription/pay`;
    assert.equal((await t.op.post(action, { product: 'teder' })).status, 303);
    advance(59_000);
    const again = await t.op.post(action, { product: 'teder' });
    assert.deepEqual([again.status, again.headers.location, flashOf(again)], [303, '/admin/accounts', `${ALREADY} Noa Shop: תדר שולם עד 21.11.2026.`]);
    assert.equal(paidUntil(t, t.ws.id), '2026-11-21');
    assert.equal(paidMails(t).length, 2);
    assert.equal(audits(t, 'subscription_paid'), 1);
    advance(1_000);
    assert.equal(flashOf(await t.op.post(action, { product: 'teder' })), 'Noa Shop: תדר שולם עד 21.12.2026.');
    assert.equal(paidUntil(t, t.ws.id), '2026-12-21');
  } finally {
    await t.done();
  }
});

test('payMonth itself: a token records once; without a token or the date the page showed, not again within 60 seconds of the last month of that product', () => {
  const h = tempHome();
  setNow(T0);
  try {
    const ws = makeWorkspace(h.db, 'noa-shop', { products: ['teder', 'toran'] });
    const already = (e) => e.code === 'already_paid';
    const once = 'tok_for_tests_only_0001';
    assert.equal(payMonth(h.db, ws.id, 'teder', { by: null, once }), '2026-11-21');
    assert.throws(() => payMonth(h.db, ws.id, 'teder', { by: null, once }), already);
    assert.throws(() => payMonth(h.db, ws.id, 'teder', { by: null, once, expect: '2026-11-21' }), already, 'the token decides even when the date is right');
    // Another token with the date the page showed: the next month, at the same moment.
    assert.equal(payMonth(h.db, ws.id, 'teder', { by: null, once: 'tok_for_tests_only_0002', expect: '2026-11-21' }), '2026-12-21');
    // Neither: within 60 seconds of the last month, refused; at 60 seconds, recorded.
    assert.throws(() => payMonth(h.db, ws.id, 'teder', { by: null }), already);
    advance(59_999);
    assert.throws(() => payMonth(h.db, ws.id, 'teder', { by: null }), already);
    advance(1);
    assert.equal(payMonth(h.db, ws.id, 'teder', { by: null }), '2027-01-21');
    // Another product, at the same moment: its own month.
    assert.equal(payMonth(h.db, ws.id, 'toran', { by: null }), '2026-11-21');
    // Each month recorded is kept: four for Teder, one for Toran.
    assert.deepEqual(h.db.all('SELECT product, paid_until FROM paid_months WHERE workspace_id = ? ORDER BY id', ws.id).map((r) => `${r.product} ${r.paid_until}`), ['teder 2026-11-21', 'teder 2026-12-21', 'teder 2027-01-21', 'toran 2026-11-21']);
    assert.equal(h.db.get("SELECT COUNT(*) AS n FROM audit WHERE action = 'subscription_paid'").n, 4);
  } finally {
    h.cleanup();
  }
});

// ---- a receipt's "התשלום הגיע"

test('"התשלום הגיע" double-clicked while Morning is slow: one month for each product, one invoice, each owner told once, one audit entry each; the other answer "התשלום כבר נרשם" on the receipt\'s page', async () => {
  const morning = fakeMorning();
  const t = await site({ morning });
  try {
    const id = await t.receipt();
    const form = receiptForm((await t.op.get(`/admin/receipts/${id}`)).body, id);
    t.mails.length = 0;
    const answers = await Promise.all([t.op.post(form.action, form.fields), t.op.post(form.action, form.fields)]);
    assert.deepEqual(answers.map((r) => [r.status, r.headers.location]).sort(), [[303, '/admin'], [303, `/admin/receipts/${id}`]]);
    const dup = answers.find((r) => r.headers.location === `/admin/receipts/${id}`);
    assert.equal(flashOf(dup), ALREADY);

    assert.deepEqual([paidUntil(t, t.ws.id, 'teder'), paidUntil(t, t.ws.id, 'toran')], ['2026-11-21', '2026-11-21'], 'one month each, not two');
    assert.equal(morning.issued.length, 1, 'one invoice');
    assert.deepEqual(paidMails(t).map((m) => `${m.to} ${m.subject}`).sort(), ['dan@example.com קיבלנו את התשלום על תדר', 'dan@example.com קיבלנו את התשלום על תורן', 'noa@example.com קיבלנו את התשלום על תדר', 'noa@example.com קיבלנו את התשלום על תורן']);
    assert.deepEqual([audits(t, 'pay_receipt_paid'), audits(t, 'subscription_paid'), audits(t, 'morning_issued')], [1, 2, 1]);

    // The receipt's page: decided once, its one invoice. (Both answers left a line for the next page, and the pretend
    // browser keeps whichever came last; the next test reads the line on the page.)
    const page = (await t.op.get(`/admin/receipts/${id}`)).body;
    assert.match(page, /סימנתם ב-22\.10\.2026, 13:00 שהתשלום הגיע\./);
    assert.match(page, /Morning הפיק חשבונית מס קבלה 40001/);
    assert.doesNotMatch(page, /40002/);
  } finally {
    await t.done();
  }
});

test('"התשלום הגיע" sent again two minutes later (back, then send): nothing recorded, no second invoice or email, "התשלום כבר נרשם"', async () => {
  const morning = fakeMorning({ delayMs: 0 });
  const t = await site({ morning });
  try {
    const id = await t.receipt();
    const form = receiptForm((await t.op.get(`/admin/receipts/${id}`)).body, id);
    assert.equal((await t.op.post(form.action, form.fields)).headers.location, '/admin');
    advance(2 * 60_000);
    t.mails.length = 0;
    const again = await t.op.post(form.action, form.fields);
    assert.deepEqual([again.status, again.headers.location, flashOf(again)], [303, `/admin/receipts/${id}`, ALREADY]);
    // Where the operator sees it: the receipt's page, the line at the top in its usual look, above what was decided.
    const page = (await t.op.get(`/admin/receipts/${id}`)).body;
    assert.ok(page.includes(`<p class="flash" role="status">${ALREADY}</p>\n<section class="card receipt">`), page.slice(0, 4000));
    assert.match(page, /סימנתם ב-22\.10\.2026, 13:00 שהתשלום הגיע\./);
    assert.deepEqual([paidUntil(t, t.ws.id, 'teder'), paidUntil(t, t.ws.id, 'toran')], ['2026-11-21', '2026-11-21']);
    assert.equal(morning.issued.length, 1);
    assert.equal(paidMails(t).length, 0);
    assert.deepEqual([audits(t, 'pay_receipt_paid'), audits(t, 'subscription_paid'), audits(t, 'morning_issued')], [1, 2, 1]);
    // "לא הגיע" pressed afterwards is not a payment: it says the receipt was decided, and changes nothing.
    const other = await t.op.post(`/admin/receipts/${id}/not-paid`, {});
    assert.equal(other.status, 409);
    assert.match(other.body, /כבר החלטתם על האישור הזה, אז שום דבר לא השתנה\./);
    assert.equal(t.db.get('SELECT decision FROM pay_receipts WHERE id = ?', id).decision, 'paid');
  } finally {
    await t.done();
  }
});

test('the same transfer sent to Toran twice (two receipts, both pages open), "התשלום הגיע" on each within a minute: one month, one invoice, the second "התשלום כבר נרשם" and still waiting', async () => {
  const morning = fakeMorning({ delayMs: 0 });
  const t = await site({ morning });
  try {
    const a = await t.receipt();
    const b = await t.receipt();
    const formA = receiptForm((await t.op.get(`/admin/receipts/${a}`)).body, a);
    const formB = receiptForm((await t.op.get(`/admin/receipts/${b}`)).body, b);
    t.mails.length = 0;
    assert.equal((await t.op.post(formA.action, formA.fields)).headers.location, '/admin');
    advance(20_000);
    const second = await t.op.post(formB.action, formB.fields);
    assert.equal(second.status, 409);
    assert.ok(second.body.includes(`<p class="error" role="alert">${ALREADY}</p>`), second.body);
    assert.match(second.body, /<p class="warn">מאז שהאישור הגיע נרשם תשלום על תדר, ועכשיו הוא שולם עד 21\.11\.2026\.<\/p>/);
    assert.deepEqual([paidUntil(t, t.ws.id, 'teder'), paidUntil(t, t.ws.id, 'toran')], ['2026-11-21', '2026-11-21']);
    assert.equal(morning.issued.length, 1);
    assert.equal(paidMails(t).length, 4, 'two owners, two products, once');
    assert.equal(audits(t, 'subscription_paid'), 2);
    assert.equal(t.db.get('SELECT decided_at FROM pay_receipts WHERE id = ?', b).decided_at, null);
  } finally {
    await t.done();
  }
});

// ---- two payments meant as two

test('two payments meant as two both record, at the same moment: the next month from the page drawn again, another product, another workspace, two receipts of two businesses', async () => {
  const morning = fakeMorning();
  const t = await site({ morning });
  try {
    t.mails.length = 0;
    // The customer paid two months: pressed, the console drawn again, pressed again.
    let page = (await t.op.get('/admin/accounts')).body;
    let f = payForm(page, t.ws.id, 'teder');
    assert.equal(flashOf(await t.op.post(f.action, f.fields)), 'Noa Shop: תדר שולם עד 21.11.2026.');
    page = (await t.op.get('/admin/accounts')).body;
    f = payForm(page, t.ws.id, 'teder');
    assert.equal(f.fields.expect, '2026-11-21');
    assert.equal(flashOf(await t.op.post(f.action, f.fields)), 'Noa Shop: תדר שולם עד 21.12.2026.');
    assert.equal(paidUntil(t, t.ws.id, 'teder'), '2026-12-21');

    // Another product of the same business, and another business, from one page, at once.
    page = (await t.op.get('/admin/accounts')).body;
    const toran = payForm(page, t.ws.id, 'toran');
    const ron = payForm(page, t.other.id, 'teder');
    const both = await Promise.all([t.op.post(toran.action, toran.fields), t.op.post(ron.action, ron.fields)]);
    assert.deepEqual(both.map(flashOf).sort(), ['Noa Shop: תורן שולם עד 21.11.2026.', 'Ron Studio: תדר שולם עד 21.11.2026.'].sort());
    assert.deepEqual([paidUntil(t, t.ws.id, 'toran'), paidUntil(t, t.other.id, 'teder')], ['2026-11-21', '2026-11-21']);
    assert.equal(audits(t, 'subscription_paid'), 4);
    assert.equal(paidMails(t).length, 2 + 2 + 2 + 1);

    // Two businesses' receipts, decided at once: both recorded, an invoice for each.
    const [gal, tal] = ['gal-bakery', 'tal-studio'].map((slug) => {
      const w = makeWorkspace(t.db, slug, { name: slug, products: ['teder'], members: { [`${slug}@example.com`]: 'client_owner' } });
      ensureSubscription(t.db, w.id, 'teder', '2026-10-22');
      return w;
    });
    const r1 = await t.receipt(gal.id);
    const r2 = await t.receipt(tal.id);
    const f1 = receiptForm((await t.op.get(`/admin/receipts/${r1}`)).body, r1);
    const f2 = receiptForm((await t.op.get(`/admin/receipts/${r2}`)).body, r2);
    const decided = await Promise.all([t.op.post(f1.action, f1.fields), t.op.post(f2.action, f2.fields)]);
    assert.deepEqual(decided.map((r) => [r.status, r.headers.location]), [[303, '/admin'], [303, '/admin']]);
    assert.deepEqual([paidUntil(t, gal.id), paidUntil(t, tal.id)], ['2026-11-21', '2026-11-21']);
    assert.equal(morning.issued.length, 2);
    assert.equal(audits(t, 'pay_receipt_paid'), 2);
    assert.equal(audits(t, 'subscription_paid'), 6);
  } finally {
    await t.done();
  }
});

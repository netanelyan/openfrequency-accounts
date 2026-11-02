import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { makeWorkspace, tempHome } from './helpers.js';
import { startSite } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ensureSubscription, payMonth, setSubscription } from '../src/accounts/subscriptions.js';
import { cancelSubscription, setComp } from '../src/accounts/entitlement.js';
import { setDisabled, setProduct } from '../src/accounts/workspaces.js';
import { amountDue, PAY_AHEAD_DAYS } from '../src/accounts/billing.js';
import { checkFile, openPayCode, PAY_CODE, payCodeFor, PayError, sniff } from '../src/accounts/pay.js';
import { eraseWorkspace } from '../src/accounts/erase.js';

// Paying over WhatsApp, accounts' half (src/accounts/pay.js, docs/internal-pay.md): the workspace's payment code (made,
// given out again, ended), what a workspace owes now (billing.js amountDue(), the one answer /setup's card and Toran
// both give), and the two internal routes Toran calls: GET /internal/pay, what a code's workspace owes, and POST
// /internal/pay/receipt, the picture of a transfer, kept for the operator, who is emailed a link to it.

const HOW = 'העברה בנקאית לחשבון 12-345-678901';
const T0 = '2026-10-22T10:00:00.000Z'; // 13:00 in Israel

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('the rest of a picture')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF a picture')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 a picture')]);
const PDF = Buffer.from('%PDF-1.7\n% a transfer\n%%EOF\n');
const GIF = Buffer.from('GIF89a a picture');
const file = (data, type = 'image/png', name = 'IMG-20261022-WA0003.png') => ({ name, type, data: Buffer.from(data).toString('base64') });

function world() {
  const h = tempHome();
  setNow(T0);
  const noa = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
  ensureSubscription(h.db, noa.id, 'teder', '2026-10-22', 'small');
  return { ...h, noa };
}

// ---- the code

test('a payment code: PAY- and six letters, given out again while 14 days or more are left on it, a new one after; any letter case opens it', () => {
  const t = world();
  try {
    const first = payCodeFor(t.db, t.noa.id);
    assert.match(first.code, PAY_CODE);
    assert.equal(first.expiresAt, '2026-12-21T10:00:00.000Z', '60 days');
    assert.deepEqual(payCodeFor(t.db, t.noa.id), first, 'the same code while it has 14 days or more');
    setNow('2026-12-07T10:00:00.000Z'); // exactly 14 days left
    assert.deepEqual(payCodeFor(t.db, t.noa.id), first);
    setNow('2026-12-07T10:00:01.000Z'); // less than 14
    const second = payCodeFor(t.db, t.noa.id);
    assert.notEqual(second.code, first.code);
    assert.equal(second.expiresAt, '2027-02-05T10:00:01.000Z');
    // Not used up, and the older one still opens until its own end.
    assert.equal(openPayCode(t.db, first.code).workspace.id, t.noa.id);
    assert.deepEqual(openPayCode(t.db, ` ${first.code.toLowerCase()} `), { code: first.code, expiresAt: first.expiresAt, workspace: { id: t.noa.id, name: 'Noa Shop' } });
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes').n, 2);
    // Another workspace has its own.
    const other = makeWorkspace(t.db, 'other-shop', { products: ['teder'] });
    assert.notEqual(payCodeFor(t.db, other.id).code, second.code);

    const refused = (code) => {
      try {
        openPayCode(t.db, code);
        return null;
      } catch (e) {
        assert.ok(e instanceof PayError);
        return e.code;
      }
    };
    for (const code of ['', 'PAY-', 'PAY-ABCDEF', 'LINK-ABCDEF', 'PAY-ABCDE0', `${second.code}X`, null]) assert.equal(refused(code), 'unknown_code', String(code));
    setNow('2026-12-21T10:00:00.000Z');
    assert.equal(refused(first.code), 'expired', 'at the moment it ends');
    assert.equal(refused(second.code), null);
    setDisabled(t.db, t.noa.id, true, { by: null });
    assert.equal(refused(second.code), 'unknown_code', 'a disabled workspace');
    setDisabled(t.db, t.noa.id, false, { by: null });
    eraseWorkspace(t.db, t.noa.id, { source: 'owner' });
    assert.equal(refused(second.code), 'unknown_code', 'a deleted workspace: its codes go with it');
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_codes WHERE workspace_id = ?', t.noa.id).n, 0);
  } finally {
    t.cleanup();
  }
});

// ---- what is owed

test('amountDue: the first payment is the month and the setup fee with VAT; then the month alone; nothing while paid, comp or off', () => {
  const t = world();
  try {
    const first = amountDue(t.db, t.noa.id);
    assert.deepEqual(first.items, [{ product: 'teder', productName: 'תדר', plan: 'small', monthly: 490, setup: 990, net: 1480, total: 1746.4, firstMonth: true }]);
    assert.deepEqual([first.net, first.vat, first.total, first.vatIncluded, first.monthsAfter], [1480, 266.4, 1746.4, false, 578.2]);
    assert.deepEqual(first.lines.map((l) => l.kind), ['owed']);

    // Both products, the full plan: each with its month and setup fee, the VAT rounded to the agora on each.
    setProduct(t.db, t.noa.id, 'toran', true, { by: null });
    ensureSubscription(t.db, t.noa.id, 'toran', '2026-10-22');
    setSubscription(t.db, t.noa.id, 'teder', { plan: 'full', monthly: '790', setup: '1490', vat: 'excluded', started_on: '2026-10-22' }, { by: null });
    const both = amountDue(t.db, t.noa.id);
    assert.deepEqual(both.items.map((i) => [i.product, i.productName, i.monthly, i.setup, i.net, i.total]), [['teder', 'תדר', 790, 1490, 2280, 2690.4], ['toran', 'תורן', 590, 990, 1580, 1864.4]]);
    assert.deepEqual([both.net, both.vat, both.total, both.monthsAfter], [3860, 694.8, 4554.8, 1628.4]);

    // Teder paid: Toran alone. Toran off: nothing, and nothing about it.
    payMonth(t.db, t.noa.id, 'teder', { by: null }); // paid until 21.11.2026
    assert.deepEqual(amountDue(t.db, t.noa.id).items.map((i) => i.product), ['toran']);
    setProduct(t.db, t.noa.id, 'toran', false, { by: null });
    const paid = amountDue(t.db, t.noa.id);
    assert.deepEqual([paid.items, paid.total, paid.net, paid.vat, paid.monthsAfter], [[], 0, 0, 0, null]);
    assert.deepEqual(paid.lines.map((l) => [l.product, l.kind, l.paidUntil]), [['teder', 'paid', '2026-11-21']]);

    // A week before it falls due, the month ahead, but only when asked for (Toran, the billing emails): the card shows today.
    assert.equal(PAY_AHEAD_DAYS, 7);
    for (const [at, ahead] of [['2026-11-14T10:00:00.000Z', []], ['2026-11-15T10:00:00.000Z', ['teder']], ['2026-11-21T10:00:00.000Z', ['teder']]]) {
      setNow(at);
      assert.deepEqual(amountDue(t.db, t.noa.id, undefined, { ahead: 7 }).items.map((i) => i.product), ahead, at);
      assert.deepEqual(amountDue(t.db, t.noa.id).items, [], `${at}, without ahead`);
    }
    const soon = amountDue(t.db, t.noa.id, undefined, { ahead: 7 });
    assert.deepEqual(soon.items, [{ product: 'teder', productName: 'תדר', plan: 'full', monthly: 790, setup: 0, net: 790, total: 932.2, firstMonth: false }]);
    assert.equal(soon.lines[0].kind, 'ahead');

    // Due, in its grace: the month, no setup fee.
    setNow('2026-11-25T10:00:00.000Z');
    const due = amountDue(t.db, t.noa.id);
    assert.deepEqual(due.items, [{ product: 'teder', productName: 'תדר', plan: 'full', monthly: 790, setup: 0, net: 790, total: 932.2, firstMonth: false }]);
    assert.deepEqual([due.lines[0].kind, due.lines[0].graceUntil, due.monthsAfter], ['due', '2026-12-06', null]);
    // The grace over: still the month alone, never the setup fee again.
    setNow('2026-12-08T10:00:00.000Z');
    assert.deepEqual(amountDue(t.db, t.noa.id).items.map((i) => [i.monthly, i.setup, i.firstMonth, i.total]), [[790, 0, false, 932.2]]);
    assert.equal(amountDue(t.db, t.noa.id).lines[0].kind, 'owed');

    // Complimentary: nothing. A price recorded with VAT in it: nothing added.
    setComp(t.db, t.noa.id, 'teder', true, { by: null });
    assert.deepEqual(amountDue(t.db, t.noa.id, undefined, { ahead: 7 }).items, []);
    setComp(t.db, t.noa.id, 'teder', false, { by: null });
    setSubscription(t.db, t.noa.id, 'teder', { plan: 'full', monthly: '500', setup: '', vat: 'included', started_on: '2026-10-22' }, { by: null });
    const inc = amountDue(t.db, t.noa.id);
    assert.deepEqual([inc.items[0].total, inc.net, inc.vat, inc.total, inc.vatIncluded], [500, 0, 0, 500, true]);
  } finally {
    t.cleanup();
  }
});

test('a receipt file: up to 5 MB of a JPEG, PNG, WebP or PDF, by its first bytes as well as the type it says', () => {
  assert.deepEqual([sniff(PNG), sniff(JPEG), sniff(WEBP), sniff(PDF), sniff(GIF), sniff(Buffer.alloc(0))], ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', null, null]);
  const code = (f) => {
    try {
      checkFile(f);
      return 'ok';
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(code(file(PNG)), 'ok');
  assert.equal(code(file(JPEG, 'image/jpg')), 'ok', 'image/jpg is image/jpeg');
  assert.equal(checkFile(file(JPEG, 'IMAGE/JPEG; charset=binary')).type, 'image/jpeg');
  assert.equal(code(file(WEBP, 'image/webp')), 'ok');
  assert.equal(code(file(PDF, 'application/pdf')), 'ok');
  assert.equal(code(file(JPEG, 'image/png')), 'bad_type', 'the bytes are not the type it says');
  assert.equal(code(file(Buffer.from('<html>'), 'application/pdf')), 'bad_type');
  assert.equal(code(file(GIF, 'image/gif')), 'bad_type');
  assert.equal(code(file(PNG, 'text/html')), 'bad_type');
  assert.equal(code(file(Buffer.alloc(0))), 'bad_type');
  assert.equal(code({ ...file(PNG), type: undefined }), 'bad_type');
  for (const bad of [null, 'x', [], {}, { data: 7 }, { type: 'image/png', data: '***' }, { type: 'image/png', data: 'A' }]) assert.equal(code(bad), 'bad', JSON.stringify(bad));
  const at = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]);
  assert.equal(code(file(at)), 'ok', 'exactly 5 MB');
  assert.equal(code(file(Buffer.concat([at, Buffer.alloc(1)]))), 'too_large');
  // The name: as WhatsApp gave it, without what could break a line or a path; else one made from the type.
  assert.equal(checkFile(file(PNG, 'image/png', '../x/"a‮b".png')).name, '..xab.png');
  assert.equal(checkFile(file(PDF, 'application/pdf', '')).name, 'receipt.pdf');
});

// ---- GET /internal/pay and POST /internal/pay/receipt

async function site(env = {}) {
  const t = world();
  const s = await startSite(t.db, { env: { OF_PAYMENT_METHOD: HOW, OF_SIGNUP_NOTIFY: 'boss@example.com, ops@example.com', ...env } });
  const pay = (code) => s.owners('GET', `/internal/pay?code=${encodeURIComponent(code)}`);
  const post = (body, headers) => s.owners('POST', '/internal/pay/receipt', body, headers);
  return { ...t, ...s, pay, post, done: async () => (await s.close(), t.cleanup()) };
}

test('GET /internal/pay: what the code\'s workspace owes, in numbers and in words, how to pay, and until when it is paid when nothing is owed', async () => {
  const t = await site();
  try {
    const { code } = payCodeFor(t.db, t.noa.id);
    const r = await t.pay(code.toLowerCase());
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(r.json, {
      code,
      expiresAt: '2026-12-21T10:00:00.000Z',
      workspace: { id: t.noa.id, name: 'Noa Shop' },
      items: [{ product: 'teder', productName: 'תדר', plan: 'small', monthly: 490, setup: 990, net: 1480, total: 1746.4, firstMonth: true }],
      net: 1480,
      vat: 266.4,
      total: 1746.4,
      vatIncluded: false,
      summary: ['תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 990 ₪ פעם אחת.', 'סך הכול לתשלום עכשיו: 1,746.40 ₪, כולל מע״מ (1,480 ₪ ועוד 266.40 ₪ מע״מ).'],
      payHow: HOW,
      paidThrough: null,
    });

    // Paid until 21.11: nothing owed, and the day it is paid until.
    payMonth(t.db, t.noa.id, 'teder', { by: null });
    const paid = (await t.pay(code)).json;
    assert.deepEqual([paid.items, paid.total, paid.summary, paid.paidThrough], [[], 0, [], '2026-11-21']);
    // A week before the next payment falls due, that month, with the day it starts.
    setNow('2026-11-15T10:00:00.000Z');
    const soon = (await t.pay(code)).json;
    assert.deepEqual([soon.items.map((i) => [i.product, i.monthly, i.setup, i.total, i.firstMonth]), soon.total, soon.paidThrough], [[['teder', 490, 0, 578.2, false]], 578.2, null]);
    assert.deepEqual(soon.summary, ['תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, על החודש שמתחיל ב-22.11.2026.', 'סך הכול לתשלום עכשיו: 578.20 ₪, כולל מע״מ (490 ₪ ועוד 88.20 ₪ מע״מ).']);
    // Complimentary: nothing, and no paid-until day to give.
    setComp(t.db, t.noa.id, 'teder', true, { by: null });
    assert.deepEqual(((r) => [r.items, r.paidThrough])((await t.pay(code)).json), [[], null]);

    assert.deepEqual([(await t.pay('PAY-ABCDEF')).status, (await t.pay('PAY-ABCDEF')).json], [404, { error: 'unknown_code' }]);
    assert.deepEqual((await t.pay('')).json, { error: 'unknown_code' });
    setDisabled(t.db, t.noa.id, true, { by: null });
    assert.deepEqual([(await t.pay(code)).status, (await t.pay(code)).json], [404, { error: 'unknown_code' }]);
    setDisabled(t.db, t.noa.id, false, { by: null });
    setNow('2026-12-21T10:00:00.000Z');
    assert.deepEqual([(await t.pay(code)).status, (await t.pay(code)).json], [410, { error: 'expired' }]);
  } finally {
    await t.done();
  }
  // Without the owner's payment details, payHow is null.
  const u = await site({ OF_PAYMENT_METHOD: '' });
  try {
    assert.equal((await u.pay(payCodeFor(u.db, u.noa.id).code)).json.payHow, null);
  } finally {
    await u.done();
  }
});

test('a cancelled product is never owed once it has stopped, by the customer or a last day on /admin; a cancellation still running is never asked for the month after its last day', async () => {
  const t = await site();
  try {
    // Paid until 21.11, then cancelled: it works to that day, and the week before it asks for nothing.
    payMonth(t.db, t.noa.id, 'teder', { by: null });
    cancelSubscription(t.db, t.noa.id, 'teder', { by: null });
    const { code } = payCodeFor(t.db, t.noa.id);
    setNow('2026-11-18T10:00:00.000Z');
    assert.deepEqual(amountDue(t.db, t.noa.id, undefined, { ahead: 7 }).items, []);
    const running = (await t.pay(code)).json;
    assert.deepEqual([running.items, running.total, running.summary, running.paidThrough], [[], 0, [], '2026-11-21']);
    // Its last day passed: ended, nothing owed now or ahead, the setup fee neither.
    setNow('2026-11-25T10:00:00.000Z');
    const after = amountDue(t.db, t.noa.id, undefined, { ahead: 7 });
    assert.deepEqual([after.items, after.total, after.lines.map((l) => [l.kind, l.lastDay])], [[], 0, [['ended', '2026-11-21']]]);
    const ended = (await t.pay(code)).json;
    assert.deepEqual([ended.items, ended.total, ended.summary, ended.paidThrough], [[], 0, [], null]);

    // Cancelled with nothing paid: it stopped that day, and nothing is owed, not even the setup fee.
    const gal = makeWorkspace(t.db, 'gal-shop', { name: 'Gal Shop', products: ['teder'] });
    ensureSubscription(t.db, gal.id, 'teder', '2026-11-25', 'small');
    assert.equal(amountDue(t.db, gal.id).total, 1746.4, 'owed before the cancellation');
    cancelSubscription(t.db, gal.id, 'teder', { by: null });
    assert.deepEqual(((d) => [d.items, d.lines[0].kind])(amountDue(t.db, gal.id, undefined, { ahead: 7 })), [[], 'ended']);
    assert.deepEqual((await t.pay(payCodeFor(t.db, gal.id).code)).json.items, []);

    // A last day set on /admin, past, with paid days after it: the same.
    const ron = makeWorkspace(t.db, 'ron-shop', { name: 'Ron Shop', products: ['teder'] });
    setSubscription(t.db, ron.id, 'teder', { plan: 'full', monthly: '790', setup: '1490', vat: 'excluded', started_on: '2026-10-01', paid_until: '2026-11-30', ends_on: '2026-11-20' }, { by: null });
    assert.deepEqual(((d) => [d.items, d.lines[0].kind])(amountDue(t.db, ron.id, undefined, { ahead: 7 })), [[], 'ended']);
    // ... and one still ahead (ends 28.11, paid to 30.11): working, and not asked for December.
    setSubscription(t.db, ron.id, 'teder', { plan: 'full', monthly: '790', setup: '1490', vat: 'excluded', started_on: '2026-10-01', paid_until: '2026-11-30', ends_on: '2026-11-28' }, { by: null });
    assert.deepEqual(((d) => [d.items, d.lines[0].kind])(amountDue(t.db, ron.id, undefined, { ahead: 7 })), [[], 'paid']);
  } finally {
    await t.done();
  }
});

test('POST /internal/pay/receipt: kept with what was owed, in the audit log without the code, and each operator address emailed one button to it', async () => {
  const t = await site();
  try {
    const { code } = payCodeFor(t.db, t.noa.id);
    const r = await t.post({ code: code.toLowerCase(), phone: '972500000123', file: file(PNG) });
    assert.equal(r.status, 201, r.body);
    assert.deepEqual(r.json, { id: 1, workspace: { id: t.noa.id, name: 'Noa Shop' } });
    const row = t.db.get('SELECT * FROM pay_receipts WHERE id = 1');
    assert.deepEqual([row.workspace_id, row.code, row.phone, row.created_at, row.name, row.type, row.size, row.decided_at, row.decision], [t.noa.id, code, '972500000123', T0, 'IMG-20261022-WA0003.png', 'image/png', PNG.length, null, null]);
    assert.ok(Buffer.from(row.file).equals(PNG));
    const kept = JSON.parse(row.items_json);
    assert.deepEqual([kept.total, kept.items.map((i) => i.product)], [1746.4, ['teder']]);
    const a = t.db.get("SELECT * FROM audit WHERE action = 'pay_receipt_received'");
    assert.equal(a.workspace_id, t.noa.id);
    assert.deepEqual(JSON.parse(a.detail_json), { receipt: 1, phone: '972500000123', type: 'image/png', size: PNG.length, total: 1746.4 });
    assert.ok(!a.detail_json.includes(code), 'never the code');

    assert.deepEqual(t.mails.map((m) => m.to), ['boss@example.com', 'ops@example.com']);
    const m = t.mails[0];
    assert.equal(m.subject, 'אישור העברה מ״Noa Shop״');
    assert.equal(m.link, 'https://accounts.openfrequency.co.il/admin/receipts/1');
    for (const line of ['עסק: Noa Shop', 'סכום: 1,746.40 ₪, כולל מע״מ', 'טלפון: 050-000-0123', 'מתי: 22.10.2026, 13:00', 'התשלום נרשם רק אחרי שלוחצים "התשלום הגיע" בדף של האישור.']) assert.ok(m.text.includes(line), line);
    assert.match(m.html, /<a href="https:\/\/accounts\.openfrequency\.co\.il\/admin\/receipts\/1"[^>]*>לבדוק ולאשר<\/a>/);
    assert.equal((m.html.match(/<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px/g) || []).length, 1, 'one button');
    assert.ok(!m.text.includes(PNG.toString('base64')), 'no file in it');

    // Every type it takes, an image/jpg written for image/jpeg, and nothing was owed: kept all the same.
    for (const [data, type] of [[JPEG, 'image/jpg'], [WEBP, 'image/webp'], [PDF, 'application/pdf']]) assert.equal((await t.post({ code, phone: '972500000123', file: file(data, type) })).status, 201, type);
    assert.equal(t.db.get('SELECT type FROM pay_receipts WHERE id = 2').type, 'image/jpeg');
    payMonth(t.db, t.noa.id, 'teder', { by: null });
    t.mails.length = 0;
    assert.equal((await t.post({ code, phone: '972500000123', file: file(Buffer.concat([PNG, Buffer.from(' next month')])) })).status, 201);
    assert.ok(t.mails[0].text.includes('סכום: כשהאישור הגיע, לא היה מה לשלם'), t.mails[0].text);
  } finally {
    await t.done();
  }
});

test('POST /internal/pay/receipt refuses: a bad phone 400, a bad body 400, an unknown or disabled code 404, an ended one 410, too large 413, a wrong type 415', async () => {
  const t = await site();
  try {
    const { code } = payCodeFor(t.db, t.noa.id);
    const ok = { code, phone: '972500000123', file: file(PNG) };
    const said = async (body, raw = false) => ((r) => [r.status, r.json])(await t.post(raw ? body : { ...ok, ...body }));
    for (const phone of ['+972500000123', '0500000123', '9725', 972500000123, undefined]) assert.deepEqual(await said({ phone }), [400, { error: 'bad_phone' }], String(phone));
    for (const f of [undefined, null, 'x', { type: 'image/png' }, { type: 'image/png', data: '%%%' }]) assert.deepEqual(await said({ file: f }), [400, { error: 'bad' }], JSON.stringify(f));
    assert.deepEqual(await said('not json', true), [400, { error: 'bad' }]);
    assert.deepEqual(await said('[1]', true), [400, { error: 'bad' }]);
    assert.deepEqual(await said({ code: 'PAY-ABCDEF' }), [404, { error: 'unknown_code' }]);
    assert.deepEqual(await said({ code: undefined }), [404, { error: 'unknown_code' }]);
    assert.deepEqual(await said({ file: file(GIF, 'image/gif') }), [415, { error: 'bad_type' }]);
    assert.deepEqual(await said({ file: file(JPEG, 'image/png') }), [415, { error: 'bad_type' }]);
    assert.deepEqual(await said({ file: file(Buffer.from('<?xml version="1.0"?><svg/>'), 'application/pdf') }), [415, { error: 'bad_type' }]);
    // Over 5 MB once decoded; and a body over 7,500,000 bytes is not read to its end.
    assert.deepEqual(await said({ file: file(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])) }), [413, { error: 'too_large' }]);
    assert.deepEqual(await said({ file: { type: 'image/png', data: 'A'.repeat(7_600_000) } }), [413, { error: 'too_large' }]);
    setDisabled(t.db, t.noa.id, true, { by: null });
    assert.deepEqual(await said({}), [404, { error: 'unknown_code' }]);
    setDisabled(t.db, t.noa.id, false, { by: null });
    setNow('2026-12-21T10:00:00.000Z');
    assert.deepEqual(await said({}), [410, { error: 'expired' }]);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_receipts').n, 0, 'none of them kept');
    assert.equal(t.mails.length, 0, 'nobody emailed');
  } finally {
    await t.done();
  }
});

test('five receipts from one code in an Israel day; the sixth is 429 until midnight in Israel', async () => {
  const t = await site();
  try {
    const { code } = payCodeFor(t.db, t.noa.id);
    // A picture of its own each time: the same one again is the receipt already kept (pay.js sameReceipt).
    let shots = 0;
    const send = () => t.post({ code, phone: '972500000123', file: file(Buffer.concat([PNG, Buffer.from(` ${++shots}`)])) });
    for (let i = 0; i < 5; i++) assert.equal((await send()).status, 201);
    assert.deepEqual(((r) => [r.status, r.json])(await send()), [429, { error: 'rate_limited' }]);
    // Another workspace's code is its own.
    const other = makeWorkspace(t.db, 'other-shop', { name: 'Other Shop', products: ['teder'] });
    assert.equal((await t.post({ code: payCodeFor(t.db, other.id).code, phone: '972500000124', file: file(PNG) })).status, 201);
    // 23:59 in Israel (UTC+3 until 25.10): still the 22nd. A minute later, the 23rd.
    setNow('2026-10-22T20:59:00.000Z');
    assert.equal((await send()).status, 429);
    setNow('2026-10-22T21:00:01.000Z');
    assert.equal((await send()).status, 201);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_receipts WHERE code = ?', code).n, 6);
  } finally {
    await t.done();
  }
});

test('both routes have the internal listener\'s locks: the token, a loopback Host, their method; 503 with no token; the public site knows neither', async () => {
  const t = await site();
  try {
    const { code } = payCodeFor(t.db, t.noa.id);
    const body = { code, phone: '972500000123', file: file(PNG) };
    for (const auth of ['Bearer wrong-token-wrong-token-wrong-token-x', 'Basic x', '']) {
      assert.deepEqual(((r) => [r.status, r.json])(await t.owners('GET', `/internal/pay?code=${code}`, null, { authorization: auth })), [401, { error: 'bad_token' }]);
      assert.deepEqual(((r) => [r.status, r.json])(await t.post(body, { authorization: auth })), [401, { error: 'bad_token' }]);
    }
    assert.deepEqual(((r) => [r.status, r.json])(await t.owners('GET', `/internal/pay?code=${code}`, null, { host: 'accounts.openfrequency.co.il' })), [403, { error: 'bad_host' }]);
    assert.deepEqual(((r) => [r.status, r.json])(await t.post(body, { host: 'evil.example' })), [403, { error: 'bad_host' }]);
    assert.deepEqual(((r) => [r.status, r.json])(await t.owners('POST', '/internal/pay', {})), [405, { error: 'method_not_allowed' }]);
    assert.deepEqual(((r) => [r.status, r.json])(await t.owners('GET', '/internal/pay/receipt')), [405, { error: 'method_not_allowed' }]);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM pay_receipts').n, 0);
    const pub = await new Promise((resolve) => request({ host: '127.0.0.1', port: t.s.port, path: `/internal/pay?code=${code}`, headers: { authorization: 'Bearer x' } }, (res) => (res.resume(), resolve(res.statusCode))).end());
    assert.equal(pub, 404);
  } finally {
    await t.done();
  }
  const u = await site({ OF_INTERNAL_TOKEN: '' });
  try {
    assert.deepEqual(((r) => [r.status, r.json])(await u.pay('PAY-ABCDEF')), [503, { error: 'not_configured' }]);
    assert.deepEqual(((r) => [r.status, r.json])(await u.post({})), [503, { error: 'not_configured' }]);
  } finally {
    await u.done();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { pathOf, startSite, tokenOf } from './site.js';
import { now, setNow } from '../src/core/clock.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { invoicesOf } from '../src/accounts/invoices.js';
import { parseMultipart } from '../src/web/app.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';

// Invoices: the operator records each one the invoicing service issued, with its PDF, on the console; the customer
// finds all of their workspace's invoices on their home page, newest first, and opens the PDF. Nobody else does.

const EMAIL = 'admin@example.com';
const PASSWORD = 'a long enough password';
// A PDF as far as the check goes: it starts with %PDF-. ASCII, so the test can compare what comes back as text.
const PDF = (n) => Buffer.from(`%PDF-1.7\n% invoice ${n}\n%%EOF\n`);

async function setup() {
  const h = tempHome();
  setNow('2026-10-22T10:00:15.000Z');
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: EMAIL, password: PASSWORD, totpSecret: secret });
  const dana = makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', products: ['teder', 'toran'], members: { 'dana@example.com': 'client_owner', 'noa@example.com': 'client_member' } });
  const other = makeWorkspace(h.db, 'yossi-cafe', { name: 'הקפה של יוסי', products: ['toran'], members: { 'yossi@example.com': 'client_owner' } });
  const site = await startSite(h.db);
  const admin = site.browser({ ip: '192.0.2.1' });
  await admin.get('/admin/login');
  await admin.post('/admin/login', { email: EMAIL, password: PASSWORD, code: totpCode(secret, stepAt(now())) });
  await admin.get('/admin');
  return { ...h, ...site, admin, dana, other, done: async () => (await site.close(), h.cleanup()) };
}

/** A customer signed in with an emailed link. */
async function signIn(t, email) {
  const b = t.browser({ ip: `203.0.113.${t.mails.length + 20}` });
  await b.get('/login');
  await b.post('/login', { email });
  const link = t.mails.at(-1).link;
  await b.get(pathOf(link));
  await b.post('/auth/link', { t: tokenOf(link) });
  return b;
}

const invoice = (fields = {}) => ({ product: 'teder', number: '1042', issued_on: '2026-10-22', period_from: '2026-10-22', period_to: '2026-11-21', amount: '790', vat: '142.2', ...fields });
const upload = (t, ws, fields, pdf = PDF(fields.number ?? '1042')) => t.admin.upload(`/admin/workspaces/${ws.id}/invoices`, invoice(fields), { pdf: { filename: 'invoice.pdf', data: pdf } });

test('the operator records an invoice with its PDF; the customer sees every one, newest first, with the VAT stated', async () => {
  const t = await setup();
  try {
    const dana = await signIn(t, 'dana@example.com');
    let home = (await dana.get('/')).body;
    assert.match(home, /<h2>חשבוניות<\/h2><p class="muted">עוד אין כאן חשבוניות\. כל חשבונית שנוציא לכם תופיע כאן, עם המסמך עצמו להורדה\.<\/p>/, 'the empty state');

    const r = await upload(t, t.dana, {});
    assert.equal(r.status, 303, r.body.slice(0, 300));
    assert.match((await t.admin.get('/admin')).body, /חשבונית 1042 נוספה ל-החנות של דנה\./);
    await upload(t, t.dana, { product: 'toran', number: '1077', issued_on: '2026-11-22', period_from: '2026-11-22', period_to: '2026-12-21', amount: '449', vat: '80.82' });
    await upload(t, t.dana, { number: '0990', issued_on: '2026-10-01', period_from: '', period_to: '', amount: '1490', vat: '0' });

    home = (await dana.get('/')).body;
    const rows = [...home.matchAll(/<li><span class="when">([^<]+)<\/span><span class="what"><b>([^<]+)<\/b>(?:<small>([^<]+)<\/small>)?<\/span><span class="sum"><b>([^<]+)<\/b><small>([^<]+)<\/small><\/span><a class="button quiet" href="(\/invoices\/\d+)"/g)].map((m) => m.slice(1));
    assert.deepEqual(rows.map((x) => x.slice(0, 5)), [
      ['22.11.2026', 'תורן, חשבונית 1077', 'על 22.11.2026 עד 21.12.2026', '529.82 ₪', '449 ₪ ועוד מע״מ 80.82 ₪'],
      ['22.10.2026', 'תדר, חשבונית 1042', 'על 22.10.2026 עד 21.11.2026', '932.20 ₪', '790 ₪ ועוד מע״מ 142.20 ₪'],
      ['1.10.2026', 'תדר, חשבונית 0990', undefined, '1,490 ₪', 'בלי מע״מ'],
    ]);

    // The PDF, as it was uploaded, to an owner of its own workspace.
    const doc = await dana.get(rows[1][5]);
    assert.equal(doc.status, 200);
    assert.equal(doc.headers['content-type'], 'application/pdf');
    assert.equal(doc.headers['content-disposition'], 'inline; filename="invoice-1042.pdf"');
    assert.equal(doc.headers['cache-control'], 'no-store');
    assert.equal(doc.body, PDF('1042').toString());
    // A member of the same workspace sees the team, not the invoices: no list, and the PDF is not found.
    const noa = await signIn(t, 'noa@example.com');
    const memberHome = (await noa.get('/')).body;
    assert.doesNotMatch(memberHome, /id="invoices"|1042/);
    const theirs = await noa.get(rows[1][5]);
    assert.equal(theirs.status, 404);
    assert.doesNotMatch(theirs.body, /%PDF/);

    // The console lists them too, each with its PDF and a way to take it back.
    const page = (await t.admin.get('/admin')).body;
    assert.match(page, /חשבונית 1042, 22\.10\.2026, 932\.20 ₪/);
    assert.equal((await t.admin.get(rows[1][5].replace('/invoices', '/admin/invoices'))).body, PDF('1042').toString());
  } finally {
    await t.done();
  }
});

test("an invoice is never reachable from another workspace, signed out, or through the console's route", async () => {
  const t = await setup();
  try {
    await upload(t, t.dana, {});
    const id = t.db.get('SELECT id FROM invoices').id;
    const yossi = await signIn(t, 'yossi@example.com');
    const theirs = await yossi.get(`/invoices/${id}`);
    assert.equal(theirs.status, 404, 'the same answer as an invoice that does not exist');
    assert.doesNotMatch(theirs.body, /%PDF/);
    assert.equal((await yossi.get(`/invoices/${id + 1}`)).status, 404);
    assert.doesNotMatch((await yossi.get('/')).body, /1042/, "not on another workspace's home");
    assert.match((await yossi.get('/')).body, /עוד אין כאן חשבוניות/);

    assert.equal((await t.browser().get(`/invoices/${id}`)).headers.location, '/login');
    assert.equal((await yossi.get(`/admin/invoices/${id}`)).headers.location, '/admin/login', "the console's route is the superadmin's only");
    assert.equal((await t.admin.get(`/invoices/${id}`)).headers.location, '/admin', 'the superadmin opens it from the console');

    // A member removed from the workspace loses its invoices with it.
    const dana = await signIn(t, 'dana@example.com');
    assert.equal((await dana.get(`/invoices/${id}`)).status, 200);
    t.db.run("DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = 'dana@example.com')");
    assert.notEqual((await dana.get(`/invoices/${id}`)).status, 200);
  } finally {
    await t.done();
  }
});

test('what the console refuses, in Hebrew; a customer cannot send a file at all', async () => {
  const t = await setup();
  try {
    for (const [fields, pdf, message] of [
      [{}, Buffer.from('<html>not a pdf</html>'), 'צריך לצרף את החשבונית כקובץ PDF'],
      [{}, Buffer.alloc(0), 'צריך לצרף את החשבונית כקובץ PDF'],
      [{ number: ' ' }, undefined, 'צריך את מספר החשבונית'],
      [{ issued_on: '' }, undefined, 'אחד התאריכים לא תקין'],
      [{ period_to: '' }, undefined, 'לתקופה צריך גם יום ראשון וגם יום אחרון'],
      [{ period_to: '2026-10-01' }, undefined, 'לתקופה צריך גם יום ראשון וגם יום אחרון'],
      [{ vat: '' }, undefined, 'צריך סכום לפני מע״מ ואת המע״מ'],
      [{ amount: 'abc' }, undefined, 'המחיר צריך להיות מספר'],
      [{ product: 'other' }, undefined, 'המוצר הזה לא קיים'],
    ]) {
      const r = await upload(t, t.dana, fields, pdf);
      assert.equal(r.status, 400, JSON.stringify(fields));
      assert.match(r.body, new RegExp(message));
    }
    const big = Buffer.concat([PDF('big'), Buffer.alloc(5 * 1024 * 1024)]);
    assert.match((await upload(t, t.dana, {}, big)).body, /הקובץ גדול מ-5MB/);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM invoices').n, 0);

    // The CSRF token is checked in a multipart form like in any other.
    const stale = await t.admin.go('POST', `/admin/workspaces/${t.dana.id}/invoices`, { ...invoice(), _csrf: 'nope' }, {}, { pdf: { filename: 'a.pdf', data: PDF(1) } });
    assert.equal(stale.status, 403);

    const dana = await signIn(t, 'dana@example.com');
    const sneak = await dana.upload(`/admin/workspaces/${t.dana.id}/invoices`, invoice(), { pdf: { filename: 'a.pdf', data: PDF(1) } });
    assert.equal(sneak.status, 415);
    assert.equal((await dana.upload('/login', { email: 'dana@example.com' }, { pdf: { filename: 'a.pdf', data: PDF(1) } })).status, 415);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM invoices').n, 0);
  } finally {
    await t.done();
  }
});

test('an invoice recorded by mistake is taken back on the console, and the log has both', async () => {
  const t = await setup();
  try {
    await upload(t, t.dana, {});
    const id = t.db.get('SELECT id FROM invoices').id;
    await t.admin.post(`/admin/invoices/${id}/remove`);
    assert.match((await t.admin.get('/admin')).body, /חשבונית 1042 הוסרה מהחשבון\. בשירות החשבוניות היא נשארת כמו שהיא\./);
    assert.deepEqual(invoicesOf(t.db, t.dana.id), []);
    assert.deepEqual(t.db.all("SELECT action FROM audit WHERE action LIKE 'invoice%' ORDER BY id").map((a) => a.action), ['invoice_added', 'invoice_removed']);
    const dana = await signIn(t, 'dana@example.com');
    assert.equal((await dana.get(`/invoices/${id}`)).status, 404);
  } finally {
    await t.done();
  }
});

test('the console prefills an invoice with the last month paid for', async () => {
  const t = await setup();
  try {
    await t.admin.post(`/admin/workspaces/${t.dana.id}/subscription/pay`, { product: 'teder' });
    const page = (await t.admin.get('/admin')).body;
    assert.match(page, /action="\/admin\/workspaces\/\d+\/invoices" enctype="multipart\/form-data"[^]*?name="issued_on" type="date" required value="2026-10-22"[^]*?name="period_from" type="date" value="2026-10-22"[^]*?name="period_to" type="date" value="2026-11-21"/);
  } finally {
    await t.done();
  }
});

test('a multipart body is read into its fields and files, and an unreadable one is not', () => {
  const body = Buffer.from('--b\r\nContent-Disposition: form-data; name="number"\r\n\r\n1042\r\n--b\r\nContent-Disposition: form-data; name="pdf"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1\r\n\r\nx\r\n--b--\r\n');
  const out = parseMultipart(body, 'multipart/form-data; boundary=b');
  assert.equal(out.fields.get('number'), '1042');
  assert.equal(out.files.pdf.filename, 'a.pdf');
  assert.equal(out.files.pdf.data.toString(), '%PDF-1\r\n\r\nx', 'a line break inside the file is kept');
  assert.equal(parseMultipart(body, 'multipart/form-data'), null, 'no boundary');
  assert.equal(parseMultipart(Buffer.from('--b\r\nContent-Disposition: form-data; name="x"\r\n\r\ncut off'), 'multipart/form-data; boundary=b'), null);
});

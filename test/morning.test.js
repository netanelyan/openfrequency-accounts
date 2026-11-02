import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { now, setNow } from '../src/core/clock.js';
import { ensureSubscription } from '../src/accounts/subscriptions.js';
import { payCodeFor, checkOf } from '../src/accounts/pay.js';
import { documentFor, morningClient, morningConfig, MorningError, morningProblem, MORNING_URLS, vatProblem } from '../src/accounts/morning.js';

// After "התשלום הגיע": what Toran read on the picture, shown to the operator and deciding nothing; and the
// invoice-receipt (חשבונית מס/קבלה, type 320) in Morning (src/accounts/morning.js), issued once the payment is recorded,
// never holding it up, never twice for one receipt, and never with a VAT that Morning's business does not have. Morning
// here is a fake on the fetch the site is given: nothing leaves the machine.

const SECRET = 'morning-secret-for-tests-only-7Hq9';
const ID = 'morning-client-id-for-tests';
const HOW = 'העברה בנקאית לחשבון 12-345-678901';
const T0 = '2026-10-22T10:00:00.000Z';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a picture')]);
const DOC_PDF = Buffer.from('%PDF-1.7\n% invoice-receipt 40001\n%%EOF\n');
const MORNING_ENV = { OF_MORNING_CLIENT_ID: ID, OF_MORNING_CLIENT_SECRET: SECRET };
const API = MORNING_URLS.production.api;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Morning, as its documents describe it: the token (an hour, expiresAt in unix seconds), /documents/info and
 * /documents. `issue(body, n)` answers the n-th POST /documents; `files` maps a URL to [answer without the token, with
 * it]. Every call is kept, with the bearer it carried.
 */
function fakeMorning({ info = { exemption: false, vatRate: 0.18 }, issue, files } = {}) {
  const calls = [];
  const tokens = [];
  let docs = 0;
  const state = {
    info,
    issue: issue || ((body, n) => json(201, { id: `doc-${n}`, number: String(40000 + n), url: { he: `https://www.greeninvoice.co.il/doc/${n}`, origin: `https://storage.example.com/doc-${n}.pdf` } })),
    files: files || {},
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const auth = init.headers?.authorization || null;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u.href, method: init.method || 'GET', auth, body });
    if (u.href === MORNING_URLS.production.token) {
      if (body?.grant_type !== 'client_credentials' || body.client_id !== ID || body.client_secret !== SECRET) return json(401, { error: 'invalid_client', error_description: 'Client authentication failed' });
      const t = `tok-${tokens.length + 1}-for-tests-only`;
      tokens.push(t);
      return json(200, { accessToken: t, tokenType: 'Bearer', expiresAt: Math.floor(now() / 1000) + 3600 });
    }
    if (u.href.startsWith(API)) {
      if (auth !== `Bearer ${tokens.at(-1)}`) return json(401, { errorCode: 401, errorMessage: 'Unauthorized' });
      if (u.pathname === '/api/v1/documents/info' && u.searchParams.get('type') === '320') return json(200, state.info);
      if (u.pathname === '/api/v1/documents' && init.method === 'POST') return state.issue(body, ++docs, init);
    }
    const f = state.files[u.href];
    if (f) return (auth ? f[1] : f[0])();
    return json(404, { errorCode: 404, errorMessage: 'not found' });
  };
  return { fetch, calls, tokens, state, docs: () => calls.filter((c) => c.url === `${API}/documents` && c.method === 'POST') };
}

const pdfOk = () => new Response(DOC_PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
const denied = () => new Response('no', { status: 403 });

async function site({ env = MORNING_ENV, morning = fakeMorning(), morningMs } = {}) {
  const h = tempHome();
  setNow(T0);
  const logs = [];
  const s = await startSite(h.db, { env: { OF_PAYMENT_METHOD: HOW, OF_ASSISTANT_WA: '972500000200', OF_SIGNUP_NOTIFY: 'boss@example.com', ...env }, morningFetch: morning.fetch, ...(morningMs ? { morningMs } : {}), log: (m) => logs.push(String(m)) });
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner', 'dan@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
  ensureSubscription(h.db, ws.id, 'teder', '2026-10-22', 'small');
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'Admin' });
  const op = signedIn(s, h.db, admin);
  const receipt = async (extra = {}) => {
    const r = await s.owners('POST', '/internal/pay/receipt', { code: payCodeFor(h.db, ws.id).code, phone: '972500000123', file: { name: 'shot.png', type: 'image/png', data: PNG.toString('base64') }, ...extra });
    assert.equal(r.status, 201, r.body);
    await op.get(`/admin/receipts/${r.json.id}`);
    return r.json.id;
  };
  const paid = (id) => op.post(`/admin/receipts/${id}/paid`, { expect_teder: h.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', ws.id).paid_until ?? '' });
  const row = (id) => h.db.get('SELECT * FROM pay_receipts WHERE id = ?', id);
  return { ...h, ...s, ws, admin, op, morning, logs, receipt, paid, row, done: async () => (await s.close(), h.cleanup()) };
}

// ---- what Toran read on the picture

test('the receipt check: only its keys, each of its type, strings cut to 80 without control or bidi characters, verdicts from their lists', () => {
  assert.equal(checkOf(null), null);
  assert.equal(checkOf('yes'), null);
  assert.equal(checkOf([1]), null);
  assert.equal(checkOf({ nothing: 1 }), null);
  assert.deepEqual(
    checkOf({
      readable: true,
      isTransfer: 'yes',
      amount: { seen: 1746.404, expected: '1746.40', verdict: 'ok', note: 'x' },
      date: { seen: '2026-10-22', verdict: 'yesterday' },
      account: { seen: '6789', verdict: 'mismatch' },
      payeeName: `  OpenFrequency‮\n${'x'.repeat(200)}`,
      reference: 12345,
      extra: { a: 1 },
    }),
    { readable: true, amount: { seen: 1746.4, verdict: 'ok' }, date: { seen: '2026-10-22' }, account: { seen: '6789', verdict: 'mismatch' }, payeeName: `OpenFrequency ${'x'.repeat(66)}` }
  );
  assert.deepEqual(checkOf({ amount: { seen: -5, verdict: 'mismatch' }, date: { verdict: 'too_old' } }), { amount: { verdict: 'mismatch' }, date: { verdict: 'too_old' } });
});

test('the check on the receipt\'s page and in the operator\'s email: its lines, escaped, never in a link, and always the bank first', async () => {
  const t = await site({ env: {} });
  try {
    const id = await t.receipt({
      check: { readable: true, isTransfer: true, amount: { seen: 1700, expected: 1746.4, verdict: 'mismatch' }, date: { seen: '2026-10-21', verdict: 'ok' }, account: { seen: '6789', verdict: 'ok' }, payeeName: '<script>alert(1)</script>', reference: 'REF "77" & co' },
    });
    const lines = ['הסכום בצילום: 1,700 ₪ (לא תואם, צריך 1,746.40 ₪)', 'התאריך בצילום: 21.10.2026 (תקין)', 'החשבון שהועבר אליו: מסתיים ב-6789 (תואם)', 'שם המקבל בצילום: <script>alert(1)</script>', 'האסמכתא בצילום: REF "77" & co'];
    const mail = t.mails.find((m) => m.to === 'boss@example.com');
    assert.ok(mail.text.includes(`מה תורן קרא בצילום:\n${lines.join('\n')}\n\nבדקו בבנק שההעברה הגיעה לפני שמאשרים.`), mail.text);
    assert.ok(!mail.html.includes('<script>'), 'escaped in the email');
    assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const page = (await t.op.get(`/admin/receipts/${id}`)).body;
    assert.match(page, /<h3>מה תורן קרא בצילום<\/h3>\n<ul class="check"><li>הסכום בצילום: 1,700 ₪ \(לא תואם, צריך 1,746\.40 ₪\)<\/li><li>התאריך בצילום: 21\.10\.2026 \(תקין\)<\/li><li>החשבון שהועבר אליו: מסתיים ב-6789 \(תואם\)<\/li><li>שם המקבל בצילום: &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li><li>האסמכתא בצילום: REF &quot;77&quot; &amp; co<\/li><\/ul>\n<p class="warn">בדקו בבנק שההעברה הגיעה לפני שמאשרים\.<\/p>/);
    assert.ok(!page.includes('<script>alert'), 'escaped on the page');
    // Every link on the receipt's card (the head's links carry a build stamp, which may hold any digits).
    const card = page.slice(page.indexOf('<section class="card receipt">'), page.indexOf('</section>', page.indexOf('<section class="card receipt">')));
    for (const href of card.match(/href="[^"]*"/g)) assert.doesNotMatch(href, /script|REF|77/, href);
    // It decides nothing: the buttons are the same as without it.
    assert.match(page, /<button class="primary">התשלום הגיע<\/button>/);
    // Without a check: no lines, the bank all the same; an unreadable one says so.
    const bare = await t.receipt();
    const plain = (await t.op.get(`/admin/receipts/${bare}`)).body;
    assert.doesNotMatch(plain, /מה תורן קרא בצילום/);
    assert.match(plain, /<p class="warn">בדקו בבנק שההעברה הגיעה לפני שמאשרים\.<\/p>/);
    const blind = await t.receipt({ check: { readable: false, isTransfer: false } });
    assert.match((await t.op.get(`/admin/receipts/${blind}`)).body, /<li>תורן לא הצליח לקרוא את הצילום\.<\/li><li>לפי תורן, זה לא נראה כמו אישור על העברה\.<\/li>/);
    assert.deepEqual(JSON.parse(t.row(blind).check_json), { readable: false, isTransfer: false });
  } finally {
    await t.done();
  }
});

// ---- the settings and the client

test('Morning is on only with both keys; sandbox by OF_MORNING_ENV; a bad value or one key alone keeps it off, and says so without a value', () => {
  assert.equal(morningConfig({}), null);
  assert.equal(morningConfig({ OF_MORNING_CLIENT_ID: ID }), null);
  assert.equal(morningConfig({ OF_MORNING_CLIENT_SECRET: SECRET }), null);
  assert.deepEqual(morningConfig(MORNING_ENV), { clientId: ID, clientSecret: SECRET, mode: 'production', token: 'https://api.morning.co/idp/v1/oauth/token', api: 'https://api.greeninvoice.co.il/api/v1' });
  assert.deepEqual(morningConfig({ ...MORNING_ENV, OF_MORNING_ENV: 'sandbox' }), { clientId: ID, clientSecret: SECRET, mode: 'sandbox', token: 'https://api.sandbox.morning.dev/idp/v1/oauth/token', api: 'https://sandbox.d.greeninvoice.co.il/api/v1' });
  assert.equal(morningConfig({ ...MORNING_ENV, OF_MORNING_ENV: 'sandbx' }), null);
  assert.equal(morningProblem({}), null);
  assert.equal(morningProblem(MORNING_ENV), null);
  assert.equal(morningProblem({ ...MORNING_ENV, OF_MORNING_ENV: 'sandbx' }), 'OF_MORNING_ENV is not production or sandbox: Morning stays off');
  assert.equal(morningProblem({ OF_MORNING_CLIENT_ID: ID }), 'OF_MORNING_CLIENT_SECRET is unset: Morning stays off');
  assert.equal(morningProblem({ OF_MORNING_CLIENT_SECRET: SECRET }), 'OF_MORNING_CLIENT_ID is unset: Morning stays off');
});

test('the token: asked once, kept until a minute before its hour ends, asked again after; a 401 forgets it; bad keys are invalid_client, without the secret', async () => {
  const h = tempHome();
  try {
    setNow(T0);
    const m = fakeMorning();
    const client = morningClient(morningConfig(MORNING_ENV), { fetchImpl: m.fetch });
    await client.info();
    await client.info();
    const tokenCalls = () => m.calls.filter((c) => c.url === MORNING_URLS.production.token);
    assert.equal(tokenCalls().length, 1);
    assert.deepEqual(tokenCalls()[0].body, { grant_type: 'client_credentials', client_id: ID, client_secret: SECRET });
    assert.ok(m.calls.filter((c) => c.url.startsWith(API)).every((c) => c.auth === 'Bearer tok-1-for-tests-only'));
    setNow('2026-10-22T10:58:59.000Z'); // 61 seconds before the hour
    await client.info();
    assert.equal(tokenCalls().length, 1);
    setNow('2026-10-22T10:59:01.000Z'); // 59 seconds before
    await client.info();
    assert.equal(tokenCalls().length, 2);
    // Morning forgets it early: the 401 is an error now, and the next call asks for a new one.
    m.tokens.push('a-token-someone-else-has');
    await assert.rejects(client.info(), (e) => e instanceof MorningError && e.status === 401);
    await client.info();
    assert.equal(tokenCalls().length, 3);

    const wrong = morningClient(morningConfig({ OF_MORNING_CLIENT_ID: ID, OF_MORNING_CLIENT_SECRET: 'not-the-secret' }), { fetchImpl: m.fetch });
    await assert.rejects(wrong.info(), (e) => e instanceof MorningError && e.code === 'invalid_client' && e.status === 401 && e.step === 'token' && !JSON.stringify({ ...e, message: e.message }).includes('not-the-secret'));
  } finally {
    h.cleanup();
  }
});

test('the VAT check before issuing: exempt while VAT was added, another rate, or none at all stops it; 18 as percent is ours', () => {
  const bill = { items: [{ vat: 'excluded' }] };
  assert.equal(vatProblem({ exemption: false, vatRate: 0.18 }, bill), null);
  assert.equal(vatProblem({ exemption: false, vatRate: 18 }, bill), null);
  assert.deepEqual(vatProblem({ exemption: true, vatRate: 0 }, bill), { reason: 'exempt' });
  assert.deepEqual(vatProblem({ exemption: false, vatRate: 0.17 }, bill), { reason: 'vat_rate', rate: '17%' });
  assert.deepEqual(vatProblem({ exemption: false }, bill), { reason: 'vat_unknown' });
  assert.deepEqual(vatProblem(null, bill), { reason: 'vat_unknown' });
});

// ---- the invoice, after "התשלום הגיע"

test('"התשלום הגיע" with Morning: the payment recorded, then one document of type 320 exactly as asked, its PDF on the customer\'s page', async () => {
  const m = fakeMorning({ files: { 'https://storage.example.com/doc-1.pdf': [pdfOk, pdfOk] } });
  const t = await site({ morning: m });
  try {
    const id = await t.receipt();
    const r = await t.paid(id);
    assert.deepEqual([r.status, r.headers.location], [303, '/admin']);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-11-21');
    assert.equal(m.docs().length, 1);
    const asked = m.docs()[0].body;
    assert.deepEqual(asked, {
      type: 320,
      lang: 'he',
      currency: 'ILS',
      vatType: 0,
      date: '2026-10-22',
      description: 'מנוי תדר',
      client: { name: 'Noa Shop', emails: ['noa@example.com', 'dan@example.com'], add: true },
      income: [
        { description: 'מנוי תדר, החבילה הקטנה, 22.10.2026 עד 21.11.2026', quantity: 1, price: 490, currency: 'ILS', vatType: 0 },
        { description: 'דמי הקמה, תדר, החבילה הקטנה', quantity: 1, price: 990, currency: 'ILS', vatType: 0 },
      ],
      payment: [{ date: '2026-10-22', type: 4, price: 1746.4, currency: 'ILS' }],
      attachment: true,
      emailContent: 'קיבלנו את התשלום על המנוי, והחשבונית מצורפת.',
    });
    // The rows with VAT come to the payment, which is what the customer was asked to pay.
    const withVat = asked.income.reduce((a, i) => a + Math.round(i.price * 1.18 * 100) / 100, 0);
    assert.equal(Math.round(withVat * 100) / 100, asked.payment[0].price);
    assert.equal(asked.payment[0].price, JSON.parse(t.row(id).items_json).total);
    // The info check came first, the same token for both.
    assert.deepEqual(m.calls.filter((c) => c.url.startsWith(API)).map((c) => [c.method, new URL(c.url).pathname]), [['GET', '/api/v1/documents/info'], ['POST', '/api/v1/documents']]);

    const row = t.row(id);
    assert.deepEqual([row.morning_state, row.morning_doc_id, row.morning_doc_number, row.morning_url], ['issued', 'doc-1', '40001', 'https://storage.example.com/doc-1.pdf']);
    const inv = t.db.get('SELECT * FROM invoices WHERE id = ?', row.invoice_id);
    assert.deepEqual([inv.workspace_id, inv.product, inv.number, inv.issued_on, inv.period_from, inv.period_to, inv.amount, inv.vat], [t.ws.id, 'teder', '40001', '2026-10-22', '2026-10-22', '2026-11-21', 1480, 266.4]);
    assert.ok(Buffer.from(inv.pdf).equals(DOC_PDF));
    // The PDF came from a host that is not Morning's: no token went there.
    assert.ok(m.calls.filter((c) => !c.url.startsWith(API) && c.url !== MORNING_URLS.production.token).every((c) => c.auth === null));
    assert.match((await t.op.get('/admin')).body, /Noa Shop: התשלום נרשם\. תדר שולם עד 21\.11\.2026\. Morning הפיק חשבונית מס קבלה 40001\./);
    assert.match((await t.op.get(`/admin/receipts/${id}`)).body, /<p class="notice">Morning הפיק חשבונית מס קבלה 40001 ושלח אותה ללקוח במייל\. עותק שלה נמצא בדף של הלקוח\. <a href="https:\/\/storage\.example\.com\/doc-1\.pdf" target="_blank" rel="noopener">לפתוח ב-Morning<\/a><\/p>/);
    const home = (await signedIn(t, t.db, t.db.get("SELECT * FROM users WHERE email = 'noa@example.com'")).get('/')).body;
    assert.match(home, new RegExp(`href="/invoices/${inv.id}"`));
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'morning_issued' AND detail_json LIKE '%40001%'"));
  } finally {
    await t.done();
  }
});

test('the PDF: with the token only from Morning\'s own host; when no link gives one, the link alone, on the receipt\'s page', async () => {
  const m = fakeMorning({ files: { 'https://storage.example.com/doc-1.pdf': [denied, denied], 'https://www.greeninvoice.co.il/doc/1': [denied, pdfOk] } });
  const t = await site({ morning: m });
  try {
    const id = await t.receipt();
    await t.paid(id);
    assert.ok(t.row(id).invoice_id, 'kept, from the second link with the token');
    const out = m.calls.filter((c) => c.url.startsWith('https://storage.example.com') || c.url.startsWith('https://www.greeninvoice.co.il/doc'));
    assert.deepEqual(out.map((c) => [c.url, Boolean(c.auth)]), [['https://storage.example.com/doc-1.pdf', false], ['https://www.greeninvoice.co.il/doc/1', false], ['https://www.greeninvoice.co.il/doc/1', true]]);
  } finally {
    await t.done();
  }
  const n = fakeMorning();
  const u = await site({ morning: n });
  try {
    const id = await u.receipt();
    await u.paid(id);
    const row = u.row(id);
    assert.deepEqual([row.morning_state, row.invoice_id], ['issued', null]);
    assert.equal(u.db.get('SELECT COUNT(*) AS n FROM invoices').n, 0);
    assert.match((await u.op.get(`/admin/receipts/${id}`)).body, /<p class="notice">Morning הפיק חשבונית מס קבלה 40001 ושלח אותה ללקוח במייל\. את הקובץ לא הצלחנו להוריד, אז אין עותק שלה בדף של הלקוח\. <a href="https:\/\/storage\.example\.com\/doc-1\.pdf" target="_blank" rel="noopener">לפתוח ב-Morning<\/a><\/p>/);
  } finally {
    await u.done();
  }
});

test('Morning\'s business is exempt while we added VAT, or its rate is not ours: nothing issued, the payment recorded, the operator told why', async () => {
  for (const [info, why] of [
    [{ exemption: true, vatRate: 0 }, 'לא הפקנו חשבונית. ב-Morning העסק מוגדר כפטור ממע״מ, אבל בתשלום הזה נוסף מע״מ. מתקנים את ההגדרה ב-Morning, ואז מפיקים שוב. התשלום כבר נרשם.'],
    [{ exemption: false, vatRate: 0.17 }, 'לא הפקנו חשבונית. שיעור המע״מ ב-Morning הוא 17%, ואצלנו 18%. מתקנים את ההגדרה ב-Morning, ואז מפיקים שוב. התשלום כבר נרשם.'],
  ]) {
    const m = fakeMorning({ info });
    const t = await site({ morning: m });
    try {
      const id = await t.receipt();
      const r = await t.paid(id);
      assert.deepEqual([r.status, r.headers.location], [303, `/admin/receipts/${id}`]);
      assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-11-21', 'recorded all the same');
      assert.equal(m.docs().length, 0, 'nothing issued');
      assert.equal(t.row(id).morning_state, 'blocked');
      const page = (await t.op.get(`/admin/receipts/${id}`)).body;
      assert.match(page, /<p class="flash bad" role="alert">Noa Shop: התשלום נרשם\. תדר שולם עד 21\.11\.2026\. לא הצלחנו להפיק חשבונית\. הפרטים בדף של האישור\.<\/p>/);
      assert.ok(page.includes(`<p class="error" role="alert">${why}</p>`), page.slice(page.indexOf('card receipt'), page.indexOf('card receipt') + 1500));
      assert.match(page, new RegExp(`<form method="post" action="/admin/receipts/${id}/invoice" class="inline">.*<button class="quiet">להפיק חשבונית שוב</button>`));
      assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'morning_blocked'"));
    } finally {
      await t.done();
    }
  }
});

test('a failure, then the retry: Morning\'s code and words on the page, the payment kept; two retries at once ask once; issued, it is never asked again', async () => {
  let release;
  const m = fakeMorning({ files: { 'https://storage.example.com/doc-2.pdf': [pdfOk, pdfOk] } });
  m.state.issue = () => json(400, { errorCode: 1006, errorMessage: 'יש לחדש את המנוי' });
  const t = await site({ morning: m });
  try {
    const id = await t.receipt();
    const r = await t.paid(id);
    assert.equal(r.headers.location, `/admin/receipts/${id}`);
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.ws.id).paid_until, '2026-11-21');
    assert.equal(t.row(id).morning_state, 'failed');
    const page = (await t.op.get(`/admin/receipts/${id}`)).body;
    assert.ok(page.includes('<p class="error" role="alert">לא הצלחנו להפיק חשבונית. צריך לחדש את המנוי ב-Morning. (קוד 1006) Morning כתב: יש לחדש את המנוי</p>'), page);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'morning_failed' AND detail_json LIKE '%1006%'"));

    // A double click on "להפיק חשבונית שוב" while Morning takes its time: one request.
    const slow = new Promise((resolve) => (release = resolve));
    m.state.issue = async (body, n) => (await slow, json(201, { id: `doc-${n}`, number: String(40000 + n), url: { origin: `https://storage.example.com/doc-${n}.pdf` } }));
    const first = t.op.post(`/admin/receipts/${id}/invoice`);
    await new Promise((r2) => setTimeout(r2, 50));
    const second = await t.op.post(`/admin/receipts/${id}/invoice`);
    assert.equal(second.headers.location, `/admin/receipts/${id}`);
    assert.match((await t.op.get(`/admin/receipts/${id}`)).body, /Morning מפיק עכשיו את החשבונית\. רעננו את הדף בעוד רגע\./);
    release();
    assert.equal((await first).status, 303);
    assert.equal(m.docs().length, 2, 'the failed one and one more');
    assert.deepEqual([t.row(id).morning_state, t.row(id).morning_doc_number], ['issued', '40002']);
    assert.match((await t.op.get(`/admin/receipts/${id}`)).body, /Morning הפיק חשבונית מס קבלה 40002/);
    // Issued: another press, and the "paid" button again (back to the receipt's page, "התשלום כבר נרשם"), ask nothing.
    await t.op.post(`/admin/receipts/${id}/invoice`);
    const again = await t.paid(id);
    assert.deepEqual([again.status, again.headers.location], [303, `/admin/receipts/${id}`]);
    assert.equal(m.docs().length, 2);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM invoices').n, 1);
  } finally {
    release?.();
    await t.done();
  }
});

test('Morning does not answer in time: failed, and the page says the document may exist and to look in Morning first', async () => {
  const m = fakeMorning();
  m.state.issue = (body, n, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t = await site({ morning: m, morningMs: 200 });
  try {
    const id = await t.receipt();
    await t.paid(id);
    assert.deepEqual(JSON.parse(t.row(id).morning_error_json), { code: 'timeout', status: null, detail: '', step: 'issue' });
    assert.match((await t.op.get(`/admin/receipts/${id}`)).body, /לא הצלחנו להפיק חשבונית\. Morning לא ענה בזמן\. \(קוד timeout\) ייתכן שהחשבונית בכל זאת הופקה\. בדקו ב-Morning לפני שמפיקים שוב\./);
  } finally {
    await t.done();
  }
});

test('Morning off: "התשלום הגיע" works as before, nothing is asked of anyone, and the page says the invoice was not issued automatically', async () => {
  const m = fakeMorning();
  const t = await site({ env: {}, morning: m });
  try {
    const id = await t.receipt();
    const r = await t.paid(id);
    assert.deepEqual([r.status, r.headers.location], [303, '/admin']);
    assert.equal(m.calls.length, 0);
    assert.equal(t.row(id).morning_state, null);
    assert.match((await t.op.get(`/admin/receipts/${id}`)).body, /<p class="muted">החשבונית לא הופקה אוטומטית: Morning לא מחובר\.<\/p>/);
    // The retry asks nothing either.
    await t.op.post(`/admin/receipts/${id}/invoice`);
    assert.equal(m.calls.length, 0);
  } finally {
    await t.done();
  }
});

test('the secret and the token are never in a log, the audit log, the database, an email or a page', async () => {
  const m = fakeMorning({ files: { 'https://storage.example.com/doc-1.pdf': [pdfOk, pdfOk] } });
  m.state.issue = () => json(500, { errorCode: 9999, errorMessage: 'temporary' });
  const t = await site({ morning: m });
  try {
    const id = await t.receipt();
    const seen = [];
    await t.paid(id);
    m.state.issue = (body, n) => json(201, { id: `doc-${n}`, number: String(40000 + n), url: { origin: 'https://storage.example.com/doc-1.pdf' } });
    await t.op.post(`/admin/receipts/${id}/invoice`);
    assert.equal(t.row(id).morning_state, 'issued');
    for (const p of [`/admin/receipts/${id}`, '/admin', '/admin/accounts']) seen.push((await t.op.get(p)).body);
    seen.push(...t.logs, ...t.mails.flatMap((x) => [x.subject, x.text, x.html]));
    for (const table of ['audit', 'pay_receipts', 'invoices', 'daily_runs']) seen.push(JSON.stringify(t.db.all(`SELECT * FROM ${table}`), (k, v) => (v && v.type === 'Buffer' ? '' : v)));
    const all = seen.join('\n');
    assert.ok(m.tokens.length >= 1);
    for (const secret of [SECRET, ...m.tokens]) assert.ok(!all.includes(secret), `"${secret.slice(0, 8)}..." leaked`);
  } finally {
    await t.done();
  }
});

test('documentFor: two products in one document, a price with VAT in it as vatType 1, one payment of the total', () => {
  const doc = documentFor({
    business: 'Two Shop',
    emails: ['a@example.com'],
    today: '2026-11-01',
    bill: {
      items: [
        { product: 'teder', plan: 'full', monthly: 790, setup: 0, vat: 'excluded', from: '2026-11-01', until: '2026-11-30' },
        { product: 'toran', plan: null, monthly: 500, setup: 0, vat: 'included', from: '2026-11-01', until: '2026-11-30' },
      ],
      total: 1432.2,
    },
  });
  assert.equal(doc.description, 'מנוי תדר ותורן');
  assert.deepEqual(doc.income.map((i) => [i.description, i.price, i.vatType]), [['מנוי תדר, החבילה המלאה, 1.11.2026 עד 30.11.2026', 790, 0], ['מנוי תורן, 1.11.2026 עד 30.11.2026', 500, 1]]);
  assert.deepEqual(doc.payment, [{ date: '2026-11-01', type: 4, price: 1432.2, currency: 'ILS' }]);
});

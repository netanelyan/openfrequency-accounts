import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkPhone, makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { advance, setNow, MINUTE } from '../src/core/clock.js';
import { startViewAs } from '../src/accounts/workspaces.js';
import { createSession } from '../src/auth/sessions.js';
import { j } from '../src/db/index.js';

// WhatsApp on the customer's home page: the link form, the code and the wa.me button, the numbers linked, removing
// one. Each change is checked from Toran's side too, through /internal/owner-phone. Every number here is fictional
// (050-000-0xxx).
//
// Since 2026-11-02 Teder is managed on its dashboard only (the owner: "managing teder through whatsapp, only through
// the dashboard"): a linked number is for Toran's assistant alone, so the form is only for a workspace with Toran, and
// the box about updates (which were Teder's messages) and the button turning them on or off are gone. A workspace with
// Teder alone sees the card only while a number of its is still linked, to remove it.

const DANA = '972500000123';
const NOA = '972500000124';
const LINE = '972500000100';

async function setup(env = { OF_ASSISTANT_WA: '+972 500000100' }, products = ['teder', 'toran']) {
  const h = tempHome();
  setNow('2026-10-24T09:00:00.000Z');
  const shop = makeWorkspace(h.db, 'dana-shop', { name: 'Dana Shop', products, members: { 'dana@example.com': 'client_owner', 'noa@example.com': 'client_member' } });
  h.db.run("UPDATE users SET name = 'נועה' WHERE email = 'noa@example.com'");
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  const site = await startSite(h.db, { env });
  const dana = user('dana@example.com');
  const noa = user('noa@example.com');
  const owner = (phone) => site.owners('GET', `/internal/owner-phone?phone=${phone}`).then((r) => r.json);
  return { ...h, ...site, shop, dana, noa, owner, done: async () => (await site.close(), h.cleanup()) };
}

test('a customer of Toran links their WhatsApp: no box about updates, the code with how long it lasts, the wa.me button, then the number listed', async () => {
  const t = await setup();
  try {
    const b = signedIn(t, t.db, t.dana);
    let home = (await b.get('/')).body;
    assert.match(home, /<section class="card wa" id="whatsapp">/);
    assert.match(home, /<p class="lead">כשהמספר שלכם מחובר, אפשר לכתוב לתורן בוואטסאפ ולשאול על החנות, בלי להיכנס לאתר\.<\/p>/);
    assert.doesNotMatch(home, /ולתדר|מתדר|עדכונים|name="updates"|wa-hint/, 'nothing about Teder on WhatsApp, and no box');
    assert.match(home, /עוד לא חיברתם מספר\./);
    // A grey pill: the product's button is the page's one blue (the owner, 2026-11-06).
    assert.match(home, /<form method="post" action="\/whatsapp\/link" class="wa-form"><input type="hidden" name="_csrf"[^>]*>\n<button class="quiet">לחבר את הוואטסאפ<\/button>/);

    // A box ticked by hand (an old page, or a forged form) asks for nothing.
    const r = await b.post('/whatsapp/link', { updates: '1' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/#whatsapp');
    const { code, opt_in } = t.db.get('SELECT code, opt_in FROM phone_links');
    assert.equal(opt_in, 0);
    home = (await b.get('/')).body;
    assert.ok(home.includes(`<p class="code ltr">${code}</p>`));
    assert.match(home, /הוא עובד פעם אחת, במשך 30 דקות \(עד 12:30\)\./);
    assert.doesNotMatch(home, /עדכונים/);
    assert.ok(home.includes(`<a class="button primary" href="https://wa.me/${LINE}?text=${code}">פתיחת וואטסאפ עם הקוד</a>`));
    assert.match(home, /<button class="quiet">קוד חדש<\/button>/);

    // Dana sends it; Toran claims it. Nothing opted in.
    const claim = await t.owners('POST', '/internal/owner-phone/claim', { code, phone: DANA });
    assert.equal(claim.status, 200);
    assert.equal(claim.json.optIn, null);
    home = (await b.get('/')).body;
    assert.match(home, /<li><span class="who ltr">050-000-0123<\/span><span class="end">/);
    const card = /<section class="card wa" id="whatsapp">[\s\S]*?<\/section>/.exec(home)[0];
    assert.doesNotMatch(card, /class="tag|עדכונים/, 'no "עם עדכונים" or "בלי עדכונים" beside a number');
    assert.doesNotMatch(home, /whatsapp\/updates/);
    assert.doesNotMatch(home, /class="code ltr"/, 'a used code is gone');
    assert.match(home, /<button class="quiet">לחבר את הוואטסאפ<\/button>/);
  } finally {
    await t.done();
  }
});

test('a workspace with Teder alone has no WhatsApp to link: no card, and no code made; a number linked before shows only to be removed', async () => {
  const t = await setup(undefined, ['teder']);
  try {
    const b = signedIn(t, t.db, t.dana);
    let home = (await b.get('/')).body;
    assert.doesNotMatch(home, /id="whatsapp"|לחבר את הוואטסאפ|whatsapp\/link/);
    const r = await b.post('/whatsapp/link', { updates: '1' });
    assert.deepEqual([r.status, r.headers.location], [303, '/']);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM phone_links').n, 0, 'no code made');

    // A number linked before 2026-11-02, with its updates: listed with the way to remove it, and nothing else.
    linkPhone(t.db, DANA, t.dana, t.shop, { optIn: true });
    home = (await b.get('/')).body;
    const card = /<section class="card wa" id="whatsapp">[\s\S]*?<\/section>/.exec(home)[0];
    assert.match(card, /<p class="lead">את תדר מנהלים רק מלוח הבקרה, ומתדר לא נשלחות הודעות לוואטסאפ\. מספר שחיברתם קודם אפשר להסיר כאן\.<\/p>/);
    assert.match(card, /050-000-0123/);
    assert.match(card, /action="\/whatsapp\/remove"/);
    assert.doesNotMatch(card, /whatsapp\/link|whatsapp\/updates|class="code|עדכונים/);
    const gone = await b.post('/whatsapp/remove', { phone: DANA });
    assert.equal(gone.headers.location, '/#whatsapp');
    home = (await b.get('/')).body;
    assert.match(home, /הסרנו את 050-000-0123\./);
    assert.doesNotMatch(home, /id="whatsapp"/, 'and the card goes with it');
    assert.equal((await t.owners('GET', `/internal/owner-phone?phone=${DANA}`)).status, 404);
  } finally {
    await t.done();
  }
});

test('updates can no longer be turned on from the home page: /whatsapp/updates is gone and changes no consent', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop, { optIn: false });
    const b = signedIn(t, t.db, t.dana);
    const home = (await b.get('/')).body;
    assert.doesNotMatch(home, /הפעלת עדכונים|כיבוי עדכונים|whatsapp\/updates/);
    advance(MINUTE);
    const r = await b.post('/whatsapp/updates', { phone: DANA, on: '1' });
    assert.equal(r.headers.location, '/#whatsapp');
    assert.equal((await t.owner(DANA)).optIn, null, 'no opt-in recorded');
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM audit WHERE action LIKE 'phone_opt%'").n, 0);
  } finally {
    await t.done();
  }
});

test('a code lasts 30 minutes on the page', async () => {
  const t = await setup();
  try {
    const b = signedIn(t, t.db, t.noa);
    await b.get('/');
    await b.post('/whatsapp/link', {});
    assert.equal(t.db.get('SELECT opt_in FROM phone_links').opt_in, 0);
    assert.match((await b.get('/')).body, /class="code ltr"/);
    advance(30 * MINUTE);
    assert.doesNotMatch((await b.get('/')).body, /class="code ltr"/);
  } finally {
    await t.done();
  }
});

test('without OF_ASSISTANT_WA the code is still shown, and the page says the number is not set', async () => {
  for (const env of [{}, { OF_ASSISTANT_WA: '0500000100' }, { OF_ASSISTANT_WA: 'soon' }]) {
    const t = await setup(env);
    try {
      const b = signedIn(t, t.db, t.dana);
      await b.get('/');
      await b.post('/whatsapp/link', {});
      const home = (await b.get('/')).body;
      assert.ok(home.includes(`<p class="code ltr">${t.db.get('SELECT code FROM phone_links').code}</p>`));
      assert.match(home, /עוד לא הגדרנו כאן את המספר שלנו בוואטסאפ, אז כרגע אין לאן לשלוח את הקוד\./);
      assert.doesNotMatch(home, /wa\.me/);
    } finally {
      await t.done();
    }
  }
});

test("a member sees their own numbers; the owner sees everyone's and removes any", async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    linkPhone(t.db, NOA, t.noa, t.shop, { optIn: false });
    const other = makeWorkspace(t.db, 'other-shop', { members: { 'gil@example.com': 'client_owner' } });
    linkPhone(t.db, '972500000125', t.db.get("SELECT * FROM users WHERE email = 'gil@example.com'"), other);

    const noa = signedIn(t, t.db, t.noa);
    let home = (await noa.get('/')).body;
    assert.match(home, /050-000-0124/);
    assert.doesNotMatch(home, /050-000-0123/);
    assert.doesNotMatch(home, /050-000-0125/);

    const dana = signedIn(t, t.db, t.dana);
    home = (await dana.get('/')).body;
    assert.match(home, /050-000-0123[^]*050-000-0124/, 'her own first');
    assert.match(home, /050-000-0124<\/span><span class="muted"><bdi>של נועה<\/bdi><\/span>/);
    assert.doesNotMatch(home, /050-000-0125/);
    const noaRow = /<li><span class="who ltr">050-000-0124<\/span>.*?<\/li>/.exec(home)[0];
    assert.match(noaRow, /action="\/whatsapp\/remove"/);

    // Forged forms change nothing: a number of another workspace, a member removing the owner's.
    await dana.post('/whatsapp/remove', { phone: '972500000125' });
    await noa.get('/');
    await noa.post('/whatsapp/remove', { phone: DANA });
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM user_phones').n, 3);

    // The owner removes Noa's number: gone for Toran at once, and in the audit log.
    const r = await dana.post('/whatsapp/remove', { phone: NOA });
    assert.equal(r.headers.location, '/#whatsapp');
    assert.match((await dana.get('/')).body, /הסרנו את 050-000-0124\. כדי לחבר אותו שוב צריך קוד חדש\./);
    assert.equal((await t.owners('GET', `/internal/owner-phone?phone=${NOA}`)).status, 404);
    const removed = t.db.get("SELECT * FROM audit WHERE action = 'phone_removed'");
    assert.equal(removed.actor, 'dana@example.com');
    assert.deepEqual(j(removed.detail_json), { phone: NOA, userId: t.noa.id });

    // Her own, too.
    await dana.post('/whatsapp/remove', { phone: DANA });
    assert.equal((await t.owners('GET', `/internal/owner-phone?phone=${DANA}`)).status, 404);
  } finally {
    await t.done();
  }
});

test('every WhatsApp form needs the CSRF token and our Origin', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    const b = signedIn(t, t.db, t.dana);
    await b.get('/');
    const evil = signedIn(t, t.db, t.dana, { origin: 'https://evil.example' });
    await evil.get('/');
    for (const [path, fields] of [['/whatsapp/link', {}], ['/whatsapp/remove', { phone: DANA }]]) {
      const r = await b.post(path, { ...fields, _csrf: 'x'.repeat(32) });
      assert.equal(r.status, 403, path);
      assert.match(r.body, /הדף הזה ישן מדי/);
      const cross = await evil.post(path, fields);
      assert.equal(cross.status, 403, path);
      assert.match(cross.body, /חסמנו את הבקשה כי היא הגיעה מאתר אחר\./);
    }
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM phone_links').n, 1, 'only the one linkPhone made');
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM user_phones').n, 1);
  } finally {
    await t.done();
  }
});

test('signed out, nothing is made; the superadmin in view-as, read-only, changes nothing', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    const anon = t.browser();
    await anon.get('/login');
    const r = await anon.post('/whatsapp/link', {});
    assert.deepEqual([r.status, r.headers.location], [303, '/login']);

    const admin = makeUser(t.db, 'admin@example.com', { superadmin: true });
    const { id, row } = createSession(t.db, admin);
    startViewAs(t.db, row, t.shop.id, { by: admin });
    const b = t.browser();
    b.jar.set('__Secure-of_session', { value: id, attrs: [] });
    assert.equal((await t.internal(id)).json.readOnly, true);
    assert.equal((await b.get('/')).headers.location, '/admin', 'the console, not the customer home');
    await b.get('/admin');
    for (const [path, fields] of [['/whatsapp/link', {}], ['/whatsapp/remove', { phone: DANA }]]) {
      const x = await b.post(path, fields);
      assert.equal(x.status, 403, path);
      assert.match(x.body, /בצפייה כלקוח אי אפשר לשנות כלום\./);
    }
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM phone_links').n, 1);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM user_phones').n, 1);
    assert.equal((await t.owner(DANA)).optOut, null);
  } finally {
    await t.done();
  }
});

test('the console reads the WhatsApp entries in Hebrew', async () => {
  const t = await setup();
  try {
    const b = signedIn(t, t.db, t.dana);
    await b.get('/');
    await b.post('/whatsapp/link', {});
    const { code } = t.db.get('SELECT code FROM phone_links');
    await t.owners('POST', '/internal/owner-phone/claim', { code, phone: DANA });
    // "התחל" and "הפסק" from WhatsApp still reach accounts through Toran's internal call.
    await t.owners('POST', '/internal/owner-phone/consent', { phone: DANA, optIn: true, source: 'whatsapp' });
    await t.owners('POST', '/internal/owner-phone/consent', { phone: DANA, optIn: false, source: 'whatsapp' });
    await b.get('/');
    await b.post('/whatsapp/remove', { phone: DANA });
    const { AUDIT_NAMES } = await import('../src/web/copy.js');
    const names = t.db.all("SELECT action FROM audit WHERE action LIKE 'phone_%' ORDER BY id").map((a) => a.action);
    assert.deepEqual(names, ['phone_link_created', 'phone_linked', 'phone_opt_in', 'phone_opt_out', 'phone_removed']);
    for (const n of names) assert.ok(AUDIT_NAMES[n], n);
  } finally {
    await t.done();
  }
});

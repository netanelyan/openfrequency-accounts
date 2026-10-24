import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';
import { pathOf, startSite, tokenOf } from './site.js';
import { advance, now, setNow, HOUR } from '../src/core/clock.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';

// The superadmin console end to end: open a workspace, its owner accepts the
// invite, products go on and off, the workspace is disabled and enabled, and
// view-as shows it read-only. Each step is checked from the side of Teder and
// Toran, through /internal/session.

const EMAIL = 'admin@example.com';
const PASSWORD = 'a long enough password';

async function setup() {
  const h = tempHome();
  setNow('2026-10-22T10:00:15.000Z');
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: EMAIL, password: PASSWORD, totpSecret: secret });
  const site = await startSite(h.db);
  const admin = site.browser({ ip: '192.0.2.1' });
  await admin.get('/admin/login');
  const r = await admin.post('/admin/login', { email: EMAIL, password: PASSWORD, code: totpCode(secret, stepAt(now())) });
  assert.equal(r.headers.location, '/admin');
  await admin.get('/admin/accounts');
  return { ...h, ...site, admin, done: async () => (await site.close(), h.cleanup()) };
}

const ws = (db, slug) => db.get('SELECT * FROM workspaces WHERE slug = ?', slug);

async function openShop(t, fields = {}) {
  const r = await t.admin.post('/admin/workspaces', { name: 'חנות של דנה', slug: 'dana-shop', owner: 'Dana@Example.com', products: ['teder'], ...fields });
  return r;
}

async function accept(t, mail, { ip = '203.0.113.50', name = 'דנה' } = {}) {
  const b = t.browser({ ip });
  const page = await b.get(pathOf(mail.link));
  assert.equal(page.status, 200, page.body.slice(0, 300));
  const r = await b.post('/invite', { t: tokenOf(mail.link), name });
  return { b, r };
}

test('opening a workspace sends its owner a 72-hour invite; accepting it signs them in as its owner', async () => {
  const t = await setup();
  try {
    const r = await openShop(t);
    assert.equal(r.status, 303);
    const flash = await t.admin.get('/admin/accounts');
    assert.match(flash.body, /פתחנו את חנות של דנה ושלחנו הזמנה ל-dana@example\.com\./);
    assert.match(flash.body, /הזמנה ל-dana@example\.com מחכה/);

    assert.equal(t.mails.length, 1);
    const mail = t.mails[0];
    assert.equal(mail.to, 'dana@example.com');
    assert.equal(mail.subject, 'הזמנה ל-חנות של דנה ב-OpenFrequency');
    assert.match(mail.link, /^https:\/\/accounts\.openfrequency\.co\.il\/invite\?t=/);
    assert.match(mail.text, /עד 25\.10\.2026, 12:00/);

    const page = await t.browser().get(pathOf(mail.link));
    assert.match(page.body, /הוזמנתם ל-חנות של דנה/);

    const { b, r: joined } = await accept(t, mail);
    assert.equal(joined.headers.location, '/');
    const who = await t.internal(b.cookie('__Secure-of_session'), 'teder');
    assert.equal(who.status, 200);
    assert.equal(who.json.role, 'client_owner');
    assert.equal(who.json.user.name, 'דנה');
    assert.equal(who.json.workspace.name, 'חנות של דנה');
    assert.equal((await t.internal(b.cookie('__Secure-of_session'), 'toran')).json.error, 'product_disabled');

    // The invite is spent, and the console shows the member.
    assert.equal((await t.browser().get(pathOf(mail.link))).status, 410);
    const after = await t.admin.get('/admin/accounts');
    assert.match(after.body, /dana@example\.com<\/span><span class="muted">בעלים<\/span>/);
    assert.doesNotMatch(after.body, /הזמנה ל-dana@example\.com מחכה/);
  } finally {
    await t.done();
  }
});

test('an invite expires after 72 hours', async () => {
  const t = await setup();
  try {
    await openShop(t);
    advance(72 * HOUR);
    const b = t.browser();
    const page = await b.get(pathOf(t.mails[0].link));
    assert.equal(page.status, 410);
    assert.match(page.body, /ההזמנה הזאת כבר לא בתוקף/);
    await b.get('/login');
    assert.equal((await b.post('/invite', { t: tokenOf(t.mails[0].link) })).status, 410);
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM users WHERE email = 'dana@example.com'").n, 0);
  } finally {
    await t.done();
  }
});

test('a second invite: a team member joins, and an existing user keeps their own name', async () => {
  const t = await setup();
  try {
    await openShop(t);
    await accept(t, t.mails[0]);
    const id = ws(t.db, 'dana-shop').id;
    await t.admin.post(`/admin/workspaces/${id}/invite`, { email: 'noa@example.com', role: 'client_member' });
    const { b } = await accept(t, t.mails[1], { name: '' });
    const who = await t.internal(b.cookie('__Secure-of_session'));
    assert.equal(who.json.role, 'client_member');
    assert.equal(who.json.user.name, '');

    // Dana is invited to a second business: one user, two memberships, her name kept.
    await t.admin.post('/admin/workspaces', { name: 'Dana Studio', slug: 'dana-studio', owner: 'dana@example.com', products: ['toran'] });
    const { b: b2 } = await accept(t, t.mails[2], { name: 'someone else' });
    const who2 = await t.internal(b2.cookie('__Secure-of_session'));
    assert.equal(who2.json.workspace.slug, 'dana-studio', 'the invite decides the workspace this session is in');
    assert.equal(who2.json.user.name, 'דנה');
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM users WHERE email = 'dana@example.com'").n, 1);
  } finally {
    await t.done();
  }
});

test('what the console refuses, in Hebrew, keeping what was typed', async () => {
  const t = await setup();
  try {
    await openShop(t);
    for (const [fields, message] of [
      [{ name: '' }, 'צריך שם לעסק'],
      [{ slug: 'Dana Shop' }, 'המזהה יכול להכיל רק'],
      [{ slug: '-dana' }, 'המזהה יכול להכיל רק'],
      [{ slug: 'dana-shop' }, 'המזהה הזה כבר תפוס'],
      [{ slug: 'new-shop', owner: 'not an email' }, 'המייל הזה לא נראה תקין'],
      [{ slug: 'new-shop', owner: EMAIL }, 'זה המייל של המנהל'],
    ]) {
      const r = await openShop(t, fields);
      assert.equal(r.status, 400, JSON.stringify(fields));
      assert.match(r.body, new RegExp(message));
      if (fields.slug) assert.ok(r.body.includes(`value="${fields.slug}"`), 'the form keeps what was typed');
    }
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM workspaces').n, 1);
    assert.equal(t.mails.length, 1);
  } finally {
    await t.done();
  }
});

test('turning a product on or off is seen by the next request from that product', async () => {
  const t = await setup();
  try {
    await openShop(t);
    const { b } = await accept(t, t.mails[0]);
    const sid = b.cookie('__Secure-of_session');
    const id = ws(t.db, 'dana-shop').id;
    assert.equal((await t.internal(sid, 'toran')).status, 403);
    await t.admin.post(`/admin/workspaces/${id}/products`, { product: 'toran', enabled: '1' });
    assert.equal((await t.internal(sid, 'toran')).status, 200);
    await t.admin.post(`/admin/workspaces/${id}/products`, { product: 'teder', enabled: '0' });
    assert.equal((await t.internal(sid, 'teder')).json.error, 'product_disabled');
    assert.deepEqual((await t.internal(sid)).json.products, ['toran']);
    assert.match((await t.admin.get('/admin/accounts')).body, /תדר כבוי עכשיו ב-חנות של דנה/);
    const home = await b.get('/');
    assert.match(home.body, /כניסה לתורן/);
    assert.doesNotMatch(home.body, /כניסה לתדר/);
  } finally {
    await t.done();
  }
});

test('disabling a workspace shuts its customers out at once; enabling lets them back', async () => {
  const t = await setup();
  try {
    await openShop(t);
    const { b } = await accept(t, t.mails[0]);
    const sid = b.cookie('__Secure-of_session');
    const id = ws(t.db, 'dana-shop').id;
    await t.admin.post(`/admin/workspaces/${id}/disable`);
    assert.deepEqual((await t.internal(sid)).json, { error: 'workspace_disabled' });
    const home = await b.get('/');
    assert.equal(home.status, 403);
    assert.match(home.body, /החשבון של חנות של דנה סגור כרגע/);
    // No new invites into a disabled workspace.
    const inv = await t.admin.post(`/admin/workspaces/${id}/invite`, { email: 'x@example.com', role: 'client_member' });
    assert.equal(inv.status, 400);
    assert.match(inv.body, /החשבון הזה מושבת/);
    await t.admin.post(`/admin/workspaces/${id}/enable`);
    assert.equal((await t.internal(sid)).status, 200);
  } finally {
    await t.done();
  }
});

test('view-as: read-only, names the superadmin, lands in the product, shows a banner, and is audited', async () => {
  const t = await setup();
  try {
    await openShop(t, { products: ['teder', 'toran'] });
    const id = ws(t.db, 'dana-shop').id;
    const r = await t.admin.post(`/admin/workspaces/${id}/view-as`, { product: 'toran' });
    assert.equal(r.headers.location, 'https://toran.openfrequency.co.il/');
    const who = await t.internal(t.admin.cookie('__Secure-of_session'), 'toran');
    assert.equal(who.json.readOnly, true);
    assert.equal(who.json.workspace.slug, 'dana-shop');
    assert.equal(who.json.viewAs.by.email, EMAIL);
    assert.equal(who.json.role, 'superadmin');

    const page = await t.admin.get('/admin/accounts');
    assert.match(page.body, /אתם צופים ב-חנות של דנה כמו שהלקוח רואה אותו\. זו צפייה בלבד, ושום שינוי לא נשמר\./);
    await t.admin.post('/admin/view-as/stop');
    const back = await t.internal(t.admin.cookie('__Secure-of_session'));
    assert.equal(back.json.readOnly, false);
    assert.equal(back.json.workspace, null);
    assert.doesNotMatch((await t.admin.get('/admin/accounts')).body, /אתם צופים/);

    const log = t.db.all("SELECT action, actor, workspace_id, detail_json FROM audit WHERE action LIKE 'view_as%' ORDER BY id");
    assert.deepEqual(log.map((a) => [a.action, a.actor, a.workspace_id]), [
      ['view_as_start', EMAIL, id],
      ['view_as_stop', EMAIL, id],
    ]);
    assert.match(log[1].detail_json, /"since":"2026-10-22T10:00:15\.000Z"/);
  } finally {
    await t.done();
  }
});

test('an unused invite can be cancelled', async () => {
  const t = await setup();
  try {
    await openShop(t);
    const tokenId = t.db.get("SELECT id FROM tokens WHERE kind = 'invite'").id;
    await t.admin.post(`/admin/invites/${tokenId}/revoke`);
    assert.match((await t.admin.get('/admin/accounts')).body, /ביטלנו את ההזמנה ל-dana@example\.com/);
    assert.equal((await t.browser().get(pathOf(t.mails[0].link))).status, 410);
  } finally {
    await t.done();
  }
});

test('every console action is in the audit log, with who did it, and shown on the page', async () => {
  const t = await setup();
  try {
    await openShop(t);
    const id = ws(t.db, 'dana-shop').id;
    await t.admin.post(`/admin/workspaces/${id}/products`, { product: 'toran', enabled: '1' });
    await t.admin.post(`/admin/workspaces/${id}/disable`);
    await t.admin.post(`/admin/workspaces/${id}/enable`);
    const actions = t.db.all('SELECT action, actor FROM audit WHERE actor = ? ORDER BY id', EMAIL).map((a) => a.action);
    assert.deepEqual(actions, ['superadmin_created', 'sign_in', 'workspace_created', 'invite_sent', 'product_enabled', 'workspace_disabled', 'workspace_enabled']);
    const page = await t.admin.get('/admin/accounts');
    // Shown in Hebrew, with the product named where there is one.
    for (const a of ['חשבון נפתח', 'הזמנה נשלחה', 'מוצר הופעל: תורן', 'חשבון הושבת', 'חשבון הופעל מחדש']) assert.ok(page.body.includes(a), a);
  } finally {
    await t.done();
  }
});

test('names typed into the console are escaped everywhere they are shown', async () => {
  const t = await setup();
  try {
    await openShop(t, { name: '<img src=x onerror=alert(1)>' });
    const page = await t.admin.get('/admin/accounts');
    assert.ok(!page.body.includes('<img src=x'));
    assert.ok(page.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
    const inviteHtml = t.mails[0].html;
    assert.ok(!inviteHtml.includes('<img src=x'));
    const { b } = await accept(t, t.mails[0], { name: '<b>Dana</b>' });
    const home = await b.get('/');
    assert.ok(!home.body.includes('<b>Dana</b>'));
  } finally {
    await t.done();
  }
});

test("the customer's dashboard: each product's subscription, recorded on the console, with the days left and the next charge", async () => {
  const t = await setup();
  try {
    await openShop(t);
    const { b } = await accept(t, t.mails[0]);
    let home = (await b.get('/')).body;
    assert.match(home, /790 ₪ לחודש, לא כולל מע״מ/, 'the list price, from the day it was turned on');
    assert.match(home, /התשלום הראשון יופיע כאן כשנרשום אותו\./);
    assert.match(home, /מנוי מאז 22\.10\.2026/);
    assert.match(home, /עוד מאיתנו[^]*openfrequency\.co\.il\/toran/, 'Toran, which they do not have, is offered');
    assert.match(home, /מי בחשבון[^]*דנה[^]*בעלים/);

    // A month's payment comes in: paid for a month from today.
    const w = ws(t.db, 'dana-shop');
    const paid = await t.admin.post(`/admin/workspaces/${w.id}/subscription/pay`, { product: 'teder' });
    assert.equal(paid.status, 303);
    assert.match((await t.admin.get('/admin/accounts')).body, /חנות של דנה: תדר שולם עד 21\.11\.2026\./);
    home = (await b.get('/')).body;
    assert.match(home, /<span class="tag">פעיל<\/span>/);
    assert.match(home, /נשארו 31 ימים בחודש ששולם/);
    assert.match(home, /<progress max="31" value="1"/);
    assert.match(home, /החיוב הבא: 790 ₪ ועוד מע״מ, ב-22\.11\.2026/);

    // Stopped: its last day is the end of the month paid for.
    await t.admin.post(`/admin/workspaces/${w.id}/subscription`, { product: 'teder', monthly: '790', setup: '1490', vat: 'excluded', started_on: '2026-10-22', paid_until: '2026-11-21', ends_on: '2026-11-21' });
    home = (await b.get('/')).body;
    assert.match(home, /המנוי מסתיים ב-21\.11\.2026\. נשארו 31 ימים\./);
    assert.doesNotMatch(home, /החיוב הבא/);

    // What the console refuses, and what a customer cannot do at all.
    const bad = await t.admin.post(`/admin/workspaces/${w.id}/subscription`, { product: 'teder', monthly: 'abc' });
    assert.equal(bad.status, 400);
    assert.match(bad.body, /המחיר צריך להיות מספר\./);
    const sneak = await b.post(`/admin/workspaces/${w.id}/subscription/pay`, { product: 'teder' });
    assert.equal(sneak.status, 403);
  } finally {
    await t.done();
  }
});

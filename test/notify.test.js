import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { advance, setNow, DAY, MINUTE } from '../src/core/clock.js';
import { checkNotify, NotifyError, oneLine, ourLink, plainText } from '../src/accounts/notify.js';

// POST /internal/notify, as Teder and Toran call it: who gets the email (owners by default, members who turned it on,
// nobody who turned it off), what is made of what they send (one line, plain text, our links only, sizes capped), the
// limit of 3 a day for each workspace, product and kind, and the page where each person chooses (/notifications),
// which every email links to.

const BODY = (ws, fields = {}) => ({
  workspace: ws.id,
  product: 'teder',
  kind: 'posts_waiting',
  subject: '3 פוסטים מחכים לאישור',
  text: 'יש 3 פוסטים חדשים שמחכים לכם.\n\nאפשר לאשר אותם מהטלפון.',
  link: 'https://teder.openfrequency.co.il/review',
  ...fields,
});

async function setup() {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const ws = makeWorkspace(h.db, 'noa-shop', {
    name: 'Noa Shop',
    products: ['teder'],
    comp: true,
    members: { 'noa@example.com': 'client_owner', 'dana@example.com': 'client_owner', 'ron@example.com': 'client_member' },
  });
  const other = makeWorkspace(h.db, 'ron-studio', { name: 'Ron Studio', products: ['toran'], comp: true, members: { 'ron@example.com': 'client_owner' } });
  const site = await startSite(h.db);
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  const notify = (body, headers) => site.owners('POST', '/internal/notify', body, headers);
  return { ...h, ...site, ws, other, user, notify, done: async () => (await site.close(), h.cleanup()) };
}

test('a notification goes to the owners, by default, as plain text with the product\'s link and a footer to turn it off', async () => {
  const t = await setup();
  try {
    const r = await t.notify(BODY(t.ws));
    assert.equal(r.status, 202);
    assert.deepEqual(r.json, { ok: true, sent: 2 });
    assert.deepEqual(t.mails.map((m) => m.to).sort(), ['dana@example.com', 'noa@example.com']);
    const m = t.mails[0];
    assert.equal(m.subject, '3 פוסטים מחכים לאישור');
    assert.equal(m.link, 'https://teder.openfrequency.co.il/review');
    assert.match(m.text, /יש 3 פוסטים חדשים שמחכים לכם\.\n\nאפשר לאשר אותם מהטלפון\./);
    const manage = `https://accounts.openfrequency.co.il/notifications?workspace=${t.ws.id}`;
    assert.match(m.text, new RegExp(`קיבלתם את המייל הזה כי ההתראות על פוסטים שמחכים לאישור בתדר פועלות אצלכם\\.\\n${manage.replace(/[.?]/g, '\\$&')}`));
    assert.ok(m.html.includes(`<a href="${manage}" style="color:#56565b">לשנות את ההתראות</a>`));
    assert.match(m.html, />לפתוח את תדר<\/a>/);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'notify_sent' AND workspace_id = ?", t.ws.id));
  } finally {
    await t.done();
  }
});

test('what a product sends is made safe: one-line subject, no control characters or bidi overrides, escaped, its html never used', async () => {
  const t = await setup();
  try {
    const r = await t.notify(
      BODY(t.ws, {
        subject: 'פוסט\r\nBcc: evil@example.com ‮מחכה\u0007',
        text: 'שורה\u0000 אחת <b>מודגשת</b>\r\n\r\n\r\n\r\nשורה ⁦שנייה⁩',
        html: '<script>alert(1)</script><img src=x onerror=alert(1)>',
      })
    );
    assert.equal(r.status, 202);
    const m = t.mails[0];
    assert.equal(m.subject, 'פוסט Bcc: evil@example.com מחכה');
    assert.doesNotMatch(m.subject, /[\r\n‮\u0007]/);
    assert.match(m.text, /שורה אחת <b>מודגשת<\/b>\n\nשורה שנייה/);
    assert.doesNotMatch(m.text, /[\u0000⁦⁩]/);
    assert.ok(m.html.includes('&lt;b&gt;מודגשת&lt;/b&gt;'));
    assert.doesNotMatch(m.html, /<script|<img|<b>/);
    assert.equal(oneLine('x'.repeat(500)).length, 150);
    assert.equal(plainText('a\n\n\n\nb'), 'a\n\nb');
  } finally {
    await t.done();
  }
});

test('the request is checked: each bad field is a 400 with its code, a workspace we do not have 404, a product it does not have 409', async () => {
  const t = await setup();
  try {
    const cases = [
      [{ workspace: String(t.ws.id) }, 'bad_workspace'],
      [{ workspace: 0 }, 'bad_workspace'],
      [{ workspace: 1.5 }, 'bad_workspace'],
      [{ product: 'other' }, 'bad_product'],
      [{ kind: 'daily' }, 'bad_kind'],
      [{ subject: '' }, 'bad_subject'],
      [{ subject: ' ‮\r\n ' }, 'bad_subject'],
      [{ subject: 5 }, 'bad_subject'],
      [{ subject: 'x'.repeat(201) }, 'bad_subject'],
      [{ text: '' }, 'bad_text'],
      [{ text: 'x'.repeat(5001) }, 'bad_text'],
      [{ html: 5 }, 'bad_html'],
      [{ link: 'http://teder.openfrequency.co.il/x' }, 'bad_link'],
      [{ link: 'https://evil.example/' }, 'bad_link'],
      [{ link: 'https://teder.openfrequency.co.il.evil.example/' }, 'bad_link'],
      [{ link: 'https://user:pw@teder.openfrequency.co.il/' }, 'bad_link'],
      [{ link: 'https://teder.openfrequency.co.il:8443/' }, 'bad_link'],
      [{ link: 'javascript:alert(1)' }, 'bad_link'],
      [{ link: '/review' }, 'bad_link'],
      [{ link: undefined }, 'bad_link'],
    ];
    for (const [fields, code] of cases) {
      const r = await t.notify(BODY(t.ws, fields));
      assert.equal(r.status, 400, JSON.stringify(fields).slice(0, 80));
      assert.deepEqual(r.json, { error: code }, JSON.stringify(fields).slice(0, 80));
    }
    assert.deepEqual((await t.notify('not json')).json, { error: 'bad' });
    assert.deepEqual((await t.notify('[1]')).json, { error: 'bad' });
    assert.equal((await t.notify(BODY(t.ws, { html: 'x'.repeat(300_000) }))).status, 413);
    assert.deepEqual((await t.notify(BODY(t.ws, { workspace: 999 }))).json, { error: 'no_workspace' });
    const off = await t.notify(BODY(t.ws, { product: 'toran' }));
    assert.deepEqual([off.status, off.json], [409, { error: 'product_off' }]);
    assert.equal((await t.notify(BODY(t.ws), { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await t.owners('GET', '/internal/notify')).status, 405);
    assert.equal(t.mails.length, 0);
    // The checks, without a network.
    assert.throws(() => checkNotify(null), NotifyError);
    assert.equal(ourLink('https://openfrequency.co.il/a'), 'https://openfrequency.co.il/a');
    assert.equal(ourLink('https://toran.openfrequency.co.il/a b'), null);
  } finally {
    await t.done();
  }
});

test('3 of one kind a day for each workspace and product, then 429; another kind still goes; a day later it goes again', async () => {
  const t = await setup();
  try {
    for (let i = 0; i < 3; i++) assert.equal((await t.notify(BODY(t.ws, { kind: 'weekly' }))).status, 202);
    const limited = await t.notify(BODY(t.ws, { kind: 'weekly' }));
    assert.deepEqual([limited.status, limited.json], [429, { error: 'rate_limited' }]);
    assert.equal(t.mails.length, 6);
    assert.equal((await t.notify(BODY(t.ws, { kind: 'publish_failed' }))).status, 202);
    advance(DAY + MINUTE);
    assert.equal((await t.notify(BODY(t.ws, { kind: 'weekly' }))).status, 202);
  } finally {
    await t.done();
  }
});

test('/notifications: each person chooses per product and kind; an opt-out is skipped, a member who opts in gets it', async () => {
  const t = await setup();
  try {
    const noa = signedIn(t, t.db, t.user('noa@example.com'));
    // The owner's page: Teder only (the workspace's one product), every kind ticked.
    let page = await noa.get('/notifications');
    assert.equal(page.status, 200);
    assert.equal((page.body.match(/<input type="checkbox" name="on" value="teder:[a-z_]+" checked>/g) || []).length, 5);
    assert.doesNotMatch(page.body, /value="toran:/);
    assert.match(page.body, /פוסטים שמחכים לאישור[^]*סיכום שבועי[^]*סיכום חודשי[^]*חשבון שצריך לחבר מחדש[^]*פרסום שלא הצליח/);
    // Noa turns "posts waiting" off.
    const saved = await noa.post('/notifications', { workspace: String(t.ws.id), on: ['teder:weekly', 'teder:monthly', 'teder:connect_needed', 'teder:publish_failed'] });
    assert.equal(saved.headers.location, '/notifications');
    page = await noa.get('/notifications');
    assert.match(page.body, /שמרנו\. מעכשיו נשלח לכם רק את מה שסימנתם\./);
    assert.match(page.body, /value="teder:posts_waiting">/);
    // Ron, a member, gets nothing by default; he turns one on. He is in two workspaces: the footer's link opens this one.
    const ron = signedIn(t, t.db, t.user('ron@example.com'));
    page = await ron.get(`/notifications?workspace=${t.ws.id}`);
    assert.equal(page.status, 200);
    assert.equal((page.body.match(/ checked>/g) || []).length, 0);
    await ron.post('/notifications', { workspace: String(t.ws.id), on: ['teder:posts_waiting'] });

    const r = await t.notify(BODY(t.ws));
    assert.deepEqual(r.json, { ok: true, sent: 2 });
    assert.deepEqual(t.mails.map((m) => m.to).sort(), ['dana@example.com', 'ron@example.com']);
    // Another kind: Noa still gets it, Ron does not.
    t.mails.length = 0;
    await t.notify(BODY(t.ws, { kind: 'weekly' }));
    assert.deepEqual(t.mails.map((m) => m.to).sort(), ['dana@example.com', 'noa@example.com']);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'notify_prefs_saved'"));

    // Linked from the account page; signed out, it asks to sign in and comes back.
    assert.match((await noa.get('/')).body, /<a class="button" href="\/notifications">התראות במייל<\/a>/);
    const out = await t.browser().get(`/notifications?workspace=${t.ws.id}`);
    assert.equal(out.headers.location, `/login?next=${encodeURIComponent(`/notifications?workspace=${t.ws.id}`)}`);
  } finally {
    await t.done();
  }
});

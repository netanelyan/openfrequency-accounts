import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { pathOf, startSite, tokenOf } from './site.js';
import { advance, now, setNow, HOUR } from '../src/core/clock.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { teamOf, TEAM_LIMIT } from '../src/accounts/team.js';
import { supportUrl } from '../src/web/app.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';

// The team on the home page: a workspace's owner invites people by email, sees the invites still waiting, cancels
// one, and removes someone. Three people at most, the owner and the waiting invites included; past that the form
// gives way to a line about talking to us, and the server refuses a fourth even when the form is skipped.

const EMAIL = 'admin@example.com';
const PASSWORD = 'a long enough password';
const SUPPORT = 'https://wa.me/972500000000';

async function setup({ members = {}, env = { OF_SUPPORT_URL: SUPPORT } } = {}) {
  const h = tempHome();
  setNow('2026-10-22T10:00:15.000Z');
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: EMAIL, password: PASSWORD, totpSecret: secret });
  const ws = makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', members: { 'dana@example.com': 'client_owner', ...members } });
  const other = makeWorkspace(h.db, 'yossi-cafe', { name: 'הקפה של יוסי', members: { 'yossi@example.com': 'client_owner', 'avi@example.com': 'client_member' } });
  const site = await startSite(h.db, { env });
  const t = { ...h, ...site, ws, other, done: async () => (await site.close(), h.cleanup()) };
  t.admin = async () => {
    const admin = site.browser({ ip: '192.0.2.1' });
    await admin.get('/admin/login');
    await admin.post('/admin/login', { email: EMAIL, password: PASSWORD, code: totpCode(secret, stepAt(now())) });
    return admin;
  };
  return t;
}

/** A customer signed in with an emailed link. */
async function signIn(t, email) {
  const b = t.browser({ ip: `203.0.113.${t.mails.length + 20}` });
  await b.get('/login');
  await b.post('/login', { email });
  const link = t.mails.at(-1).link;
  await b.get(pathOf(link));
  await b.post('/auth/link', { t: tokenOf(link) });
  await b.get('/');
  return b;
}

const invites = (t) => t.db.get("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'invite' AND used_at IS NULL").n;
const teamCard = (html) => /<section class="card team" id="team">[^]*?<\/section>/.exec(html)[0];

test('an owner invites someone by email; the invite waits on the page, can be cancelled, and joins them when accepted', async () => {
  const t = await setup();
  try {
    const dana = await signIn(t, 'dana@example.com');
    let card = teamCard((await dana.get('/')).body);
    assert.match(card, /<span class="muted">1 מתוך 3<\/span>/);
    assert.match(card, /נשאר מקום לעוד 2 אנשים\. בחשבון יש מקום ל-3 אנשים, כולל אתכם וכולל הזמנות שעוד לא התקבלו\./);

    const r = await dana.post('/team/invite', { email: ' Noa@Example.com ', role: 'client_member' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/#team');
    const mail = t.mails.at(-1);
    assert.equal(mail.to, 'noa@example.com');
    assert.equal(mail.subject, 'הזמנה ל-החנות של דנה ב-OpenFrequency', 'the same invite the console sends');
    assert.match(mail.link, /^https:\/\/accounts\.openfrequency\.co\.il\/invite\?t=/);
    let home = (await dana.get('/')).body;
    assert.match(home, /<p class="flash" role="status">שלחנו הזמנה ל-noa@example\.com\. היא עובדת 72 שעות\.<\/p>/);
    card = teamCard(home);
    assert.match(card, /2 מתוך 3/);
    assert.match(card, /<li class="waiting"><span class="who"><bdi class="ltr">noa@example\.com<\/bdi><small>הזמנה נשלחה, מחכה עד 25\.10\.2026, 12:00<\/small><\/span><span class="muted end">צוות<\/span>/);
    assert.match(card, /נשאר מקום לעוד אדם אחד/);

    // Sent again to the same address: the first link stops working, and it still takes one place.
    await dana.post('/team/invite', { email: 'noa@example.com', role: 'client_member' });
    assert.equal((await t.browser().get(pathOf(mail.link))).status, 410);
    assert.equal(teamOf(t.db, t.ws.id).taken, 2);
    const second = t.mails.at(-1);

    // Cancelled from the page: the link is dead and the place is free.
    const tokenId = t.db.get("SELECT id FROM tokens WHERE kind = 'invite' AND used_at IS NULL AND email = 'noa@example.com'").id;
    await dana.post(`/team/invites/${tokenId}/cancel`);
    assert.match((await dana.get('/')).body, /ביטלנו את ההזמנה ל-noa@example\.com\./);
    assert.equal((await t.browser().get(pathOf(second.link))).status, 410);
    assert.equal(teamOf(t.db, t.ws.id).taken, 1);

    // Invited as an owner and accepted: in the account with that role.
    await dana.post('/team/invite', { email: 'roni@example.com', role: 'client_owner' });
    const roni = t.browser({ ip: '203.0.113.90' });
    await roni.get(pathOf(t.mails.at(-1).link));
    await roni.post('/invite', { t: tokenOf(t.mails.at(-1).link), name: 'רוני' });
    assert.equal((await t.internal(roni.cookie('__Secure-of_session'))).json.role, 'client_owner');
    card = teamCard((await dana.get('/')).body);
    assert.match(card, /רוני[^]*roni@example\.com[^]*בעלים/);
    assert.doesNotMatch(card, /class="waiting"/);
    assert.deepEqual(
      t.db.all("SELECT action, actor FROM audit WHERE action LIKE 'invite_%' ORDER BY id").map((a) => [a.action, a.actor]),
      [
        ['invite_sent', 'dana@example.com'],
        ['invite_revoked', 'dana@example.com'],
        ['invite_sent', 'dana@example.com'],
        ['invite_revoked', 'dana@example.com'],
        ['invite_sent', 'dana@example.com'],
        ['invite_accepted', 'roni@example.com'],
      ]
    );
  } finally {
    await t.done();
  }
});

test('three people at most, the owner and the invites still waiting included; then a line to talk to us, and the server refuses a fourth', async () => {
  const t = await setup({ members: { 'noa@example.com': 'client_member' } });
  try {
    assert.equal(TEAM_LIMIT, 3);
    const dana = await signIn(t, 'dana@example.com');
    await dana.post('/team/invite', { email: 'roni@example.com', role: 'client_member' });
    const card = teamCard((await dana.get('/')).body);
    assert.match(card, /3 מתוך 3/);
    assert.doesNotMatch(card, /action="\/team\/invite"/, 'the form is gone');
    assert.match(card, /<div class="team-full" role="note"><p>בחשבון יש כבר 3 אנשים, כולל הזמנות שעוד לא התקבלו\. כדי להוסיף עוד, דברו איתנו\.<\/p><p><a class="button primary" href="https:\/\/wa\.me\/972500000000">כתבו לנו<\/a><\/p><\/div>/);

    // The form skipped: refused, nothing sent, nothing stored.
    const mails = t.mails.length;
    const r = await dana.post('/team/invite', { email: 'gal@example.com', role: 'client_member' });
    assert.equal(r.status, 400);
    assert.match(r.body, /<p class="error" id="team-err" role="alert">בחשבון יש כבר 3 אנשים, כולל הזמנות שעוד לא התקבלו\. כדי להוסיף עוד, דברו איתנו\.<\/p>/);
    assert.equal(t.mails.length, mails);
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM tokens WHERE email = 'gal@example.com'").n, 0);
    // Someone already in is refused for what it is, not as a fourth.
    assert.match((await dana.post('/team/invite', { email: 'NOA@example.com', role: 'client_member' })).body, /הכתובת הזאת כבר בחשבון\./);

    // The waiting invite runs out after 72 hours, and its place is free again.
    advance(72 * HOUR);
    assert.match(teamCard((await dana.get('/')).body), /2 מתוך 3[^]*action="\/team\/invite"/);
    assert.equal((await dana.post('/team/invite', { email: 'gal@example.com', role: 'client_member' })).status, 303);
  } finally {
    await t.done();
  }
});

test('two invites sent at once for the last place: one is sent, the other refused', async () => {
  const t = await setup({ members: { 'noa@example.com': 'client_member' } });
  try {
    const dana = await signIn(t, 'dana@example.com');
    const before = invites(t);
    const [a, b] = await Promise.all([dana.post('/team/invite', { email: 'gal@example.com', role: 'client_member' }), dana.post('/team/invite', { email: 'roni@example.com', role: 'client_member' })]);
    assert.deepEqual([a.status, b.status].sort(), [303, 400]);
    assert.equal(invites(t), before + 1);
    assert.equal(teamOf(t.db, t.ws.id).taken, 3);
  } finally {
    await t.done();
  }
});

test('the operator is not limited: the console adds a fourth, and the page counts them all', async () => {
  const t = await setup({ members: { 'noa@example.com': 'client_member', 'roni@example.com': 'client_member' } });
  try {
    const admin = await t.admin();
    const r = await admin.post(`/admin/workspaces/${t.ws.id}/invite`, { email: 'gal@example.com', role: 'client_member' });
    assert.equal(r.status, 303);
    assert.equal(t.mails.at(-1).to, 'gal@example.com');
    const dana = await signIn(t, 'dana@example.com');
    const card = teamCard((await dana.get('/')).body);
    assert.match(card, /<span class="muted">4 אנשים<\/span>/);
    assert.match(card, /gal@example\.com/);
    assert.match(card, /class="team-full"/);
    assert.equal((await dana.post('/team/invite', { email: 'lior@example.com', role: 'client_member' })).status, 400);
  } finally {
    await t.done();
  }
});

test('an owner removes someone, never themselves; the one removed is out of the workspace on their next request', async () => {
  const t = await setup({ members: { 'noa@example.com': 'client_member', 'roni@example.com': 'client_owner' } });
  try {
    const dana = await signIn(t, 'dana@example.com');
    const noa = await signIn(t, 'noa@example.com');
    const id = (email) => t.db.get('SELECT id FROM users WHERE email = ?', email).id;
    const card = teamCard((await dana.get('/')).body);
    assert.doesNotMatch(card, new RegExp(`/team/members/${id('dana@example.com')}/remove`), 'no button to remove themselves');
    assert.match(card, new RegExp(`action="/team/members/${id('noa@example.com')}/remove"[^]*?aria-label="הסרה של noa@example\\.com מהחשבון"`));

    const self = await dana.post(`/team/members/${id('dana@example.com')}/remove`);
    assert.equal(self.status, 400);
    assert.match(self.body, /אי אפשר להסיר את עצמכם מהחשבון\./);

    assert.equal((await dana.post(`/team/members/${id('noa@example.com')}/remove`)).status, 303);
    assert.match((await dana.get('/')).body, /noa@example\.com כבר לא בחשבון\./);
    assert.equal((await t.internal(noa.cookie('__Secure-of_session'))).json.error, 'choose_workspace', 'out, on the very next request');
    assert.equal((await noa.get('/')).headers.location, '/workspace');
    // Another owner can be removed too: Dana stays, the last owner.
    assert.equal((await dana.post(`/team/members/${id('roni@example.com')}/remove`)).status, 303);
    assert.equal(teamOf(t.db, t.ws.id).taken, 1);
    assert.deepEqual(t.db.all("SELECT detail_json FROM audit WHERE action = 'member_removed' ORDER BY id").map((a) => JSON.parse(a.detail_json).email), ['noa@example.com', 'roni@example.com']);
  } finally {
    await t.done();
  }
});

test('a member sees the team and cannot change it; nobody changes another workspace, and the superadmin changes nothing here', async () => {
  const t = await setup({ members: { 'noa@example.com': 'client_member' } });
  try {
    const dana = await signIn(t, 'dana@example.com');
    await dana.post('/team/invite', { email: 'roni@example.com', role: 'client_member' });
    const tokenId = t.db.get("SELECT id FROM tokens WHERE email = 'roni@example.com'").id;
    const danaId = t.db.get("SELECT id FROM users WHERE email = 'dana@example.com'").id;

    const noa = await signIn(t, 'noa@example.com');
    const card = teamCard((await noa.get('/')).body);
    assert.match(card, /דנה|dana@example\.com/);
    assert.match(card, /roni@example\.com/, 'the waiting invite too');
    assert.match(card, /רק בעלי החשבון מוסיפים ומסירים אנשים\./);
    assert.doesNotMatch(card, /<form/);
    for (const [path, fields] of [
      ['/team/invite', { email: 'gal@example.com', role: 'client_member' }],
      [`/team/invites/${tokenId}/cancel`, {}],
      [`/team/members/${danaId}/remove`, {}],
    ]) {
      const r = await noa.post(path, fields);
      assert.equal(r.status, 403, path);
      assert.match(r.body, /רק בעלי החשבון מוסיפים ומסירים אנשים\./);
    }
    assert.equal(teamOf(t.db, t.ws.id).taken, 3);

    // Yossi owns the other workspace: Dana's invite and Dana's people are not his to touch.
    const yossi = await signIn(t, 'yossi@example.com');
    await yossi.post(`/team/invites/${tokenId}/cancel`);
    await yossi.post(`/team/members/${danaId}/remove`);
    assert.equal(teamOf(t.db, t.ws.id).taken, 3);
    assert.equal(t.db.get('SELECT used_at FROM tokens WHERE id = ?', tokenId).used_at, null);
    // Nor can Dana touch Yossi's.
    const aviId = t.db.get("SELECT id FROM users WHERE email = 'avi@example.com'").id;
    await dana.post(`/team/members/${aviId}/remove`);
    assert.equal(teamOf(t.db, t.other.id).taken, 2);

    // The superadmin, in view-as or not: refused; signed out: to the sign-in page.
    const admin = await t.admin();
    await admin.post(`/admin/workspaces/${t.ws.id}/view-as`, { product: 'teder' });
    const r = await admin.post('/team/invite', { email: 'gal@example.com', role: 'client_member' });
    assert.equal(r.status, 403);
    assert.match(r.body, /את האנשים בחשבון של לקוח משנים מהקונסולה/);
    const anon = t.browser();
    await anon.get('/login');
    assert.equal((await anon.post('/team/invite', { email: 'gal@example.com', role: 'client_member' })).headers.location, '/login');
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM tokens WHERE email = 'gal@example.com'").n, 0);
  } finally {
    await t.done();
  }
});

test('what the invite form refuses, in Hebrew, keeping what was typed', async () => {
  const t = await setup();
  try {
    const dana = await signIn(t, 'dana@example.com');
    for (const [fields, message] of [
      [{ email: 'not an email', role: 'client_member' }, 'המייל הזה לא נראה תקין'],
      [{ email: 'gal@example.com', role: 'superadmin' }, 'צריך לבחור תפקיד'],
      [{ email: EMAIL, role: 'client_member' }, 'אי אפשר להזמין את הכתובת הזאת'],
      [{ email: 'dana@example.com', role: 'client_member' }, 'הכתובת הזאת כבר בחשבון'],
    ]) {
      const r = await dana.post('/team/invite', fields);
      assert.equal(r.status, 400, JSON.stringify(fields));
      assert.match(r.body, new RegExp(message));
      assert.ok(r.body.includes(`value="${fields.email}"`), 'the form keeps what was typed');
    }
    assert.equal(t.mails.length, 1, 'only the sign-in link');
  } finally {
    await t.done();
  }
});

test('the support contact: OF_SUPPORT_URL, else a mail to MAIL_REPLY_TO, else the page says to answer one of our emails', async () => {
  assert.equal(supportUrl({ OF_SUPPORT_URL: SUPPORT, MAIL_REPLY_TO: 'help@example.com' }), SUPPORT);
  assert.equal(supportUrl({ OF_SUPPORT_URL: 'mailto:help@example.com' }), 'mailto:help@example.com');
  assert.equal(supportUrl({ MAIL_REPLY_TO: 'help@example.com' }), 'mailto:help@example.com');
  assert.equal(supportUrl({ OF_SUPPORT_URL: 'javascript:alert(1)' }), null, 'only a link that goes somewhere');
  assert.equal(supportUrl({ OF_SUPPORT_URL: 'http://example.com' }), null);
  assert.equal(supportUrl({}), null);

  const t = await setup({ members: { 'noa@example.com': 'client_member', 'roni@example.com': 'client_member' }, env: {} });
  try {
    const home = (await signIn(t, 'dana@example.com').then((b) => b.get('/'))).body;
    assert.match(teamCard(home), /<div class="team-full" role="note"><p>בחשבון יש כבר 3 אנשים, כולל הזמנות שעוד לא התקבלו\. כדי להוסיף עוד, ענו לאחד המיילים שקיבלתם מאיתנו\.<\/p><\/div>/);
    assert.match(home, /שאלה על המנוי או על החיוב\? ענו לאחד המיילים שקיבלתם מאיתנו\./);
  } finally {
    await t.done();
  }
});

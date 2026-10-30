import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome, withoutLoadJs } from './helpers.js';
import { pathOf, startSite, tokenOf } from './site.js';
import { advance, setNow, MINUTE } from '../src/core/clock.js';
import { createLimiter, LIMITS } from '../src/auth/limiter.js';
import { acceptInvite, createInvite } from '../src/accounts/links.js';
import { openFlow } from '../src/auth/google.js';
import { checkSignup, SignupError, signupProducts, TERMS_VERSION } from '../src/accounts/signup.js';
import { createWorkspace } from '../src/accounts/workspaces.js';

// Public sign-up end to end, over HTTP: closed and open, the form's checks, the honeypot, the limits, the email's
// link that opens one user and one workspace with the products chosen and nothing else, an address that already
// has an account, and "continue with Google" with Google played by a fake token endpoint (as in google.test.js).

const OPEN = { OF_SIGNUP: '1' };
const CLIENT = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'not-a-real-secret' };
const FORM = { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa@example.com', products: ['teder'], terms: '1', website: '', via: 'email' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJl`;

function fakeGoogle() {
  const g = {
    answer: null,
    fetch: async (url, init) => ({ ok: true, json: async () => ({ access_token: 'x', id_token: jwt(g.answer(Object.fromEntries(new URLSearchParams(init.body)))) }) }),
  };
  return g;
}

async function setup({ env = OPEN, limiters, ...opts } = {}) {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const g = fakeGoogle();
  const site = await startSite(h.db, { env, googleFetch: g.fetch, ...(limiters ? { limiters } : {}), ...opts });
  return { ...h, ...site, g, done: async () => (await site.close(), h.cleanup()) };
}

const count = (db, sql, ...args) => db.get(`SELECT COUNT(*) AS n FROM ${sql}`, ...args).n;

async function signUp(b, fields = {}) {
  await b.get('/signup');
  return b.post('/signup', { ...FORM, ...fields });
}

test('closed (OF_SIGNUP unset, or anything but "1"): the page says it opens soon, every POST is refused, nothing is kept', async () => {
  for (const env of [{}, { OF_SIGNUP: 'yes' }, { OF_SIGNUP: '0' }]) {
    const t = await setup({ env });
    try {
      const b = t.browser();
      const page = await b.get('/signup');
      assert.equal(page.status, 200);
      assert.match(page.body, /ההרשמה תיפתח בקרוב/);
      assert.match(page.body, /<a href="https:\/\/openfrequency\.co\.il\/join">להשארת פרטים<\/a>/);
      assert.doesNotMatch(page.body, /name="business"/);
      await b.get('/login');
      const r = await b.post('/signup', FORM);
      assert.equal(r.status, 403);
      assert.match(r.body, /ההרשמה תיפתח בקרוב/);
      assert.equal((await b.post('/signup/confirm', { t: 'x'.repeat(43) })).status, 403);
      assert.equal((await b.get(`/signup/confirm?t=${'x'.repeat(43)}`)).status, 200);
      assert.equal(count(t.db, 'signups'), 0);
      assert.equal(t.mails.length, 0);
      // The login page does not point to it.
      const login = await t.browser().get('/login');
      assert.doesNotMatch(login.body, /href="\/signup"/);
      assert.match(login.body, /אנחנו פותחים אותו ושולחים לכם הזמנה במייל/);
    } finally {
      await t.done();
    }
  }
});

test('open: the form asks for the name, the business, the products with a line each, the terms, and the email', async () => {
  const t = await setup();
  try {
    const page = await t.browser().get('/signup');
    assert.equal(page.status, 200);
    for (const field of ['name="name"', 'name="business"', 'name="email"', 'name="products" value="toran"', 'name="products" value="teder"', 'name="terms" value="1" required', 'name="website" tabindex="-1"', 'name="_csrf"'])
      assert.ok(page.body.includes(field), field);
    assert.match(page.body, /עונה ללקוחות שלכם בוואטסאפ/);
    assert.match(page.body, /מצגות בעברית לטיקטוק, לאינסטגרם ולפייסבוק/);
    assert.match(page.body, /href="https:\/\/openfrequency\.co\.il\/terms"/);
    assert.match(page.body, /href="https:\/\/openfrequency\.co\.il\/privacy"/);
    // No Google button while Google is not set up, and no script on the page.
    assert.doesNotMatch(page.body, /value="google"/);
    assert.doesNotMatch(withoutLoadJs(page.body), /<script/);
    // Only our own files run (load.js), never anything written into a page.
    assert.match(page.headers['content-security-policy'], /script-src 'self';/);
    assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline|unsafe-eval|nonce-/);
    // The login page points to it.
    assert.match((await t.browser().get('/login')).body, /עוד אין לכם חשבון\? <a href="\/signup">להרשמה<\/a>/);
    // Nothing is chosen with both open, and the website's button (?p=) chooses its product; an unknown one, nothing.
    assert.doesNotMatch(page.body, /value="(toran|teder)" checked/);
    assert.match((await t.browser().get('/signup?p=teder')).body, /value="teder" checked/);
    const toran = (await t.browser().get('/signup?p=toran')).body;
    assert.match(toran, /value="toran" checked/);
    assert.doesNotMatch(toran, /value="teder" checked/);
    assert.doesNotMatch((await t.browser().get('/signup?p=nope')).body, /value="(toran|teder)" checked/);
  } finally {
    await t.done();
  }
});

test("the form's checks: each mistake is said, the answers are kept (escaped), and nothing is kept or sent", async () => {
  const t = await setup();
  try {
    const cases = [
      [{ name: ' ' }, /צריך את השם המלא שלכם/],
      [{ name: 'x'.repeat(81) }, /צריך את השם המלא שלכם/],
      [{ business: 'x' }, /צריך את שם העסק, בין 2 ל-80 תווים/],
      [{ business: 'b'.repeat(81) }, /צריך את שם העסק/],
      [{ products: [] }, /צריך לבחור לפחות מוצר אחד/],
      [{ products: ['other'] }, /צריך לבחור לפחות מוצר אחד/],
      [{ terms: '' }, /צריך להסכים לתנאי השימוש ולמדיניות הפרטיות/],
      [{ email: 'not an email' }, /לא נראית כמו כתובת מייל/],
      [{ email: 'a@b' }, /לא נראית כמו כתובת מייל/],
    ];
    for (const [fields, said] of cases) {
      const b = t.browser();
      const r = await signUp(b, fields);
      assert.equal(r.status, 400, JSON.stringify(fields));
      assert.match(r.body, said);
    }
    const b = t.browser();
    const r = await signUp(b, { business: '<b>Noa</b> "x"', terms: '' });
    assert.ok(r.body.includes('value="&lt;b&gt;Noa&lt;/b&gt; &quot;x&quot;"'));
    assert.ok(r.body.includes('name="products" value="teder" checked'));
    assert.doesNotMatch(r.body, /<b>Noa<\/b>/);
    assert.equal(count(t.db, 'signups'), 0);
    assert.equal(t.mails.length, 0);
    // Without the CSRF token, or from another site: refused before anything is read.
    const fresh = t.browser();
    assert.equal((await fresh.post('/signup', FORM)).status, 403);
    const cross = t.browser({ origin: 'https://evil.example' });
    await cross.get('/signup');
    assert.equal((await cross.post('/signup', FORM)).status, 403);
    assert.equal(count(t.db, 'signups'), 0);
  } finally {
    await t.done();
  }
});

test('checkSignup trims, keeps only known products, and refuses control characters as spaces', () => {
  const ok = checkSignup({ name: '  Noa‮ Levi ', business: 'Noa\u0000Shop', email: ' NOA@Example.com ', products: ['teder', 'x', 'toran'], terms: true });
  // Teder's plan: the full one unless another is chosen; none without Teder; one that does not exist refused.
  assert.deepEqual(ok, { name: 'Noa Levi', business: 'Noa Shop', email: 'noa@example.com', products: ['teder', 'toran'], plan: 'full' });
  assert.equal(checkSignup({ ...ok, plan: 'small', terms: true }).plan, 'small');
  assert.equal(checkSignup({ ...ok, products: ['toran'], plan: 'small', terms: true }).plan, null);
  assert.throws(() => checkSignup({ ...ok, plan: 'huge', terms: true }), (e) => e instanceof SignupError && e.code === 'bad_plan');
  assert.equal(checkSignup({ ...ok, email: '', terms: true }, { needEmail: false }).email, null);
  assert.throws(() => checkSignup({ ...ok, terms: false }), (e) => e instanceof SignupError && e.code === 'no_terms');
});

test('the honeypot: filled, the page looks like a real sign-up, and nothing is kept or sent', async () => {
  const t = await setup();
  try {
    const r = await signUp(t.browser(), { website: 'https://spam.example' });
    assert.equal(r.status, 200);
    assert.match(r.body, /בדקו את המייל/);
    assert.equal(count(t.db, 'signups'), 0);
    assert.equal(t.mails.length, 0);
  } finally {
    await t.done();
  }
});

test('the limits: 3 sign-ups an address in 15 minutes, 5 an IP in an hour', async () => {
  const t = await setup({ limiters: { signupEmail: createLimiter(LIMITS.signupPerEmail), signupIp: createLimiter(LIMITS.signupPerIp) } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await signUp(t.browser({ ip: `198.51.100.${i + 1}` }))).status, 200);
    const fourth = await signUp(t.browser({ ip: '198.51.100.9' }));
    assert.equal(fourth.status, 429);
    assert.match(fourth.body, /נסו שוב בעוד 15 דקות/);
    assert.equal(fourth.headers['retry-after'], '900');
    assert.equal(t.mails.length, 3);

    const ip = '203.0.113.77';
    for (let i = 0; i < 5; i++) assert.equal((await signUp(t.browser({ ip }), { email: `shop${i}@example.com` })).status, 200);
    const sixth = await signUp(t.browser({ ip }), { email: 'shop9@example.com' });
    assert.equal(sixth.status, 429);
    assert.equal(t.mails.length, 8);
    advance(60 * MINUTE);
    assert.equal((await signUp(t.browser({ ip }), { email: 'shop9@example.com' })).status, 200);
  } finally {
    await t.done();
  }
});

test('the link opens exactly one user and one workspace, with only the products chosen, no invite, and lands on /setup', async () => {
  const t = await setup();
  try {
    const users = count(t.db, 'users');
    const b = t.browser();
    const r = await signUp(b, { email: ' Noa@Example.com ' });
    assert.equal(r.status, 200);
    assert.match(r.body, /noa@example\.com/);
    assert.equal(t.mails.length, 1);
    const mail = t.mails[0];
    assert.equal(mail.to, 'noa@example.com');
    assert.equal(mail.subject, 'אישור החשבון שלכם ב-OpenFrequency');
    assert.match(mail.link, /^https:\/\/accounts\.openfrequency\.co\.il\/signup\/confirm\?t=[A-Za-z0-9_-]{43}$/);
    // Nothing typed into the form is in the email (PRA-SEC-005): the business's name shows on the page the link opens.
    assert.doesNotMatch(mail.text + mail.subject + mail.html, /Noa/);
    // Nothing is opened before the link is used.
    assert.equal(count(t.db, 'users'), users);
    assert.equal(count(t.db, 'workspaces'), 0);
    // The token is kept only as its hash.
    assert.equal(count(t.db, 'signups WHERE token_hash = ?', tokenOf(mail.link)), 0);

    // Opening the link shows a button; a mail scanner that fetches it opens nothing.
    for (let i = 0; i < 2; i++) {
      const page = await b.get(pathOf(mail.link));
      assert.equal(page.status, 200);
      assert.match(page.body, /לחצו כדי לפתוח את החשבון של Noa Ceramics, עם הכתובת noa@example\.com\./);
      assert.match(page.body, /המוצרים שבחרתם: תדר, החבילה המלאה\./);
    }
    assert.equal(count(t.db, 'workspaces'), 0);

    const opened = await b.post('/signup/confirm', { t: tokenOf(mail.link) });
    assert.equal(opened.status, 303);
    assert.equal(opened.headers.location, '/setup');
    assert.ok(opened.setCookies.some((c) => c.startsWith('__Secure-of_session=')));

    assert.equal(count(t.db, 'users'), users + 1);
    assert.equal(count(t.db, 'workspaces'), 1);
    const user = t.db.get('SELECT * FROM users WHERE email = ?', 'noa@example.com');
    const ws = t.db.get('SELECT * FROM workspaces');
    assert.equal(user.name, 'Noa Levi');
    assert.equal(ws.name, 'Noa Ceramics');
    assert.equal(ws.slug, 'noa-ceramics');
    assert.deepEqual([user.terms_version, ws.terms_version], [TERMS_VERSION, TERMS_VERSION]);
    assert.equal(user.terms_accepted_at, '2026-10-22T10:00:00.000Z');
    assert.deepEqual(t.db.all('SELECT product, enabled FROM workspace_products WHERE workspace_id = ?', ws.id).map((r) => ({ ...r })), [{ product: 'teder', enabled: 1 }]);
    // Its subscription at the list price, nothing paid yet (the "open" state).
    const subs = t.db.all('SELECT * FROM subscriptions WHERE workspace_id = ?', ws.id);
    assert.deepEqual(subs.map((s) => [s.product, s.plan, s.monthly, s.setup, s.paid_until]), [['teder', 'full', 790, 1490, null]]);
    assert.deepEqual(t.db.all('SELECT user_id, role FROM memberships WHERE workspace_id = ?', ws.id).map((r) => ({ ...r })), [{ user_id: user.id, role: 'client_owner' }]);
    assert.equal(count(t.db, "tokens WHERE kind = 'invite'"), 0);
    // The confirmation link, then the welcome email (no notice: OF_SIGNUP_NOTIFY is unset here).
    assert.deepEqual(t.mails.map((m) => m.subject), ['אישור החשבון שלכם ב-OpenFrequency', 'החשבון של Noa Ceramics נפתח']);
    // Not complimentary: a new sign-up pays.
    assert.deepEqual(t.db.all('SELECT comp FROM workspace_products WHERE workspace_id = ?', ws.id).map((r) => r.comp), [0]);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'signed_up' AND workspace_id = ?", ws.id));

    // Signed in, in their workspace: Teder knows them.
    const who = await t.internal(b.cookie('__Secure-of_session'), 'teder');
    assert.equal(who.status, 200);
    assert.equal(who.json.workspace.id, ws.id);
    assert.deepEqual(who.json.products, ['teder']);
    assert.equal(who.json.role, 'client_owner');

    // Once only.
    const again = t.browser();
    await again.get('/login');
    assert.equal((await again.post('/signup/confirm', { t: tokenOf(mail.link) })).status, 410);
    assert.equal((await again.get(pathOf(mail.link))).status, 410);
    assert.equal(count(t.db, 'workspaces'), 1);

    // Signed in, /signup says so and opens nothing.
    const signedIn = await b.get('/signup');
    assert.match(signedIn.body, /אתם כבר מחוברים בתור noa@example\.com/);
    assert.doesNotMatch(signedIn.body, /name="business"/);
  } finally {
    await t.done();
  }
});

test('both products, a Hebrew name gets a made-up slug, and the link works for 15 minutes', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    await signUp(b, { business: 'הקרמיקה של נועה', products: ['toran', 'teder'] });
    await signUp(t.browser(), { email: 'late@example.com' });
    advance(15 * MINUTE - 1000);
    const page = await b.get(pathOf(t.mails[0].link));
    assert.match(page.body, /המוצרים שבחרתם: תדר, החבילה המלאה ותורן\./);
    assert.equal((await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) })).status, 303);
    const ws = t.db.get('SELECT * FROM workspaces');
    assert.match(ws.slug, /^ws-[0-9a-f]{6}$/);
    assert.deepEqual(t.db.all('SELECT product FROM workspace_products WHERE workspace_id = ? ORDER BY product', ws.id).map((r) => r.product), ['teder', 'toran']);
    advance(1000);
    const late = t.browser();
    await late.get('/login');
    assert.equal((await late.post('/signup/confirm', { t: tokenOf(t.mails[1].link) })).status, 410);
    assert.equal(count(t.db, 'workspaces'), 1);
  } finally {
    await t.done();
  }
});

test('an address that has an account: the same page, a sign-in link instead, and never a second workspace', async () => {
  const t = await setup();
  try {
    makeWorkspace(t.db, 'dana-shop', { name: 'Dana Shop', members: { 'dana@example.com': 'client_owner' } });
    makeUser(t.db, 'boss@example.com', { superadmin: true });
    const r = await signUp(t.browser(), { email: 'Dana@example.com' });
    assert.equal(r.status, 200);
    assert.match(r.body, /בדקו את המייל/);
    assert.equal(t.mails.length, 1);
    assert.equal(t.mails[0].subject, 'כבר יש לכם חשבון ב-OpenFrequency');
    assert.match(t.mails[0].link, /\/auth\/link\?t=/);
    assert.equal(count(t.db, 'signups'), 0);
    // The superadmin's address: the same page, and no email at all.
    const boss = await signUp(t.browser(), { email: 'boss@example.com' });
    assert.equal(boss.status, 200);
    assert.equal(t.mails.length, 1);
    assert.equal(count(t.db, 'workspaces'), 1);

    // An address that gets an account between the form and the link (an invite accepted): the link opens nothing.
    const b = t.browser();
    await signUp(b, { email: 'gal@example.com' });
    const link = t.mails.at(-1).link;
    const inv = createInvite(t.db, { workspaceId: t.db.get("SELECT id FROM workspaces WHERE slug = 'dana-shop'").id, email: 'gal@example.com', role: 'client_member' });
    acceptInvite(t.db, inv.token);
    await b.get(pathOf(link));
    const r2 = await b.post('/signup/confirm', { t: tokenOf(link) });
    assert.equal(r2.status, 409);
    assert.match(r2.body, /כבר יש לכם חשבון עם הכתובת הזאת/);
    assert.equal(count(t.db, 'workspaces'), 1);
    assert.equal(b.cookie('__Secure-of_session'), undefined);
  } finally {
    await t.done();
  }
});

/** Google sends the browser back with a code, having signed in as `who`. */
function back(t, b, to, who) {
  const nonce = to.searchParams.get('nonce');
  t.g.answer = () => ({ iss: 'https://accounts.google.com', aud: CLIENT.GOOGLE_CLIENT_ID, exp: Date.parse('2026-10-22T11:00:00Z') / 1000, nonce, email_verified: true, ...who });
  return b.get(`/auth/google/callback?${new URLSearchParams({ state: to.searchParams.get('state'), code: 'code-from-google' })}`);
}

test('continue with Google: the choices wait on our side (not in any URL), and the Google address opens the account', async () => {
  const t = await setup({ env: { ...OPEN, ...CLIENT } });
  try {
    const b = t.browser();
    const page = await b.get('/signup');
    assert.match(page.body, /<button class="google" name="via" value="google" formnovalidate>/);
    const r = await b.post('/signup', { ...FORM, email: '', via: 'google', products: ['toran'] });
    assert.equal(r.status, 303);
    const to = new URL(r.headers.location);
    assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.doesNotMatch(r.headers.location, /Noa|Ceramics|toran|signup/i);
    const flow = openFlow(b.cookie('__Host-of_google'), 's'.repeat(40));
    assert.match(flow.signup, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(t.db.get('SELECT kind, email, business FROM signups').business, 'Noa Ceramics');
    assert.equal(t.mails.length, 0);

    const done = await back(t, b, to, { sub: '2001', email: 'noa@gmail.com', name: 'Noa G' });
    assert.equal(done.status, 303);
    assert.equal(done.headers.location, '/setup');
    const user = t.db.get('SELECT * FROM users WHERE email = ?', 'noa@gmail.com');
    assert.equal(user.google_sub, '2001');
    assert.equal(user.name, 'Noa Levi');
    assert.equal(user.terms_version, TERMS_VERSION);
    const ws = t.db.get('SELECT * FROM workspaces');
    assert.deepEqual(t.db.all('SELECT product FROM workspace_products WHERE workspace_id = ?', ws.id).map((x) => x.product), ['toran']);
    assert.equal(count(t.db, "tokens WHERE kind = 'invite'"), 0);

    // The same Google account again: it signs in to the account it has, and opens nothing new.
    const b2 = t.browser();
    await b2.get('/signup');
    const r2 = await b2.post('/signup', { ...FORM, email: '', via: 'google', business: 'Another Shop' });
    const again = await back(t, b2, new URL(r2.headers.location), { sub: '2001', email: 'noa@gmail.com', name: 'Noa G' });
    assert.equal(again.status, 303);
    assert.equal(count(t.db, 'workspaces'), 1);
    assert.ok(b2.cookie('__Secure-of_session'));
    assert.match((await b2.get('/')).body, /כבר יש לכם חשבון עם noa@gmail\.com, אז נכנסתם אליו\. לא פתחנו חשבון נוסף\./);

    // The form is still checked: no terms, no Google.
    const b3 = t.browser();
    await b3.get('/signup');
    const r3 = await b3.post('/signup', { ...FORM, email: '', via: 'google', terms: '' });
    assert.equal(r3.status, 400);
    assert.match(r3.body, /צריך להסכים/);
  } finally {
    await t.done();
  }
});

test("Google with the superadmin's address, or one already taken, opens nothing", async () => {
  const t = await setup({ env: { ...OPEN, ...CLIENT } });
  try {
    makeUser(t.db, 'boss@example.com', { superadmin: true });
    const b = t.browser();
    await b.get('/signup');
    const r = await b.post('/signup', { ...FORM, email: '', via: 'google' });
    const done = await back(t, b, new URL(r.headers.location), { sub: '3001', email: 'boss@example.com', name: 'Boss' });
    assert.equal(done.status, 403);
    assert.match(done.body, /אי אפשר לפתוח חשבון עם הכתובת הזאת/);
    assert.equal(count(t.db, 'workspaces'), 0);
    assert.equal(b.cookie('__Secure-of_session'), undefined);
  } finally {
    await t.done();
  }
});

// ---- the owner's notice (OF_SIGNUP_NOTIFY)

const NOTIFY = { ...OPEN, OF_SIGNUP_NOTIFY: ' Owner@example.com, second@example.com,not-an-address,owner@example.com ' };
const notices = (mails) => mails.filter((m) => m.subject.startsWith('הרשמה חדשה'));

test('the owner hears of each confirmed sign-up: once per address, after the link is used, with who, what and a link to /admin', async () => {
  const t = await setup({ env: NOTIFY });
  try {
    const b = t.browser();
    await signUp(b, { name: 'Noa <i>Levi</i>', business: '<b>Noa</b> & Co' });
    // The form alone tells nobody: only the customer's own link went out.
    assert.equal(t.mails.length, 1);
    assert.equal(notices(t.mails).length, 0);
    const link = t.mails[0].link;
    await b.get(pathOf(link));
    assert.equal((await b.post('/signup/confirm', { t: tokenOf(link) })).headers.location, '/setup');
    const sent = notices(t.mails);
    assert.deepEqual(sent.map((m) => m.to), ['owner@example.com', 'second@example.com']);
    const ws = t.db.get('SELECT * FROM workspaces');
    const m = sent[0];
    assert.equal(m.subject, 'הרשמה חדשה: <b>Noa</b> & Co');
    for (const line of ['שם: Noa <i>Levi</i>', 'מייל: noa@example.com', 'עסק: <b>Noa</b> & Co', 'מוצרים: תדר', 'מתי: 22.10.2026, 13:00', 'אישור: קישור במייל'])
      assert.ok(m.text.includes(line), line);
    // The plan and its price, and, in manual mode (OF_PAYMENT unset), to email the payment details to the customer.
    assert.ok(m.text.includes('תדר, החבילה המלאה: 790 ₪ לחודש + 1,490 ₪ דמי הקמה, לא כולל מע״מ'), m.text);
    assert.ok(m.text.includes('צריך לשלוח ל-noa@example.com במייל את פרטי התשלום. כשהתשלום מגיע, רושמים אותו בקונסולה ("התקבל תשלום לחודש"), ורק אז תדר נפתח ללקוח.'), m.text);
    assert.equal(m.link, `https://accounts.openfrequency.co.il/admin/accounts#ws-${ws.id}`);
    // The HTML part escapes what the customer typed.
    assert.ok(m.html.includes('&lt;b&gt;Noa&lt;/b&gt; &amp; Co'));
    assert.doesNotMatch(m.html, /<b>Noa<\/b>|<i>Levi<\/i>/);
    // A used link again: no second notice.
    const other = t.browser();
    await other.get('/login');
    assert.equal((await other.post('/signup/confirm', { t: tokenOf(link) })).status, 410);
    assert.equal(notices(t.mails).length, 2);
  } finally {
    await t.done();
  }
});

test('no notice when sign-up is closed, for the honeypot, past the limits, for an address that has an account, or with OF_SIGNUP_NOTIFY unset', async () => {
  const closed = await setup({ env: { OF_SIGNUP_NOTIFY: 'owner@example.com' } });
  try {
    const b = closed.browser();
    await b.get('/login');
    assert.equal((await b.post('/signup', FORM)).status, 403);
    assert.equal(closed.mails.length, 0);
  } finally {
    await closed.done();
  }

  const t = await setup({ env: { ...OPEN, OF_SIGNUP_NOTIFY: 'owner@example.com' } });
  try {
    await signUp(t.browser(), { website: 'https://spam.example' });
    for (let i = 0; i < 4; i++) await signUp(t.browser({ ip: `198.51.100.${i + 1}` }), { email: 'same@example.com' });
    makeWorkspace(t.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner' } });
    await signUp(t.browser(), { email: 'dana@example.com' });
    assert.equal(notices(t.mails).length, 0);
    // Three confirmation links (the fourth was over the limit) and Dana's sign-in link.
    assert.equal(t.mails.length, 4);
  } finally {
    await t.done();
  }

  const off = await setup();
  try {
    const b = off.browser();
    await signUp(b);
    assert.equal((await b.post('/signup/confirm', { t: tokenOf(off.mails[0].link) })).status, 303);
    assert.equal(off.mails.length, 2, 'the link and the welcome email, and no notice');
    assert.equal(notices(off.mails).length, 0);
  } finally {
    await off.done();
  }
});

test('a notice that fails to send is logged and never stands in the way of the sign-up', async () => {
  const mails = [];
  const logged = [];
  const mailer = {
    sending: 'test',
    send: (m) => {
      if (m.subject.startsWith('הרשמה חדשה')) throw new Error('mail is down');
      mails.push(m);
    },
    flush: async () => {},
  };
  const t = await setup({ env: NOTIFY, mailer, log: (line) => logged.push(line) });
  try {
    const b = t.browser();
    await signUp(b);
    const r = await b.post('/signup/confirm', { t: tokenOf(mails[0].link) });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/setup');
    assert.ok(b.cookie('__Secure-of_session'));
    assert.equal(count(t.db, 'workspaces'), 1);
    assert.ok(logged.some((l) => /sign-up notice .* failed: mail is down/.test(l)));
  } finally {
    await t.done();
  }
});

test('a sign-up confirmed by Google sends the notice too, once', async () => {
  const t = await setup({ env: { ...OPEN, ...CLIENT, OF_SIGNUP_NOTIFY: 'owner@example.com' } });
  try {
    const b = t.browser();
    await b.get('/signup');
    const r = await b.post('/signup', { ...FORM, email: '', via: 'google', products: ['toran', 'teder'] });
    assert.equal((await back(t, b, new URL(r.headers.location), { sub: '4001', email: 'noa@gmail.com', name: 'Noa G' })).headers.location, '/setup');
    const sent = notices(t.mails);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes('מייל: noa@gmail.com'));
    assert.ok(sent[0].text.includes('מוצרים: תדר, תורן'));
    assert.ok(sent[0].text.includes('תורן: 590 ₪ לחודש + 990 ₪ דמי הקמה, לא כולל מע״מ'));
    assert.ok(sent[0].text.includes('צריך לשלוח ל-noa@gmail.com במייל את פרטי התשלום.'));
    assert.ok(sent[0].text.includes('ורק אז תדר ותורן נפתחים ללקוח.'));
    assert.ok(sent[0].text.includes('אישור: Google'));
  } finally {
    await t.done();
  }
});

// ---- the products sign-up offers (OF_SIGNUP_PRODUCTS)

test('OF_SIGNUP_PRODUCTS: both by default, unknown names left out', () => {
  assert.deepEqual(signupProducts({}), ['teder', 'toran']);
  assert.deepEqual(signupProducts({ OF_SIGNUP_PRODUCTS: ' ' }), ['teder', 'toran']);
  assert.deepEqual(signupProducts({ OF_SIGNUP_PRODUCTS: 'Teder, other' }), ['teder']);
  assert.deepEqual(signupProducts({ OF_SIGNUP_PRODUCTS: 'toran,teder' }), ['teder', 'toran']);
  assert.throws(() => checkSignup({ ...FORM, products: ['toran'], terms: true }, { open: ['teder'] }), (e) => e.code === 'product_closed');
});

test('by default both products are open, neither chosen in advance, and neither says בקרוב', async () => {
  const t = await setup();
  try {
    const page = await t.browser().get('/signup');
    assert.ok(page.body.includes('name="products" value="toran">'));
    assert.ok(page.body.includes('name="products" value="teder">'));
    assert.doesNotMatch(page.body, /disabled|בקרוב|product-pick soon/);
    assert.match(page.body, /אפשר לבחור את שניהם/);
  } finally {
    await t.done();
  }
});

test('with OF_SIGNUP_PRODUCTS=teder: Toran shows as coming soon and is refused, by the form and by Google; Teder starts chosen', async () => {
  const t = await setup({ env: { ...OPEN, ...CLIENT, OF_SIGNUP_PRODUCTS: 'teder' } });
  try {
    const b = t.browser();
    const page = await b.get('/signup');
    assert.ok(page.body.includes('name="products" value="teder" checked>'));
    assert.match(page.body, /<label class="product-pick soon"><input type="checkbox" disabled aria-describedby="su-soon-toran">/);
    assert.match(page.body, /<small id="su-soon-toran">ההרשמה אליו תיפתח בקרוב\.<\/small><\/span><span class="tag off">בקרוב<\/span>/);
    assert.doesNotMatch(page.body, /name="products" value="toran"/);
    assert.doesNotMatch(page.body, /אפשר לבחור את שניהם/);
    // Teder comes first, Toran after it.
    assert.ok(page.body.indexOf('value="teder"') < page.body.indexOf('su-soon-toran'));

    for (const products of [['toran'], ['teder', 'toran']]) {
      for (const via of ['email', 'google']) {
        const r = await b.post('/signup', { ...FORM, products, via, ...(via === 'google' ? { email: '' } : {}) });
        assert.equal(r.status, 400, `${products} ${via}`);
        assert.match(r.body, /ההרשמה לאחד המוצרים שבחרתם עוד לא נפתחה/);
      }
    }
    assert.equal(count(t.db, 'signups'), 0);
    assert.equal(t.mails.length, 0);

    // Teder alone goes through.
    assert.equal((await b.post('/signup', { ...FORM, products: ['teder'] })).status, 200);
    await b.post('/signup/confirm', { t: tokenOf(t.mails[0].link) });
    const ws = t.db.get('SELECT * FROM workspaces');
    assert.deepEqual(t.db.all('SELECT product FROM workspace_products WHERE workspace_id = ?', ws.id).map((r) => r.product), ['teder']);

    // The superadmin's console still opens Toran.
    const admin = makeUser(t.db, 'boss@example.com', { superadmin: true });
    const { workspace } = createWorkspace(t.db, { name: 'Gal', slug: 'gal-shop', ownerEmail: 'gal@example.com', products: ['toran'] }, { by: admin });
    assert.deepEqual(t.db.all('SELECT product FROM workspace_products WHERE workspace_id = ?', workspace.id).map((r) => r.product), ['toran']);
  } finally {
    await t.done();
  }
});

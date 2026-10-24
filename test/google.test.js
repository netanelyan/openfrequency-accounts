import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { pathOf, startSite } from './site.js';
import { advance, setNow, MINUTE } from '../src/core/clock.js';
import { createInvite } from '../src/accounts/links.js';
import { openFlow, sealFlow } from '../src/auth/google.js';

// Sign in with Google end to end, over HTTP, with Google itself played by a fake
// token endpoint: the test reads the state and the nonce from where the site
// sends the browser, and the fake answers the code with an ID token of the
// test's choosing.

const CLIENT = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'not-a-real-secret' };
const CALLBACK = 'https://accounts.openfrequency.co.il/auth/google/callback';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJl`;

function fakeGoogle() {
  const g = {
    calls: [],
    answer: null, // (request fields) => claims, or a function that throws
    status: 200,
    fetch: async (url, init) => {
      const fields = Object.fromEntries(new URLSearchParams(init.body));
      g.calls.push({ url, fields });
      if (g.status === 'down') throw new TypeError('fetch failed');
      const claims = g.answer(fields);
      return { ok: g.status === 200, json: async () => (g.status === 200 ? { access_token: 'x', id_token: jwt(claims) } : { error: 'invalid_grant' }) };
    },
  };
  return g;
}

async function setup({ google = true } = {}) {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const ws = makeWorkspace(h.db, 'dana-shop', { name: 'Dana Shop', products: ['teder'], members: { 'dana@example.com': 'client_owner' } });
  const g = fakeGoogle();
  const site = await startSite(h.db, { env: google ? CLIENT : {}, googleFetch: g.fetch });
  return { ...h, ...site, ws, g, done: async () => (await site.close(), h.cleanup()) };
}

/** Press the Google button: where the site sends the browser, as a URL. */
async function toGoogle(b, path = '/auth/google') {
  const r = await b.get(path);
  assert.equal(r.status, 303);
  const to = new URL(r.headers.location);
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  return to;
}

/** Google sends the browser back with a code, having signed in as `who`. */
function back(t, b, to, who, extra = {}) {
  const nonce = to.searchParams.get('nonce');
  t.g.answer = () => ({ iss: 'https://accounts.google.com', aud: CLIENT.GOOGLE_CLIENT_ID, exp: Date.parse('2026-10-22T11:00:00Z') / 1000, nonce, email_verified: true, ...who });
  const q = new URLSearchParams({ state: to.searchParams.get('state'), code: 'code-from-google', ...extra });
  return b.get(`/auth/google/callback?${q}`);
}

const DANA = { sub: '1001', email: 'dana@example.com', name: 'Dana Cohen' };

test('the Google button is on the login page only while Google is set up', async () => {
  const off = await setup({ google: false });
  try {
    const page = await off.browser().get('/login');
    assert.doesNotMatch(page.body, /כניסה עם Google/);
    assert.equal((await off.browser().get('/auth/google')).status, 404);
    assert.equal((await off.browser().get('/auth/google/callback?state=x&code=y')).status, 404);
  } finally {
    await off.done();
  }
  const on = await setup();
  try {
    const page = await on.browser().get('/login?next=https://teder.openfrequency.co.il/posts');
    assert.match(page.body, /<a class="button google" href="\/auth\/google\?next=https%3A%2F%2Fteder\.openfrequency\.co\.il%2Fposts">/);
    assert.match(page.body, /כניסה עם Google/);
    assert.match(page.body, /או בקישור למייל/);
    // The emailed link is still there.
    assert.match(page.body, /שלחו לי קישור/);
  } finally {
    await on.done();
  }
});

test('a customer signs in with Google and lands where they were going', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    const to = await toGoogle(b, '/auth/google?next=https://teder.openfrequency.co.il/posts');
    assert.equal(to.searchParams.get('client_id'), CLIENT.GOOGLE_CLIENT_ID);
    assert.equal(to.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(to.searchParams.get('scope'), 'openid email profile');
    assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
    const flowCookie = b.setCookies.find((c) => c.startsWith('__Host-of_google='));
    assert.match(flowCookie, /; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/);

    const r = await back(t, b, to, DANA);
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, 'https://teder.openfrequency.co.il/posts');
    assert.ok(r.setCookies.some((c) => /^__Secure-of_session=[A-Za-z0-9_-]{43}; Path=\/; Domain=\.openfrequency\.co\.il/.test(c)));
    assert.ok(r.setCookies.some((c) => /^__Host-of_google=; Path=\/; Max-Age=0/.test(c)));

    // What went to Google's token endpoint: our code, our secret, the verifier behind the challenge.
    const [call] = t.g.calls;
    assert.equal(call.url, 'https://oauth2.googleapis.com/token');
    assert.equal(call.fields.code, 'code-from-google');
    assert.equal(call.fields.client_secret, CLIENT.GOOGLE_CLIENT_SECRET);
    assert.equal(call.fields.redirect_uri, CALLBACK);
    assert.equal(call.fields.grant_type, 'authorization_code');
    assert.equal(createHash('sha256').update(call.fields.code_verifier).digest('base64url'), to.searchParams.get('code_challenge'));

    const who = await t.internal(b.cookie('__Secure-of_session'), 'teder');
    assert.equal(who.status, 200);
    assert.equal(who.json.user.email, 'dana@example.com');
    const dana = t.db.get('SELECT * FROM users WHERE email = ?', 'dana@example.com');
    assert.equal(dana.google_sub, '1001');
    assert.equal(dana.name, 'Dana Cohen');
    const a = t.db.get(`SELECT * FROM audit WHERE action = 'sign_in' ORDER BY id DESC`);
    assert.equal(JSON.parse(a.detail_json).method, 'google');

    // The callback cannot be replayed: the flow cookie is gone.
    const again = await b.get(`/auth/google/callback?state=${to.searchParams.get('state')}&code=code-from-google`);
    assert.equal(again.status, 400);
  } finally {
    await t.done();
  }
});

test('a Google answer for a sign-in another browser started is refused', async () => {
  const t = await setup();
  try {
    const victim = t.browser();
    const attacker = t.browser({ ip: '198.51.100.7' });
    const to = await toGoogle(attacker);
    // The attacker's own callback link, opened in the victim's browser, which never started a sign-in.
    const r = await back(t, victim, to, DANA);
    assert.equal(r.status, 400);
    assert.match(r.body, /הכניסה עם Google לא הושלמה/);
    assert.equal(victim.cookie('__Secure-of_session'), undefined);
    assert.equal(t.g.calls.length, 0);

    // A state that does not match the browser's own is refused the same way.
    const b = t.browser();
    const mine = await toGoogle(b);
    const wrong = new URL(mine);
    wrong.searchParams.set('state', 'x'.repeat(43));
    assert.equal((await back(t, b, wrong, DANA)).status, 400);
  } finally {
    await t.done();
  }
});

test('the flow cookie is signed and lasts ten minutes', async () => {
  const t = await setup();
  try {
    const flow = { state: 's', nonce: 'n', verifier: 'v', next: null, invite: null, at: Date.parse('2026-10-22T10:00:00Z') };
    const sealed = sealFlow(flow, 'k'.repeat(40));
    assert.deepEqual(openFlow(sealed, 'k'.repeat(40)), flow);
    assert.equal(openFlow(sealed, 'j'.repeat(40)), null);
    const [body, sig] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...flow, next: 'https://evil.example/' })).toString('base64url');
    assert.equal(openFlow(`${forged}.${sig}`, 'k'.repeat(40)), null);
    assert.equal(openFlow(`${body}.${sig}.x`, 'k'.repeat(40)), null);

    const b = t.browser();
    const to = await toGoogle(b);
    advance(10 * MINUTE + 1000);
    const r = await back(t, b, to, DANA);
    assert.equal(r.status, 400);
    assert.equal(b.cookie('__Secure-of_session'), undefined);
  } finally {
    await t.done();
  }
});

test('pressing cancel at Google goes back to the login page with a word on why', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    const to = await toGoogle(b, '/auth/google?next=https://toran.openfrequency.co.il/');
    const r = await b.get(`/auth/google/callback?state=${to.searchParams.get('state')}&error=access_denied`);
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, `/login?next=${encodeURIComponent('https://toran.openfrequency.co.il/')}`);
    const page = await b.get(r.headers.location);
    assert.match(page.body, /הכניסה עם Google בוטלה/);
    assert.equal(t.g.calls.length, 0);
  } finally {
    await t.done();
  }
});

test('Google opens no account we did not make, nor the superadmin, nor a disabled user', async () => {
  const t = await setup();
  try {
    makeUser(t.db, 'boss@example.com', { superadmin: true });
    const gone = makeUser(t.db, 'gone@example.com');
    t.db.update('users', gone.id, { disabled_at: '2026-10-01T00:00:00.000Z' });
    for (const email of ['stranger@example.com', 'boss@example.com', 'gone@example.com']) {
      const b = t.browser();
      const r = await back(t, b, await toGoogle(b), { sub: `sub-${email}`, email });
      assert.equal(r.status, 403, email);
      assert.match(r.body, new RegExp(`לא מצאנו אצלנו חשבון פתוח עם ${email.replace('.', '\\.')}`));
      assert.equal(b.cookie('__Secure-of_session'), undefined);
    }
    assert.equal(t.db.get(`SELECT COUNT(*) AS n FROM users WHERE email = 'stranger@example.com'`).n, 0);
    assert.equal(t.db.get(`SELECT COUNT(*) AS n FROM audit WHERE action = 'google_refused'`).n, 3);
  } finally {
    await t.done();
  }
});

test('an address Google has not verified, a token for another app, or a stale nonce signs nobody in', async () => {
  const t = await setup();
  try {
    const cases = [
      [{ ...DANA, email_verified: false }, 403, /Google עוד לא אימת/],
      [{ ...DANA, aud: 'someone-else.apps.googleusercontent.com' }, 502, /Google לא אישר את הכניסה/],
      [{ ...DANA, nonce: 'an-old-nonce' }, 502, /Google לא אישר את הכניסה/],
      [{ ...DANA, iss: 'https://evil.example' }, 502, /Google לא אישר את הכניסה/],
      [{ ...DANA, exp: Date.parse('2026-10-22T09:00:00Z') / 1000 }, 502, /Google לא אישר את הכניסה/],
    ];
    for (const [who, status, words] of cases) {
      const b = t.browser();
      const r = await back(t, b, await toGoogle(b), who);
      assert.equal(r.status, status, JSON.stringify(who));
      assert.match(r.body, words);
      assert.equal(b.cookie('__Secure-of_session'), undefined);
    }
    assert.equal(t.db.get('SELECT google_sub FROM users WHERE email = ?', 'dana@example.com').google_sub, null);

    // Google down, or refusing the code.
    for (const status of ['down', 400]) {
      t.g.status = status;
      const b = t.browser();
      const r = await back(t, b, await toGoogle(b), DANA);
      assert.equal(r.status, 502);
      assert.match(r.body, status === 'down' ? /Google לא ענה לנו/ : /Google לא אישר את הכניסה/);
    }
  } finally {
    await t.done();
  }
});

test('once a Google account is tied to a customer, it is the one that counts', async () => {
  const t = await setup();
  try {
    const first = t.browser();
    assert.equal((await back(t, first, await toGoogle(first), DANA)).status, 303);

    // Another Google account showing the same address does not get in.
    const other = t.browser();
    assert.equal((await back(t, other, await toGoogle(other), { ...DANA, sub: '2002' })).status, 403);

    // The same Google account after its address changed still does.
    const later = t.browser();
    const r = await back(t, later, await toGoogle(later), { ...DANA, email: 'dana.cohen@example.com' });
    assert.equal(r.status, 303);
    const who = await t.internal(later.cookie('__Secure-of_session'));
    assert.equal(who.json.user.email, 'dana@example.com');
  } finally {
    await t.done();
  }
});

test('an invite is accepted with Google by the address it went to, and by no other', async () => {
  const t = await setup();
  try {
    const inv = createInvite(t.db, { workspaceId: t.ws.id, email: 'roni@example.com', role: 'client_member' });
    const invitePath = pathOf(`https://accounts.openfrequency.co.il/invite?t=${inv.token}`);

    const page = await t.browser().get(invitePath);
    assert.match(page.body, /הצטרפות עם Google/);
    assert.match(page.body, /צריך לבחור ב-Google את החשבון של roni@example\.com/);
    assert.match(page.body, new RegExp(`href="/auth/google\\?invite=${inv.token}"`));

    // The wrong Google account: refused, and the invite still works.
    const wrong = t.browser();
    const toWrong = await toGoogle(wrong, `/auth/google?invite=${inv.token}`);
    assert.equal(toWrong.searchParams.get('login_hint'), 'roni@example.com');
    const r1 = await back(t, wrong, toWrong, { sub: '3003', email: 'roni.private@example.com', name: 'Roni' });
    assert.equal(r1.status, 403);
    assert.match(r1.body, /ההזמנה נשלחה אל roni@example\.com/);
    assert.match(r1.body, /נכנסתם ל-Google בתור roni\.private@example\.com/);
    assert.match(r1.body, new RegExp(`href="/invite\\?t=${inv.token}"`));
    assert.equal(t.db.get(`SELECT COUNT(*) AS n FROM users WHERE email LIKE 'roni%'`).n, 0);

    // The right one: a new user, named as on Google, in the workspace, signed in.
    const b = t.browser();
    const r2 = await back(t, b, await toGoogle(b, `/auth/google?invite=${inv.token}`), { sub: '3003', email: 'roni@example.com', name: 'Roni Levi' });
    assert.equal(r2.status, 303);
    assert.equal(r2.headers.location, '/');
    const roni = t.db.get('SELECT * FROM users WHERE email = ?', 'roni@example.com');
    assert.equal(roni.name, 'Roni Levi');
    assert.equal(roni.google_sub, '3003');
    const who = await t.internal(b.cookie('__Secure-of_session'), 'teder');
    assert.equal(who.json.workspace.slug, 'dana-shop');
    assert.equal(who.json.role, 'client_member');
    const a = t.db.get(`SELECT * FROM audit WHERE action = 'invite_accepted'`);
    assert.equal(JSON.parse(a.detail_json).method, 'google');

    // Used up: the button now leads to the "no longer valid" page.
    assert.equal((await t.browser().get(`/auth/google?invite=${inv.token}`)).status, 410);
  } finally {
    await t.done();
  }
});

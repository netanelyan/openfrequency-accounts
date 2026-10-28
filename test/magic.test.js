import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { pathOf, startSite, tokenOf } from './site.js';
import { advance, setNow, MINUTE } from '../src/core/clock.js';

// Magic links end to end, over HTTP, as a browser behind Caddy would see them.

async function setup(opts) {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  // Complimentary: these tests are about the links, not the paywall (an unpaid workspace lands on /setup).
  makeWorkspace(h.db, 'dana-shop', { name: 'Dana Shop', products: ['teder'], comp: true, members: { 'dana@example.com': 'client_owner' } });
  const site = await startSite(h.db, opts);
  return { ...h, ...site, done: async () => (await site.close(), h.cleanup()) };
}

async function requestLink(t, b, email = 'dana@example.com', next) {
  await b.get('/login');
  const r = await b.post('/login', { email, ...(next ? { next } : {}) });
  return r;
}

test('a customer asks for a link, opens it, presses the button, and is signed in everywhere', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    const r = await requestLink(t, b, '  Dana@Example.com ', 'https://teder.openfrequency.co.il/posts');
    assert.equal(r.status, 200);
    assert.match(r.body, /בדקו את המייל/);
    assert.equal(t.mails.length, 1);
    const mail = t.mails[0];
    assert.equal(mail.to, 'dana@example.com');
    assert.match(mail.link, /^https:\/\/accounts\.openfrequency\.co\.il\/auth\/link\?t=[A-Za-z0-9_-]{43}$/);
    assert.ok(mail.text.includes(mail.link));
    assert.ok(mail.html.includes(mail.link));

    // Opening the link only shows a button: a mail scanner that fetches it spends nothing.
    for (let i = 0; i < 3; i++) {
      const page = await b.get(pathOf(mail.link));
      assert.equal(page.status, 200);
      assert.match(page.body, /dana@example\.com/);
    }
    const signIn = await b.post('/auth/link', { t: tokenOf(mail.link) });
    assert.equal(signIn.status, 303);
    assert.equal(signIn.headers.location, 'https://teder.openfrequency.co.il/posts');
    const cookie = signIn.setCookies.find((c) => c.startsWith('__Secure-of_session='));
    assert.match(cookie, /; Domain=\.openfrequency\.co\.il; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);

    // Teder asks accounts who this is.
    const who = await t.internal(b.cookie('__Secure-of_session'), 'teder');
    assert.equal(who.status, 200);
    assert.equal(who.json.user.email, 'dana@example.com');
    assert.equal(who.json.workspace.slug, 'dana-shop');

    // And the accounts home page knows them too.
    const home = await b.get('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /אתם מחוברים בתור dana@example\.com, בחשבון של Dana Shop\./);
    assert.match(home.body, /<a class="button primary" href="https:\/\/teder\.openfrequency\.co\.il\/">כניסה לתדר<\/a>/);
    assert.doesNotMatch(home.body, /כניסה לתורן/);
    // Toran is not theirs: it is offered under "עוד מאיתנו", with a link to its page, not to the product.
    assert.match(home.body, /<a href="https:\/\/openfrequency\.co\.il\/toran">/);
  } finally {
    await t.done();
  }
});

test('a link works once', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    await requestLink(t, b);
    const tok = tokenOf(t.mails[0].link);
    assert.equal((await b.post('/auth/link', { t: tok })).status, 303);
    const other = t.browser({ ip: '198.51.100.20' });
    await other.get('/login');
    const again = await other.post('/auth/link', { t: tok });
    assert.equal(again.status, 410);
    assert.match(again.body, /הקישור הזה כבר לא עובד/);
    assert.equal(other.cookie('__Secure-of_session'), undefined);
    assert.equal((await other.get(pathOf(t.mails[0].link))).status, 410);
  } finally {
    await t.done();
  }
});

test('a link works for 15 minutes', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    await requestLink(t, b);
    await requestLink(t, b);
    const [first, second] = t.mails.map((m) => tokenOf(m.link));
    advance(15 * MINUTE - 1000);
    assert.equal((await b.get(`/auth/link?t=${first}`)).status, 200);
    advance(1000);
    assert.equal((await b.get(`/auth/link?t=${second}`)).status, 410);
    assert.equal((await b.post('/auth/link', { t: second })).status, 410);
  } finally {
    await t.done();
  }
});

test('using one link spends every other link the same person holds', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    await requestLink(t, b);
    await requestLink(t, b);
    const [a, c] = t.mails.map((m) => tokenOf(m.link));
    assert.equal((await b.post('/auth/link', { t: c })).status, 303);
    const other = t.browser();
    await other.get('/login');
    assert.equal((await other.post('/auth/link', { t: a })).status, 410);
  } finally {
    await t.done();
  }
});

test('the answer is the same for an unknown address, the superadmin and a disabled user; only a customer gets mail', async () => {
  const t = await setup();
  try {
    makeUser(t.db, 'admin@example.com', { superadmin: true });
    const gone = makeUser(t.db, 'gone@example.com');
    t.db.update('users', gone.id, { disabled_at: '2026-10-01T00:00:00.000Z' });
    const bodies = [];
    for (const email of ['dana@example.com', 'nobody@example.com', 'admin@example.com', 'gone@example.com']) {
      const b = t.browser({ ip: `198.51.100.${bodies.length + 1}` });
      const r = await requestLink(t, b, email);
      assert.equal(r.status, 200, email);
      bodies.push(r.body.replace(email, 'EMAIL').replace(/value="[^"]+"/g, ''));
    }
    assert.equal(new Set(bodies).size, 1, 'the four pages differ');
    assert.deepEqual(t.mails.map((m) => m.to), ['dana@example.com']);
    // The audit log knows the difference; the browser does not.
    assert.equal(t.db.get("SELECT COUNT(*) AS n FROM audit WHERE action = 'magic_link_requested'").n, 4);
  } finally {
    await t.done();
  }
});

test('?next= survives the link only when it is ours', async () => {
  const t = await setup();
  try {
    for (const [given, landing] of [
      ['https://toran.openfrequency.co.il/inbox', 'https://toran.openfrequency.co.il/inbox'],
      ['https://evil.example/', '/'],
      ['//evil.example/', '/'],
      ['https://teder.openfrequency.co.il.evil.example/', '/'],
      ['/logout', '/logout'],
    ]) {
      const b = t.browser();
      t.mails.length = 0;
      await b.get('/login');
      // The page carries a ?next= only when it is allowed.
      const form = await b.get(`/login?next=${encodeURIComponent(given)}`);
      assert.equal(form.body.includes(`name="next" value="${landing === '/' ? '' : landing}"`), true, given);
      await b.post('/login', { email: 'dana@example.com', next: given });
      // Checked when it is stored, and again when it is used.
      assert.equal(t.db.get('SELECT next_url FROM tokens ORDER BY id DESC LIMIT 1').next_url, landing === '/' ? null : landing, given);
      const r = await b.post('/auth/link', { t: tokenOf(t.mails[0].link) });
      assert.equal(r.headers.location, landing, given);
      // Past the three-per-15-minutes limit for this address.
      advance(15 * MINUTE);
    }
  } finally {
    await t.done();
  }
});

test('three links per address in 15 minutes, then a wait, with Retry-After', async () => {
  const t = await setup();
  try {
    for (let i = 0; i < 3; i++) {
      const b = t.browser({ ip: `198.51.100.${i + 1}` });
      assert.equal((await requestLink(t, b)).status, 200);
    }
    const b = t.browser({ ip: '198.51.100.9' });
    const r = await requestLink(t, b);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) > 0);
    assert.match(r.body, /ביקשתם הרבה קישורים בזמן קצר/);
    assert.equal(t.mails.length, 3);
    // Another address from the same place is not held back.
    assert.equal((await requestLink(t, b, 'noa@example.com')).status, 200);
    advance(15 * MINUTE);
    assert.equal((await requestLink(t, b)).status, 200);
    assert.equal(t.mails.length, 4);
  } finally {
    await t.done();
  }
});

test('ten requests per IP address in 15 minutes, whatever the email', async () => {
  const t = await setup();
  try {
    const b = t.browser({ ip: '192.0.2.50' });
    for (let i = 0; i < 10; i++) assert.equal((await requestLink(t, b, `x${i}@example.com`)).status, 200);
    assert.equal((await requestLink(t, b, 'dana@example.com')).status, 429);
    assert.equal(t.mails.length, 0);
    assert.equal((await requestLink(t, t.browser({ ip: '192.0.2.51' }), 'dana@example.com')).status, 200);
  } finally {
    await t.done();
  }
});

test('an address that is not one is refused before it counts', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    for (const email of ['', 'dana', 'dana@', '@example.com', 'a b@example.com', '<x>@example.com', 'dana@example', `${'a'.repeat(250)}@example.com`]) {
      const r = await requestLink(t, b, email);
      assert.equal(r.status, 400, email);
      assert.match(r.body, /הכתובת הזאת לא נראית כמו כתובת מייל/);
    }
    assert.equal(t.mails.length, 0);
  } finally {
    await t.done();
  }
});

test('a form without its CSRF token, or from another site, is refused', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    await b.get('/login');
    assert.equal((await b.post('/login', { email: 'dana@example.com', _csrf: 'forged' })).status, 403);
    const evil = t.browser({ origin: 'https://evil.example' });
    await evil.get('/login');
    const r = await evil.post('/login', { email: 'dana@example.com' });
    assert.equal(r.status, 403);
    assert.match(r.body, /חסמנו את הבקשה/);
    // A sibling product is another origin too.
    const sibling = t.browser({ origin: 'https://teder.openfrequency.co.il' });
    await sibling.get('/login');
    assert.equal((await sibling.post('/login', { email: 'dana@example.com' })).status, 403);
    // No CSRF cookie at all.
    const fresh = t.browser();
    assert.equal((await fresh.post('/login', { email: 'dana@example.com', _csrf: 'x' })).status, 403);
    assert.equal(t.mails.length, 0);
  } finally {
    await t.done();
  }
});

test('the Host must be ours, and the public name only over HTTPS', async () => {
  const t = await setup();
  try {
    assert.equal((await t.browser({ host: 'evil.example' }).get('/login')).status, 421);
    const plain = await t.browser({ secure: false }).get('/login');
    assert.equal(plain.status, 403);
    assert.match(plain.body, /HTTPS/);
  } finally {
    await t.done();
  }
});

test('every page is Hebrew, right to left, escapes what it shows, and sends its security headers', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    const r = await b.get('/login?next=%2F%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    assert.match(r.body, /<html lang="he" dir="rtl">/);
    assert.doesNotMatch(r.body, /<script>/);
    // Only our own files run (load.js), never anything written into a page.
    assert.match(r.headers['content-security-policy'], /script-src 'self';/);
    assert.doesNotMatch(r.headers['content-security-policy'], /unsafe-inline|unsafe-eval|nonce-/);
    assert.match(r.headers['content-security-policy'], /form-action 'self' https:\/\/\*\.openfrequency\.co\.il/);
    assert.equal(r.headers['referrer-policy'], 'same-origin');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.setCookies.join('\n'), /__Host-of_csrf=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Secure/);
  } finally {
    await t.done();
  }
});

test('signing out ends this browser; "all devices" ends every browser, for every product', async () => {
  const t = await setup();
  try {
    const signIn = async (ip) => {
      const b = t.browser({ ip });
      t.mails.length = 0;
      await requestLink(t, b);
      await b.post('/auth/link', { t: tokenOf(t.mails[0].link) });
      return b;
    };
    const phone = await signIn('198.51.100.1');
    const laptop = await signIn('198.51.100.2');
    const tablet = await signIn('198.51.100.3');

    await phone.get('/logout');
    const out = await phone.post('/logout');
    assert.equal(out.headers.location, '/login?out=1');
    assert.ok(out.setCookies.some((c) => /^__Secure-of_session=; Path=\/; Domain=\.openfrequency\.co\.il;.*Max-Age=0/.test(c)));
    assert.equal(phone.cookie('__Secure-of_session'), undefined);
    assert.match((await phone.get('/login?out=1')).body, /יצאתם\./);

    const laptopSid = laptop.cookie('__Secure-of_session');
    const tabletSid = tablet.cookie('__Secure-of_session');
    assert.equal((await t.internal(laptopSid)).status, 200);
    await laptop.get('/logout');
    const all = await laptop.post('/logout-all');
    assert.equal(all.headers.location, '/login?out=all&n=2');
    assert.equal((await t.internal(laptopSid)).status, 401);
    assert.equal((await t.internal(tabletSid)).status, 401);
    assert.equal((await tablet.get('/')).headers.location, '/login');
  } finally {
    await t.done();
  }
});

test('a member of two workspaces picks one after signing in, and can switch', async () => {
  const t = await setup();
  try {
    makeWorkspace(t.db, 'dana-studio', { name: 'Dana Studio', products: ['toran'], members: { 'dana@example.com': 'client_member' } });
    const b = t.browser();
    await requestLink(t, b, 'dana@example.com', 'https://toran.openfrequency.co.il/');
    const r = await b.post('/auth/link', { t: tokenOf(t.mails[0].link) });
    assert.equal(r.headers.location, `/workspace?next=${encodeURIComponent('https://toran.openfrequency.co.il/')}`);
    const pick = await b.get(r.headers.location);
    assert.match(pick.body, /לאיזה חשבון נכנסים/);
    assert.equal((await t.internal(b.cookie('__Secure-of_session'))).json.error, 'choose_workspace');
    const studio = t.db.get("SELECT id FROM workspaces WHERE slug = 'dana-studio'").id;
    const chosen = await b.post('/workspace', { workspace: studio, next: 'https://toran.openfrequency.co.il/' });
    assert.equal(chosen.headers.location, 'https://toran.openfrequency.co.il/');
    const who = await t.internal(b.cookie('__Secure-of_session'), 'toran');
    assert.equal(who.json.workspace.slug, 'dana-studio');
    assert.equal(who.json.role, 'client_member');
    // A workspace that is not theirs is not chosen.
    const stranger = makeWorkspace(t.db, 'other-shop');
    await b.get('/workspace');
    await b.post('/workspace', { workspace: stranger.id });
    assert.equal((await t.internal(b.cookie('__Secure-of_session'))).json.workspace.slug, 'dana-studio');
  } finally {
    await t.done();
  }
});

test('in development (no PUBLIC_HOST) the cookie is host-only and plain http works', async () => {
  const t = await setup({ env: { PUBLIC_HOST: '' } });
  try {
    const b = t.browser();
    await requestLink(t, b, 'dana@example.com', 'http://localhost:4700/');
    assert.match(t.mails[0].link, /^http:\/\/127\.0\.0\.1:\d+\/auth\/link\?t=/);
    const r = await b.post('/auth/link', { t: tokenOf(t.mails[0].link) });
    assert.equal(r.headers.location, 'http://localhost:4700/');
    const c = r.setCookies.find((x) => x.startsWith('of_session='));
    assert.ok(c && !/Domain=|Secure/.test(c), c);
  } finally {
    await t.done();
  }
});

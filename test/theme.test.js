import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { startSite } from './site.js';
import { startProduct } from './setup-fake.js';
import { startToran, sampleOps } from './toran-fake.js';
import { createSession } from '../src/auth/sessions.js';
import { layout, THEME_COLOR, themeOf } from '../src/web/html.js';

// Light or dark, one choice for every OpenFrequency site (the owner, 2026-11-02: "make sure that every repo starts on
// light mode. changing it on one subdomain changes it on all of the subdomains"). Every page here starts light, whatever
// the device prefers; dark is the of-theme cookie saying exactly "dark", which the browser writes for the whole of
// .openfrequency.co.il when the switch beside the accessibility button is tapped, and which the server reads, so the
// page comes in its colours before it paints. Here: the head of every page in both themes, a junk cookie light, the
// errors too; the cookie the switch writes; no dark rule left on the device's setting; and in a real browser, on a
// device that prefers dark, the page light, a tap dark at once and on the next page, and the switch clear of its
// neighbours on a phone and a desk.
//
// The browser test is skipped when no Chromium is installed (npx playwright-core install chromium), except where
// OF_REQUIRE_BROWSER=1 (CI, npm run release-check), as in browser.test.js.

const STATIC = new URL('../src/web/static/', import.meta.url);

/** A page's head in `theme`: data-theme on <html>, the color-scheme meta, and one theme-color, with no media query. */
function assertHead(html, theme, where) {
  assert.match(html, new RegExp(`^<!doctype html>\\n<html lang="he" dir="rtl" data-theme="${theme}">\\n<head>`), `${where}: <html> in ${theme}`);
  assert.equal((html.match(/<html/g) || []).length, 1, `${where}: one <html>`);
  assert.match(html, new RegExp(`<meta name="color-scheme" content="${theme}">`), `${where}: color-scheme ${theme}`);
  assert.deepEqual(html.match(/<meta name="theme-color"[^>]*>/g), [`<meta name="theme-color" content="${THEME_COLOR[theme]}">`], `${where}: one theme-color, ${theme}`);
  assert.doesNotMatch(html, /prefers-color-scheme/, `${where}: nothing follows the device`);
}

/** The switch: once, the website's button, pressed while dark, hidden until the script wires it, and in no form. */
function assertSwitch(html, theme, where) {
  const tags = html.match(/<button class="theme"[^>]*>/g) || [];
  assert.deepEqual(tags, [`<button class="theme" type="button" data-theme-toggle aria-pressed="${theme === 'dark'}" aria-label="מצב כהה" hidden>`], `${where}: one switch`);
  const at = html.indexOf('<button class="theme"');
  const end = html.indexOf('</button>', at);
  const button = html.slice(at, end);
  assert.match(button, /<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14\.5A8\.5 8\.5 0 0 1 9\.5 4a8\.5 8\.5 0 1 0 10\.5 10\.5z"\/><\/svg><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"\/>/, `${where}: the moon and the sun`);
  const before = html.slice(0, at);
  assert.equal((before.match(/<form/g) || []).length, (before.match(/<\/form>/g) || []).length, `${where}: not inside a form`);
  // Beside the accessibility button, in the same corner, after the page and its foot.
  assert.ok(at > html.indexOf('</footer>') && at < html.indexOf('<div class="a11y-w"'), `${where}: before the accessibility panel, after the foot`);
  assert.doesNotMatch(button, /\sstyle=|\son[a-z]+=/, `${where}: nothing the CSP would refuse`);
}

test('the layout: light without a theme or with anything but dark, dark when asked, and the switch says which', () => {
  for (const [opts, theme] of [[{}, 'light'], [{ theme: 'light' }, 'light'], [{ theme: 'dark' }, 'dark'], [{ theme: 'blue' }, 'light'], [{ theme: 'dark', wide: true, script: true }, 'dark'], [{ theme: 'dark', banner: '<div class="banner"></div>', flash: 'x' }, 'dark']]) {
    const html = layout({ title: 't', body: '<form method="post" action="/x"><button>x</button></form>', v: 'v1', ...opts });
    assertHead(html, theme, `layout ${JSON.stringify(opts)}`);
    assertSwitch(html, theme, `layout ${JSON.stringify(opts)}`);
  }
  assert.deepEqual(THEME_COLOR, { light: '#eeeff2', dark: '#111113' });
});

test('the theme a request asks for: dark only when of-theme is exactly "dark"', () => {
  assert.equal(themeOf({ 'of-theme': 'dark' }), 'dark');
  for (const jar of [{}, null, undefined, { 'of-theme': 'light' }, { 'of-theme': 'Dark' }, { 'of-theme': 'DARK' }, { 'of-theme': 'dark ' }, { 'of-theme': 'dark;x' }, { 'of-theme': '' }, { 'of-theme': 'night' }, { theme: 'dark' }, { 'of_theme': 'dark' }]) {
    assert.equal(themeOf(jar), 'light', JSON.stringify(jar));
  }
});

/** a11y.js as a browser would run it, with only what its first lines touch; its global ofThemeCookie is what is tested. */
function loadScript() {
  const ctx = vm.createContext({
    document: { documentElement: { classList: { toggle() {} } }, readyState: 'loading', addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(readFileSync(new URL('a11y.js', STATIC), 'utf8'), ctx);
  return ctx;
}

test('the cookie the switch writes: for every OpenFrequency host under .openfrequency.co.il, for this host alone anywhere else, a year, Lax, Secure over https', () => {
  const { ofThemeCookie } = loadScript();
  assert.equal(typeof ofThemeCookie, 'function');
  const year = '; Path=/; Max-Age=31536000; SameSite=Lax';
  const cases = [
    // The production host, the website, the other products: the whole domain, so a choice on one is a choice on all.
    [['dark', 'accounts.openfrequency.co.il', true], `of-theme=dark; Domain=.openfrequency.co.il${year}; Secure`],
    [['light', 'accounts.openfrequency.co.il', true], `of-theme=light; Domain=.openfrequency.co.il${year}; Secure`],
    [['dark', 'openfrequency.co.il', true], `of-theme=dark; Domain=.openfrequency.co.il${year}; Secure`],
    [['dark', 'teder.openfrequency.co.il', true], `of-theme=dark; Domain=.openfrequency.co.il${year}; Secure`],
    [['dark', 'ACCOUNTS.OpenFrequency.co.il', true], `of-theme=dark; Domain=.openfrequency.co.il${year}; Secure`],
    // Locally, and over plain http: this host only, and not Secure, which the browser would drop there.
    [['dark', 'localhost', false], `of-theme=dark${year}`],
    [['dark', '127.0.0.1', false], `of-theme=dark${year}`],
    [['light', 'localhost', true], `of-theme=light${year}; Secure`],
    // Names that only look like ours are never given our domain.
    [['dark', 'evilopenfrequency.co.il', true], `of-theme=dark${year}; Secure`],
    [['dark', 'openfrequency.co.il.evil.example', true], `of-theme=dark${year}; Secure`],
    [['dark', 'openfrequency.co', true], `of-theme=dark${year}; Secure`],
    // Anything but dark is written as light.
    [['night', 'accounts.openfrequency.co.il', true], `of-theme=light; Domain=.openfrequency.co.il${year}; Secure`],
    [[undefined, '', false], `of-theme=light${year}`],
  ];
  for (const [args, want] of cases) assert.equal(ofThemeCookie(...args), want, JSON.stringify(args));
});

test('the stylesheet: no rule follows the device\'s colours, every dark one hangs on data-theme, and the switch is styled', () => {
  const css = readFileSync(new URL('site.css', STATIC), 'utf8');
  assert.doesNotMatch(css, /prefers-color-scheme/, 'no @media (prefers-color-scheme) left');
  assert.match(css, /^:root \{\n {2}color-scheme: light;/m, 'light by default');
  // Every block that turns the page dark sits under [data-theme='dark'].
  const blocks = [...css.matchAll(/([^{}]+)\{[^{}]*color-scheme: dark[^{}]*\}/g)].map((m) => m[1].trim().split('\n').pop());
  assert.deepEqual(blocks, [":root[data-theme='dark']"]);
  for (const s of [":root[data-theme='dark'] {\n  color-scheme: dark;\n  --bg: #111113;", "[data-theme='dark'] a.button.google", "[data-theme='dark'] .a11y-p", "html.a-contrast[data-theme='dark'] {", ':root { --sk-hi:', ":root[data-theme='dark'] { --sk-hi:"]) {
    assert.ok(css.includes(s), `site.css: ${s}`);
  }
  for (const s of ['.theme, .theme:hover { position: fixed;', '.theme[hidden] { display: none; }', ".theme .sun, [data-theme='dark'] .theme .moon { display: none; }", "[data-theme='dark'] .theme .sun { display: block; }"]) {
    assert.ok(css.includes(s), `site.css: ${s}`);
  }
});

async function setup() {
  const h = tempHome();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  // A complimentary workspace (its owner lands on the home page), an unpaid one (its owner lands on /setup).
  makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', products: ['teder'], comp: true, members: { 'dana@example.com': 'client_owner' } });
  const noa = makeWorkspace(h.db, 'noa-studio', { name: 'סטודיו נועה', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
  h.db.insert('subscriptions', { workspace_id: noa.id, product: 'teder', monthly: 790, vat: 'excluded', setup: 1490, started_on: today, updated_at: new Date().toISOString() });
  const teder = await startProduct('teder');
  const toran = await startToran({ data: sampleOps(Date.now()) });
  const site = await startSite(h.db, { env: { PUBLIC_HOST: '', OF_SIGNUP: '1', OF_TEDER_INTERNAL: teder.url, OF_TORAN_INTERNAL: toran.url, TEDER_URL: 'https://teder.openfrequency.co.il/', OF_ASSISTANT_WA: '972500000100' } });
  const sid = (email, opts) => createSession(h.db, h.db.get('SELECT * FROM users WHERE email = ?', email) || makeUser(h.db, email, opts)).id;
  const sessions = { dana: sid('dana@example.com'), noa: sid('noa@example.com'), admin: sid('admin@example.com', { superadmin: true, name: 'נתנאל' }) };
  const base = `http://127.0.0.1:${site.s.port}`;
  return { ...h, ...site, base, sessions, done: async () => (await site.close(), await teder.close(), await toran.close(), h.cleanup()) };
}

// Every page a visitor, a customer and the operator open, by who opens it: sign-in, sign-up, /setup, /admin, the errors.
const PAGES = {
  '': ['/login', '/signup', '/signup?p=teder&plan=small', '/admin/login', '/signup/confirm?t=x', '/invite?t=x', '/no-such-page'],
  dana: ['/', '/account/delete', '/notifications', '/logout', '/subscription/teder/cancel'],
  noa: ['/setup'],
  admin: ['/admin', '/admin/accounts', '/admin/receipts/999'],
};

test('every page the server renders comes light without the cookie or with a junk one, and dark with of-theme=dark, its errors included', async () => {
  const t = await setup();
  try {
    for (const [cookie, theme] of [[null, 'light'], ['dark', 'dark'], ['light', 'light'], ['Dark', 'light'], ['1', 'light'], ['%3Cscript%3E', 'light']]) {
      for (const [who, paths] of Object.entries(PAGES)) {
        const b = t.browser();
        if (cookie != null) b.jar.set('of-theme', { value: cookie });
        if (who) b.jar.set('of_session', { value: t.sessions[who] });
        for (const p of paths) {
          const r = await b.get(p);
          assert.ok([200, 400, 404, 410].includes(r.status), `${p}: ${r.status}`);
          assertHead(r.body, theme, `of-theme=${cookie} ${who || 'a visitor'} ${p}`);
          assertSwitch(r.body, theme, `of-theme=${cookie} ${who || 'a visitor'} ${p}`);
          // The server never writes the theme: it is the visitor's, written by the switch.
          assert.ok(!(r.setCookies || []).some((c) => /^of-theme=/.test(c)), `${p}: no of-theme cookie set by the server`);
        }
      }
      // The refusals: a form with no CSRF cookie, a form from another site.
      const b = t.browser();
      if (cookie != null) b.jar.set('of-theme', { value: cookie });
      const stale = await b.post('/login', { email: 'dana@example.com' });
      assert.equal(stale.status, 403);
      assertHead(stale.body, theme, `of-theme=${cookie}: a stale form`);
      const x = t.browser({ origin: 'https://evil.example' });
      if (cookie != null) x.jar.set('of-theme', { value: cookie });
      const cross = await x.post('/login', { email: 'dana@example.com' });
      assert.equal(cross.status, 403);
      assertHead(cross.body, theme, `of-theme=${cookie}: a form from another site`);
    }
  } finally {
    await t.done();
  }
});

test('the server error page is in the chosen theme too', async () => {
  const h = tempHome();
  // Toran's client throws on /admin, so the request ends in the 500 page.
  const site = await startSite(h.db, { env: { PUBLIC_HOST: '' }, toran: { base: '', ops: async () => { throw new Error('boom'); } } });
  try {
    const admin = createSession(h.db, makeUser(h.db, 'admin@example.com', { superadmin: true })).id;
    for (const [cookie, theme] of [[null, 'light'], ['dark', 'dark'], ['nope', 'light']]) {
      const b = site.browser();
      b.jar.set('of_session', { value: admin });
      if (cookie) b.jar.set('of-theme', { value: cookie });
      const r = await b.get('/admin');
      assert.equal(r.status, 500);
      assertHead(r.body, theme, `500 with of-theme=${cookie}`);
    }
  } finally {
    await site.close();
    h.cleanup();
  }
});

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
  const b = await chromium.launch();
  await b.close();
} catch (e) {
  if (process.env.OF_REQUIRE_BROWSER === '1') throw new Error(`OF_REQUIRE_BROWSER=1 and Chromium does not start (npx playwright-core install --with-deps chromium): ${e.message}`);
  chromium = null;
}
const run = chromium ? test : test.skip;

const gap = (a, b) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));

run('in a real browser on a device that prefers dark: light, one tap dark with the cookie and the metas, the next page dark from the server, and back', async () => {
  const t = await setup();
  const browser = await chromium.launch();
  const refused = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('console', (m) => m.type() === 'error' && refused.push(m.text()));
    page.on('pageerror', (e) => refused.push(e.message));
    const state = () =>
      page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'),
        scheme: document.querySelector('meta[name="color-scheme"]').content,
        color: document.querySelector('meta[name="theme-color"]').content,
        bg: getComputedStyle(document.body).backgroundColor,
      }));
    const cookie = async () => (await context.cookies()).find((c) => c.name === 'of-theme');

    await page.goto(`${t.base}/login`);
    assert.deepEqual(await state(), { theme: 'light', pressed: 'false', scheme: 'light', color: '#eeeff2', bg: 'rgb(238, 239, 242)' }, 'light, though the device prefers dark');
    assert.equal(await cookie(), undefined, 'nothing written before a tap');
    const sw = page.locator('[data-theme-toggle]');
    assert.ok(await sw.isVisible(), 'the script shows the switch');
    assert.ok(await page.locator('.theme .moon').isVisible(), 'a moon while light');

    await sw.tap();
    assert.deepEqual(await state(), { theme: 'dark', pressed: 'true', scheme: 'dark', color: '#111113', bg: 'rgb(17, 17, 19)' }, 'dark at once');
    assert.ok(await page.locator('.theme .sun').isVisible(), 'a sun while dark');
    const c = await cookie();
    assert.equal(c?.value, 'dark');
    assert.equal(c.path, '/');
    assert.equal(c.domain, '127.0.0.1', 'this host alone, locally');
    assert.equal(c.sameSite, 'Lax');
    assert.equal(c.secure, false);
    assert.ok(Math.abs(c.expires - (Date.now() / 1000 + 31536000)) < 120, `a year (${c.expires})`);

    // The next page comes dark from the server, before any script.
    const next = await page.goto(`${t.base}/signup`);
    assert.match(await next.text(), /<html lang="he" dir="rtl" data-theme="dark">/);
    assert.deepEqual(await state(), { theme: 'dark', pressed: 'true', scheme: 'dark', color: '#111113', bg: 'rgb(17, 17, 19)' });
    await page.reload();
    assert.equal((await state()).theme, 'dark', 'a reload keeps it');

    await sw.tap();
    assert.deepEqual(await state(), { theme: 'light', pressed: 'false', scheme: 'light', color: '#eeeff2', bg: 'rgb(238, 239, 242)' }, 'light again');
    assert.equal((await cookie()).value, 'light');
    assert.match(await (await page.goto(`${t.base}/login`)).text(), /data-theme="light"/);

    // By keyboard: Tab reaches it, and Enter turns the page over.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-theme-toggle'));
    }
    assert.ok(reached, 'Tab reaches the switch');
    await page.keyboard.press('Enter');
    assert.equal((await state()).theme, 'dark');
    await context.close();
    assert.deepEqual(refused, [], 'no error, no CSP refusal');
  } finally {
    await browser.close();
    await t.done();
  }
});

run('the switch on the main pages, phone and desk: one tap away beside the accessibility button, apart from it and from the foot, nothing sideways', async () => {
  const t = await setup();
  const browser = await chromium.launch();
  const MAIN = [['', '/login'], ['', '/signup'], ['noa', '/setup'], ['dana', '/'], ['admin', '/admin']];
  try {
    for (const [width, height, phone] of [[320, 640, true], [390, 844, true], [1280, 800, false]]) {
      for (const theme of ['light', 'dark']) {
        const c = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, colorScheme: theme === 'dark' ? 'light' : 'dark' });
        if (theme === 'dark') await c.addCookies([{ name: 'of-theme', value: 'dark', url: t.base }]);
        const pg = await c.newPage();
        for (const [who, path] of MAIN) {
          await c.clearCookies({ name: 'of_session' });
          if (who) await c.addCookies([{ name: 'of_session', value: t.sessions[who], url: t.base }]);
          await pg.goto(`${t.base}${path}`);
          const where = `${path} ${width} ${theme}`;
          assert.equal(await pg.evaluate(() => document.documentElement.dataset.theme), theme, where);
          const sw = await pg.locator('[data-theme-toggle]').boundingBox();
          const a11y = await pg.locator('.a11y-btn').boundingBox();
          assert.ok(sw && sw.width >= 44 && sw.height >= 44, `${where}: a finger's size (${JSON.stringify(sw)})`);
          assert.ok(sw.x >= 0 && sw.x + sw.width <= width && sw.y >= 0 && sw.y + sw.height <= height, `${where}: whole on the screen`);
          assert.ok(Math.abs(sw.y - a11y.y) < 1, `${where}: on the accessibility button's row`);
          assert.ok(gap(sw, a11y) >= 8, `${where}: 8px or more from the accessibility button (${gap(sw, a11y)})`);
          // At the end of the page the corner shares the foot's row: the statement's link stays clear of both buttons.
          await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const foot = await pg.locator('.site-foot a').boundingBox();
          const [s2, a2] = [await pg.locator('[data-theme-toggle]').boundingBox(), await pg.locator('.a11y-btn').boundingBox()];
          assert.ok(gap(foot, s2) >= 8 && gap(foot, a2) >= 8, `${where}: the foot's link clear of the corner (${gap(foot, s2)}, ${gap(foot, a2)})`);
          // And nothing of the page itself is under them there: its last words and controls scroll clear of the corner
          // (main's padding and the foot's row below it). Looked at scrolled to the end, as a phone shows it: a
          // full-page screenshot draws the corner where the first screen ends, over whatever is there.
          const under = await pg.evaluate(() => {
            const corner = [...document.querySelectorAll('.a11y-btn, [data-theme-toggle]')].map((e) => e.getBoundingClientRect());
            const over = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            const said = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || e.matches('a, button, input, select, textarea, progress, img, svg');
            return [...document.querySelectorAll('main *')]
              .filter((e) => e.getClientRects().length && said(e) && corner.some((b) => over(e.getBoundingClientRect(), b)))
              .map((e) => `${e.tagName.toLowerCase()}: ${e.textContent.trim().slice(0, 40)}`);
          });
          assert.deepEqual(under, [], `${where}: the page's last content clear of the corner`);
          assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${where}: no sideways scroll`);
        }
        await c.close();
      }
    }
  } finally {
    await browser.close();
    await t.done();
  }
});

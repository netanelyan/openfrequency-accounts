import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { startSite } from './site.js';
import { startProduct } from './setup-fake.js';
import { startToran, sampleOps } from './toran-fake.js';
import { createSession } from '../src/auth/sessions.js';
import { ACCESSIBILITY_URL, layout } from '../src/web/html.js';

// The website's accessibility panel on every page here too (the owner, 2026-10-31: "accesebillity widget should be
// available in each subdomain. not only on the web repo"): the round button at the bottom corner, four switches that
// are classes on <html> (a-big, a-contrast, a-links, a-still) kept in the browser under the website's key, of-a11y, a
// reset, and the statement on the website. Here: every page and every shape of the layout carries it, the script and
// the stylesheet that make it work are served, and in a real browser it opens, switches, remembers, closes on Escape
// and on a click outside, under the CSP, and the larger text never pushes a page sideways on a phone.
//
// The browser test is skipped when no Chromium is installed (npx playwright-core install chromium), except where
// OF_REQUIRE_BROWSER=1 (CI, npm run release-check), as in browser.test.js. OF_SCREENSHOTS=<folder> keeps a picture of
// the panel closed, open and with the larger text, at 390 and 1440.

const SWITCHES = [['big', 'טקסט גדול יותר'], ['contrast', 'ניגודיות גבוהה'], ['links', 'קו מתחת לקישורים'], ['still', 'לעצור תנועה']];
const STATEMENT = `<a href="${ACCESSIBILITY_URL}">הצהרת הנגישות</a>`;

/** The panel's markup in a page, whole: hidden until the script shows it, the button before the panel. */
function assertPanel(html, where) {
  assert.equal((html.match(/<div class="a11y-w" data-a11y hidden>/g) || []).length, 1, `${where}: one panel`);
  const box = html.slice(html.indexOf('<div class="a11y-w"'));
  assert.match(box, /^<div class="a11y-w" data-a11y hidden>\n<button class="a11y-btn" type="button" aria-expanded="false" aria-controls="a11y-p">[^]*?<span class="sr">נגישות<\/span><\/button>\n<div class="a11y-p" id="a11y-p" role="group" aria-labelledby="a11y-h" hidden>\n<h2 id="a11y-h">נגישות<\/h2>/, `${where}: the button, then the panel`);
  for (const [k, label] of SWITCHES) assert.ok(box.includes(`<button type="button" data-a="${k}" aria-pressed="false">${label}</button>`), `${where}: the switch ${k}`);
  assert.ok(box.includes(`<button type="button" class="a11y-reset" data-a11y-reset>לאפס</button>${STATEMENT}`), `${where}: the reset and the statement, on the website`);
  assert.equal(ACCESSIBILITY_URL, 'https://openfrequency.co.il/accessibility');
  // Nothing the CSP would refuse: no style attribute, no handler written into it.
  assert.doesNotMatch(box.slice(0, box.indexOf('</div>\n</div>')), /\sstyle=|\son[a-z]+=/, `${where}: no inline style or handler`);
  // Its script in the head, before the stylesheet and without defer, so the saved switches are on before the page paints.
  assert.match(html, /<script src="\/static\/a11y\.js\?v=[^"]+"><\/script>\n<link rel="stylesheet" href="\/static\/site\.css\?v=[^"]+">/, `${where}: a11y.js in the head`);
  assert.ok(html.indexOf('/static/a11y.js') < html.indexOf('</head>'), `${where}: in the head`);
}

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

// Every page a visitor, a customer and the operator open, by who opens it.
const PAGES = {
  '': ['/login', '/signup', '/signup?p=teder', '/admin/login', '/signup/confirm?t=x', '/invite?t=x', '/no-such-page'],
  dana: ['/', '/account/delete', '/notifications', '/logout'],
  noa: ['/setup'],
  admin: ['/admin', '/admin/accounts'],
};

test('every page carries the accessibility panel, its script and its stylesheet are served, and every shape of the layout has it', async () => {
  for (const opts of [{}, { wide: true }, { wide: true, script: true }, { banner: '<div class="banner"></div>', flash: 'x' }]) {
    assertPanel(layout({ title: 't', body: '<p>x</p>', v: 'v1', ...opts }), `layout ${JSON.stringify(opts)}`);
  }
  const t = await setup();
  try {
    for (const [who, paths] of Object.entries(PAGES)) {
      const b = t.browser();
      if (who) b.jar.set('of_session', { value: t.sessions[who] });
      for (const p of paths) {
        const r = await b.get(p);
        assert.ok([200, 404, 410].includes(r.status), `${p}: ${r.status}`);
        assertPanel(r.body, `${who || 'a visitor'} ${p}`);
        assert.match(r.headers['content-security-policy'], /script-src 'self';/);
        assert.doesNotMatch(r.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
      }
    }
    const js = await t.browser().get('/static/a11y.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
    for (const s of ["'of-a11y'", "['big', 'contrast', 'links', 'still']", '[data-a11y]', "'Escape'", 'aria-expanded', 'aria-pressed', 'data-a11y-reset']) assert.ok(js.body.includes(s), `a11y.js: ${s}`);
    const css = await t.browser().get('/static/site.css');
    for (const s of ['.a11y-w { position: fixed;', '.a11y-btn', '.a11y-p {', 'html.a-big body { zoom: 1.2; }', 'html.a-links a', 'html.a-still *', 'html.a-contrast {', '.a11y-w[hidden], .a11y-p[hidden] { display: none; }']) assert.ok(css.body.includes(s), `site.css: ${s}`);
  } finally {
    await t.done();
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

run('in a real browser: Tab reaches the button, it opens the panel, a switch is a class on <html> that a reload keeps, Escape and a click outside close it, under the CSP; and the larger text never pushes a page sideways at 390', async () => {
  const t = await setup();
  const browser = await chromium.launch();
  const refused = [];
  const watch = (page) => {
    page.on('console', (m) => m.type() === 'error' && refused.push(m.text()));
    page.on('pageerror', (e) => refused.push(e.message));
  };
  const shots = process.env.OF_SCREENSHOTS;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    await context.addCookies([{ name: 'of_session', value: t.sessions.dana, url: t.base }]);
    const page = await context.newPage();
    watch(page);
    await page.goto(`${t.base}/`);
    const btn = page.locator('.a11y-btn');
    const panel = page.locator('#a11y-p');
    assert.ok(await btn.isVisible(), 'the script shows the button');
    assert.ok(await panel.isHidden(), 'the panel starts closed');
    // The button where the website has it: the bottom corner on the inline end (the left, right to left), whole on screen.
    const at = await btn.boundingBox();
    assert.ok(at.x >= 8 && at.x <= 24 && at.y + at.height <= 844 - 8 && at.y + at.height >= 844 - 32, `the bottom left corner (${JSON.stringify(at)})`);
    // By keyboard alone: Tab from the top of the page reaches the button.
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.classList.contains('a11y-btn'));
    }
    assert.ok(reached, 'Tab reaches the button');
    assert.ok(await page.evaluate(() => document.activeElement.matches(':focus-visible')), 'its focus shows');
    await page.keyboard.press('Enter');
    assert.ok(await panel.isVisible(), 'Enter opens the panel');
    assert.equal(await btn.getAttribute('aria-expanded'), 'true');
    // The panel whole on the screen, over the button.
    const p = await panel.boundingBox();
    assert.ok(p.x >= 0 && p.x + p.width <= 390 && p.y >= 0 && p.y + p.height <= at.y, `the panel on screen, above the button (${JSON.stringify(p)})`);
    // Tab from the open button goes into the switches.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.a), 'big', 'the first switch is next');
    if (shots) await page.screenshot({ path: `${shots}/accounts-open-390.png` });

    // A switch: its class on <html>, pressed, kept in this browser under the website's key; and after a reload.
    for (const [k] of SWITCHES) {
      await page.click(`[data-a="${k}"]`);
      assert.ok(await page.evaluate((c) => document.documentElement.classList.contains(c), `a-${k}`), `a-${k} on <html>`);
      assert.equal(await page.getAttribute(`[data-a="${k}"]`, 'aria-pressed'), 'true');
      await page.click(`[data-a="${k}"]`);
      assert.ok(!(await page.evaluate((c) => document.documentElement.classList.contains(c), `a-${k}`)), `a-${k} off again`);
    }
    await page.click('[data-a="big"]');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('of-a11y'))), { big: true, contrast: false, links: false, still: false }, "kept under the website's key");
    await page.reload();
    // On <html> as the page is read: a11y.js in the head puts it there before the body exists.
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('a-big')), 'the larger text survives a reload');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).zoom), '1.2');
    assert.equal(await page.getAttribute('[data-a="big"]', 'aria-pressed'), 'true', 'and its switch says so');
    assert.ok(await panel.isHidden(), 'the panel closed after the reload');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll with the larger text');
    if (shots) await page.screenshot({ path: `${shots}/accounts-big-390.png` });

    // Escape closes it and gives the focus back to the button; a click outside closes it too.
    await btn.click();
    assert.ok(await panel.isVisible());
    await page.keyboard.press('Escape');
    assert.ok(await panel.isHidden(), 'Escape closes the panel');
    assert.equal(await btn.getAttribute('aria-expanded'), 'false');
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('a11y-btn')), 'the focus is back on the button');
    await btn.click();
    await page.mouse.click(200, 120);
    assert.ok(await panel.isHidden(), 'a click outside closes the panel');
    assert.equal(await btn.getAttribute('aria-expanded'), 'false');
    // The reset takes every switch off.
    await btn.click();
    await page.click('[data-a="contrast"]');
    await page.click('[data-a11y-reset]');
    assert.equal(await page.evaluate(() => [...document.documentElement.classList].filter((c) => c.startsWith('a-')).join(' ')), '');
    assert.equal(await page.evaluate(() => localStorage.getItem('of-a11y')), '{}');
    await page.keyboard.press('Escape');
    if (shots) await page.screenshot({ path: `${shots}/accounts-closed-390.png` });
    await context.close();

    // The larger text on every page, on a phone: nothing past the screen's edge, the panel opens whole.
    for (const [who, paths] of Object.entries(PAGES)) {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
      await c.addInitScript(() => localStorage.setItem('of-a11y', '{"big":true}'));
      if (who) await c.addCookies([{ name: 'of_session', value: t.sessions[who], url: t.base }]);
      const pg = await c.newPage();
      watch(pg);
      for (const path of paths.filter((x) => x !== '/logout')) {
        await pg.goto(`${t.base}${path}`);
        assert.ok(await pg.evaluate(() => document.documentElement.classList.contains('a-big')), `${path}: the larger text on`);
        assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${path} at 390 with the larger text: no sideways scroll`);
        await pg.click('.a11y-btn');
        const box = await pg.locator('#a11y-p').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0, `${path}: the panel whole on the screen (${JSON.stringify(box)})`);
      }
      await c.close();
    }

    // On a desk, in the dark too: the same corner, and the pictures.
    for (const colorScheme of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme });
      await c.addCookies([{ name: 'of_session', value: t.sessions.admin, url: t.base }]);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(`${t.base}/admin`);
      const b = await pg.locator('.a11y-btn').boundingBox();
      assert.ok(b.x >= 8 && b.x <= 24 && b.y + b.height >= 900 - 32, `1440 ${colorScheme}: the bottom left corner`);
      const tag = colorScheme === 'dark' ? '-dark' : '';
      if (shots) await pg.screenshot({ path: `${shots}/accounts-closed-1440${tag}.png` });
      await pg.click('.a11y-btn');
      if (shots) await pg.screenshot({ path: `${shots}/accounts-open-1440${tag}.png` });
      await pg.click('[data-a="big"]');
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `1440 ${colorScheme}: no sideways scroll with the larger text`);
      if (shots) await pg.screenshot({ path: `${shots}/accounts-big-1440${tag}.png` });
      await c.close();
    }
    if (shots) {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
      await c.addCookies([{ name: 'of_session', value: t.sessions.dana, url: t.base }]);
      const pg = await c.newPage();
      await pg.goto(`${t.base}/`);
      await pg.click('.a11y-btn');
      await pg.screenshot({ path: `${shots}/accounts-open-390-dark.png` });
      await c.close();
    }
    assert.deepEqual(refused.filter((m) => /Content Security Policy|Refused to/i.test(m)), [], 'no CSP refusal');
    // The pages that answer 404 and 410 (an unknown page, a dead link) say so in the console; nothing else may.
    assert.deepEqual(refused.filter((m) => !/^Failed to load resource: the server responded with a status of 4(04|10)/.test(m)), [], 'no error in the console');
  } finally {
    await browser.close();
    await t.done();
  }
});

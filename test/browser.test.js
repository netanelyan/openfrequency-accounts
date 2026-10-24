import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { startSite } from './site.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret } from '../src/auth/totp.js';
import { createSession } from '../src/auth/sessions.js';

// The forms in a real browser. The HTTP tests set their own headers; a browser
// sets Origin, Referer and cookies by its own rules, and an early version of the
// site refused every form because of that (Referrer-Policy: no-referrer makes
// Chromium send "Origin: null"). Skipped when no Chromium is installed
// (npx playwright-core install chromium).

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
  const b = await chromium.launch();
  await b.close();
} catch {
  chromium = null;
}

const run = chromium ? test : test.skip;

async function setup() {
  const h = tempHome();
  makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', products: ['teder'], members: { 'dana@example.com': 'client_owner' } });
  const { codes } = setSuperadmin(h.db, { email: 'admin@example.com', password: 'a long enough password', totpSecret: newTotpSecret() });
  const site = await startSite(h.db, { env: { PUBLIC_HOST: '', TEDER_URL: 'http://localhost:4700/', OF_ASSISTANT_WA: '972500000100' } });
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${site.s.port}`;
  return { ...h, ...site, codes, browser, base, done: async () => (await browser.close(), await site.close(), h.cleanup()) };
}

run('a customer signs in with the form, the emailed link and the button, then signs out', async () => {
  const t = await setup();
  try {
    const page = await t.browser.newPage();
    await page.goto(`${t.base}/login`);
    await page.fill('#email', 'dana@example.com');
    await page.click('button.primary');
    assert.match(await page.textContent('h1'), /בדקו את המייל/);
    assert.equal(t.mails.length, 1);

    await page.goto(t.mails[0].link);
    await page.click('button.primary');
    await page.waitForURL(`${t.base}/`);
    assert.match(await page.textContent('main'), /אתם מחוברים בתור dana@example\.com, בחשבון של החנות של דנה\./);
    const cookie = (await page.context().cookies()).find((c) => c.name === 'of_session');
    assert.ok(cookie?.httpOnly);
    assert.equal((await t.internal(cookie.value)).json.workspace.slug, 'dana-shop');

    await page.click('a[href="/logout"]');
    await page.click('form[action="/logout"] button');
    await page.waitForURL(/\/login\?out=1$/);
    assert.match(await page.textContent('main'), /יצאתם\./);
    assert.equal((await t.internal(cookie.value)).status, 401);
  } finally {
    await t.done();
  }
});

run('the superadmin signs in and opens a workspace from the console', async () => {
  const t = await setup();
  try {
    const page = await t.browser.newPage();
    await page.goto(`${t.base}/admin/login`);
    await page.fill('#email', 'admin@example.com');
    await page.fill('#password', 'a long enough password');
    await page.fill('#code', t.codes[0]);
    await page.click('button.primary');
    await page.waitForURL(`${t.base}/admin`);
    await page.fill('input[name="name"]', 'סטודיו נועה');
    await page.fill('input[name="slug"]', 'noa-studio');
    await page.fill('input[name="owner"]', 'noa@example.com');
    await page.check('input[name="products"][value="toran"]');
    await page.click('form[action="/admin/workspaces"] button.primary');
    await page.waitForURL(`${t.base}/admin`);
    assert.match(await page.textContent('.flash'), /פתחנו את סטודיו נועה ושלחנו הזמנה ל-noa@example\.com\./);
    const products = t.db.all("SELECT product FROM workspace_products wp JOIN workspaces w ON w.id = wp.workspace_id WHERE w.slug = 'noa-studio' AND enabled = 1").map((r) => r.product);
    assert.deepEqual(products.sort(), ['teder', 'toran']);
    assert.equal(t.mails.at(-1).to, 'noa@example.com');
  } finally {
    await t.done();
  }
});

run('on a phone, a customer ticks the box, gets the code and the WhatsApp button, and nothing runs off the screen', async () => {
  const t = await setup();
  try {
    const dana = t.db.get("SELECT * FROM users WHERE email = 'dana@example.com'");
    const context = await t.browser.newContext({ viewport: { width: 375, height: 800 } });
    await context.addCookies([{ name: 'of_session', value: createSession(t.db, dana).id, url: t.base }]);
    const page = await context.newPage();
    await page.goto(`${t.base}/`);
    await page.check('input[name="updates"]');
    await page.click('form[action="/whatsapp/link"] button');
    await page.waitForURL(`${t.base}/#whatsapp`);
    const code = await page.textContent('.wa-code .code');
    assert.match(code, /^LINK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(await page.getAttribute('.wa-code a.button', 'href'), `https://wa.me/972500000100?text=${code}`);
    assert.equal(t.db.get('SELECT opt_in FROM phone_links').opt_in, 1);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(wide, 0);
  } finally {
    await t.done();
  }
});

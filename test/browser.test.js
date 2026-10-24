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

run('the home page on a phone, in dark mode: the bar fills from the right, the invoices and the team fit, and the invite form works', async () => {
  const t = await setup();
  try {
    const { payMonth } = await import('../src/accounts/subscriptions.js');
    const { addInvoice } = await import('../src/accounts/invoices.js');
    const ws = t.db.get("SELECT id FROM workspaces WHERE slug = 'dana-shop'").id;
    const admin = t.db.get("SELECT * FROM users WHERE email = 'admin@example.com'");
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    t.db.run("UPDATE subscriptions SET paid_until = NULL WHERE workspace_id = ?", ws);
    t.db.run("INSERT INTO subscriptions (workspace_id, product, monthly, vat, setup, started_on, updated_at) VALUES (?, 'teder', 790, 'excluded', 1490, ?, ?) ON CONFLICT DO NOTHING", ws, today, new Date().toISOString());
    payMonth(t.db, ws, 'teder', { by: admin });
    addInvoice(t.db, ws, { product: 'teder', number: 'INV-2026-001042', issued_on: today, period_from: today, period_to: today, amount: '790', vat: '142.2' }, Buffer.from('%PDF-1.7\n%%EOF\n'), { by: admin });

    const context = await t.browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(`${t.base}/login`);
    await page.fill('#email', 'dana@example.com');
    await page.click('button.primary');
    await page.goto(t.mails.at(-1).link);
    await page.click('button.primary');
    await page.waitForURL(`${t.base}/`);

    // Nothing wider than the phone.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
    // The bar: a progressbar to a screen reader, with its words; its filled part starts at the right edge.
    const bar = page.locator('progress');
    assert.equal(await bar.getAttribute('aria-valuetext'), 'יום 1 מתוך 31. נשארו 31 ימים בחודש ששולם');
    assert.equal(await bar.evaluate((el) => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.getByRole('progressbar').count(), 1);
    // Dark: the tiles are dark glass, the words light.
    const ink = await page.evaluate(() => getComputedStyle(document.body).color);
    assert.equal(ink, 'rgb(245, 245, 247)');

    const row = page.locator('ul.invoices li').first();
    assert.match(await row.textContent(), /תדר, חשבונית INV-2026-001042[^]*932\.20 ₪[^]*790 ₪ ועוד מע״מ 142\.20 ₪/);
    const box = await row.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 375, 'the invoice row fits');
    const doc = await page.request.get(`${t.base}${await row.locator('a').getAttribute('href')}`);
    assert.equal(doc.headers()['content-type'], 'application/pdf');

    await page.fill('#team-email', 'noa@example.com');
    await page.click('form.team-add button');
    await page.waitForURL(`${t.base}/#team`);
    assert.match(await page.textContent('.flash'), /שלחנו הזמנה ל-noa@example\.com/);
    assert.match(await page.textContent('#team'), /2 מתוך 3[^]*noa@example\.com/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'still no sideways scroll');
    if (process.env.OF_SCREENSHOTS) await page.screenshot({ path: `${process.env.OF_SCREENSHOTS}/home-phone-dark.png`, fullPage: true });
    await context.close();
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

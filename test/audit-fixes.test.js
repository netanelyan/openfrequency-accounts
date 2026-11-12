import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { sampleSetup, startProduct } from './setup-fake.js';
import { setNow } from '../src/core/clock.js';
import { addDays, ensureSubscription, israelToday, payMonth } from '../src/accounts/subscriptions.js';
import { cancelSubscription } from '../src/accounts/entitlement.js';
import { setDisabled } from '../src/accounts/workspaces.js';
import { createInvite } from '../src/accounts/links.js';
import { AUDIT_NAMES } from '../src/web/copy.js';

// What the pre-launch audit of 2026-11-11 found on the customer's pages and the operator's console, each as it is now
// (the owner, 2026-11-11: "do a final run around EVERYTHING. correct everything that is incomplete").

const SUPPORT = '972500000000';

async function setup({ env = {}, answer = () => sampleSetup('teder', { done: true }) } = {}) {
  const h = tempHome();
  setNow('2026-11-11T10:00:00.000Z');
  const teder = await startProduct('teder', { answer });
  const site = await startSite(h.db, { env: { OF_TEDER_INTERNAL: teder.url, TEDER_URL: 'https://teder.openfrequency.co.il/', OF_SUPPORT_WA: SUPPORT, ...env } });
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true });
  const ws = makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', products: ['teder'], members: { 'dana@example.com': 'client_owner', 'noa@example.com': 'client_member' } });
  ensureSubscription(h.db, ws.id, 'teder', undefined, 'small');
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  const paidUntil = (d) => h.db.run("UPDATE subscriptions SET paid_until = ? WHERE workspace_id = ? AND product = 'teder'", d, ws.id);
  return { ...h, ...site, teder, ws, admin, user, paidUntil, as: (email) => signedIn(site, h.db, user(email)), done: async () => (await site.close(), await teder.close(), h.cleanup()) };
}

test('in its 72 hours the home page leads to the payment, its one blue button; past them the product is tagged stopped, not waiting', async () => {
  const t = await setup();
  try {
    const today = israelToday();
    t.paidUntil(addDays(today, -1));
    const dana = t.as('dana@example.com');
    let home = (await dana.get('/')).body;
    // Teder's steps are done: the payment is all that is left, so the card is about it (it said "להמשך ההגדרה").
    assert.match(home, /<section class="card setup-card"><div><h2>התשלום על החודש החדש עוד לא הגיע<\/h2><\/div><a class="button primary" href="\/setup#setup-billing">לתשלום<\/a><\/section>/);
    assert.doesNotMatch(home, /להמשך ההגדרה/);
    assert.equal(home.match(/class="button primary"/g).length, 1);
    assert.match(home, /<article class="card sub s-due">[^]*?<span class="tag">מחכה לתשלום<\/span>/);

    // The 72 hours over: stopped, said by the tag too (it said "מחכה לתשלום" over "...המנוי נעצר").
    t.paidUntil(addDays(today, -5));
    home = (await dana.get('/')).body;
    assert.match(home, /<article class="card sub s-stopped">[^]*?<span class="tag">נעצר<\/span>[^]*?המנוי נעצר\./);
    assert.match(home, /<h2>התשלום על החודש החדש עוד לא הגיע<\/h2>/);
  } finally {
    await t.done();
  }
});

test('a new customer with steps left still sees the setup card; the payment card is for when it is all that is left', async () => {
  const t = await setup({ answer: () => sampleSetup('teder') });
  try {
    const home = (await t.as('dana@example.com').get('/')).body;
    assert.match(home, /<h2>הגדרת החשבון<\/h2>[^]*?<a class="button primary" href="\/setup">להמשך ההגדרה<\/a>/);
    // The setup fee with its VAT word, as the month has it (the audit: "דמי הקמה: 990 ₪, פעם אחת").
    assert.match(home, /דמי הקמה: 990 ₪ ועוד מע״מ, פעם אחת/);
  } finally {
    await t.done();
  }
});

test('a cancelled product keeps its two buttons in one row: the resume form inside the card\'s buttons, not fallen out of a <p>', async () => {
  const t = await setup();
  try {
    payMonth(t.db, t.ws.id, 'teder', { by: t.admin });
    cancelSubscription(t.db, t.ws.id, 'teder', { by: t.user('dana@example.com') });
    const home = (await t.as('dana@example.com').get('/')).body;
    assert.match(home, /<div class="go"><a class="button primary" href="https:\/\/teder\.openfrequency\.co\.il\/">כניסה לתדר<\/a><form method="post" action="\/subscription\/teder\/resume" class="inline">[^]*?להמשיך את המנוי<\/button><\/form><\/div>/);
    assert.doesNotMatch(home, /<p class="go">/);
  } finally {
    await t.done();
  }
});

test('the cancel page in the 72 hours says the new month is what is not paid, and promises no undo for today; a refusal says only "חזרה לדף הראשי"', async () => {
  const t = await setup();
  try {
    t.paidUntil(addDays(israelToday(), -1));
    const dana = t.as('dana@example.com');
    const page = (await dana.get('/subscription/teder/cancel')).body;
    assert.match(page, /את החודש החדש של תדר עוד לא שילמתם, אז הביטול חל מהיום, ולא נחייב אתכם עליו\./);
    assert.doesNotMatch(page, /עוד לא שילמתם על תדר|אפשר לחזור בכם/);
    // Paid ahead, the undo line is there, with its day.
    t.paidUntil(addDays(israelToday(), 10));
    assert.match((await dana.get('/subscription/teder/cancel')).body, /אפשר לחזור בכם מהדף הראשי/);
    // A member is refused, with nothing to say "לא" to.
    const refused = await t.as('noa@example.com').get('/subscription/teder/cancel');
    assert.equal(refused.status, 403);
    assert.match(refused.body, /<a href="\/">חזרה לדף הראשי<\/a>/);
    assert.doesNotMatch(refused.body, /לא, חזרה/);
  } finally {
    await t.done();
  }
});

test('a closed workspace says so by its name, with our WhatsApp, on the home page and when it is the only one', async () => {
  const t = await setup();
  try {
    // Signed in while it was open, and the operator closes it.
    const dana = t.as('dana@example.com');
    setDisabled(t.db, t.ws.id, true, { by: t.admin });
    const home = await dana.get('/');
    assert.equal(home.status, 403);
    assert.match(home.body, /<h1>החשבון של החנות של דנה סגור כרגע\.<\/h1>/);
    assert.match(home.body, /אם זו טעות, כתבו לנו בוואטסאפ\./);
    assert.match(home.body, new RegExp(`<a href="https://wa\\.me/${SUPPORT}\\?text=[^"]+">כתבו לנו בוואטסאפ</a>`));
    // Signed in again, with no other workspace: the same, not "we have not connected you to a business yet".
    const fresh = signedIn(t, t.db, t.user('dana@example.com'));
    const r = await fresh.get('/workspace');
    assert.equal(r.status, 403);
    assert.match(r.body, /החשבון של החנות של דנה סגור כרגע\./);
    assert.doesNotMatch(r.body, /עוד לא חיברנו אתכם/);
  } finally {
    await t.done();
  }
});

test('a dead invite has no button that leads nowhere: a new one comes from whoever sent it, and a quiet way in for someone who joined', async () => {
  const t = await setup();
  try {
    const page = await t.browser().get('/invite?t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdEF');
    assert.equal(page.status, 410);
    assert.match(page.body, /בקשו ממי שהזמין אתכם לשלוח אותה שוב/);
    assert.doesNotMatch(page.body, /class="button primary"|ענו למייל ההזמנה/);
    assert.match(page.body, /<p class="links"><a href="\/login">לכניסה<\/a><\/p>/);
    // The invite page itself: "לחשבון של", never "ל-" before the name.
    const inv = createInvite(t.db, { workspaceId: t.ws.id, email: 'gal@example.com', role: 'client_member', by: t.admin });
    assert.match((await t.browser().get(`/invite?t=${inv.token}`)).body, /<h1>הוזמנתם לחשבון של החנות של דנה<\/h1>/);
  } finally {
    await t.done();
  }
});

test('a request the pages never send, or one too large, is answered in Hebrew with its status', async () => {
  const t = await setup();
  try {
    const b = t.browser();
    await b.get('/login');
    const put = await b.go('PUT', '/login');
    assert.equal(put.status, 405);
    assert.match(put.body, /<h1>משהו בבקשה הזאת לא הסתדר\. חזרו לדף הקודם ונסו שוב\.<\/h1>/);
    const big = await b.post('/login', { email: 'x'.repeat(20_000) });
    assert.equal(big.status, 413);
    assert.match(big.body, /<h1>מה ששלחתם גדול מדי, אז לא שמרנו כלום\./);
    const file = await b.upload('/login', { email: 'dana@example.com' }, { pdf: { filename: 'a.pdf', data: Buffer.from('%PDF-1.7') } });
    assert.equal(file.status, 415);
    assert.match(file.body, /משהו בבקשה הזאת לא הסתדר/);
    const host = await t.browser({ host: 'evil.example' }).get('/login');
    assert.equal(host.status, 421);
    assert.match(host.body, /<h1>הדף הזה לא קיים\.<\/h1>/);
    for (const r of [put, big, file, host]) assert.doesNotMatch(r.body, /too large|method not allowed|unsupported|unknown host/);
  } finally {
    await t.done();
  }
});

test('/setup says what is true: every subscription over, nothing to set up; a product that did not answer, no count of the payment alone', async () => {
  const t = await setup();
  try {
    cancelSubscription(t.db, t.ws.id, 'teder', { by: t.user('dana@example.com') });
    t.db.run("UPDATE subscriptions SET ends_on = ? WHERE workspace_id = ? AND product = 'teder'", addDays(israelToday(), -1), t.ws.id);
    const dana = t.as('dana@example.com');
    const ended = (await dana.get('/setup')).body;
    assert.match(ended, /<p class="lead">המנוי לתדר הסתיים, אז אין מה להגדיר\.<\/p>/);
    assert.doesNotMatch(ended, /כל הצעדים הושלמו|class="meter"/);
  } finally {
    await t.done();
  }
  const u = await setup({ answer: () => ({ raw: 'nope', status: 503 }) });
  try {
    const down = (await u.as('dana@example.com').get('/setup')).body;
    assert.match(down, /חלק מהמוצרים לא ענו לנו עכשיו/);
    assert.doesNotMatch(down, /class="meter"|מתוך 1 צעדים/);
  } finally {
    await u.done();
  }
});

test('the operator: a workspace\'s refused form is said at that workspace, not in "פתיחת חשבון"; the admin sign-in has a way back; the waitlist is titled as itself', async () => {
  const t = await setup();
  try {
    const op = signedIn(t, t.db, t.admin);
    await op.get('/admin/accounts');
    const r = await op.upload(`/admin/workspaces/${t.ws.id}/invoices`, { product: 'teder', number: '', issued_on: '2026-11-11', amount: '490', vat: '88.2' }, { pdf: { filename: 'i.pdf', data: Buffer.from('%PDF-1.7\n%%EOF\n') } });
    assert.equal(r.status, 400);
    assert.match(r.body, new RegExp(`<article class="ws" id="ws-${t.ws.id}">\\n<header>[^]*?</header>\\n<p class="error" id="ws-${t.ws.id}-err" role="alert">צריך את מספר החשבונית`));
    assert.match(r.body, new RegExp(`<p class="flash bad" role="alert"><a href="#ws-${t.ws.id}">החנות של דנה: צריך את מספר החשבונית`));
    const create = /<form method="post" action="\/admin\/workspaces" class="grid">[^]*?<\/form>/.exec(r.body)[0];
    assert.doesNotMatch(create, /class="error"/);

    const login = (await t.browser().get('/admin/login')).body;
    assert.match(login, /<p class="muted center">לא מהצוות\? <a href="\/login">לכניסה הרגילה<\/a><\/p>/);
  } finally {
    await t.done();
  }
});

test('every audit entry the code writes has a Hebrew name on the console', () => {
  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : f.endsWith('.js') && files.push(path.join(d, f))));
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const actions = new Set(['billing_soon7', 'billing_soon1', 'billing_due', 'billing_last', 'billing_stopped']);
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/action: (?:[^,]*?\? )?'([a-z_]+)'(?: : '([a-z_]+)')?/g)) [m[1], m[2]].filter(Boolean).forEach((a) => actions.add(a));
  assert.ok(actions.size > 40, `found ${actions.size}`);
  assert.deepEqual([...actions].filter((a) => !AUDIT_NAMES[a]), []);
});

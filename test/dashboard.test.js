import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { SAID, sampleOps, startToran } from './toran-fake.js';
import { now, setNow } from '../src/core/clock.js';
import { opsCustomers, opsCustomersStage } from '../src/accounts/ops.js';
import { rate, withCustomers } from '../src/web/dashboard.js';

// The operator's dashboard on /admin (Toran's docs/operator.md, section 4), against a pretend Toran: what it shows,
// who can reach it, every button forwarded to Toran with the right path and body, and Toran not answering.

const TODAY = '2026-10-24';

/** Five customers with every state the money has, and one disabled. Fictional. */
function customers(db) {
  const sub = (w, product, row) => db.insert('subscriptions', { workspace_id: w.id, product, monthly: 449, vat: 'excluded', setup: 990, started_on: '2026-08-01', updated_at: '2026-10-01T09:00:00.000Z', ...row });
  const ws = (slug, name, products) => makeWorkspace(db, slug, { name, products });
  const dana = ws('dana-shop', 'החנות של דנה', ['toran']);
  sub(dana, 'toran', { started_on: '2026-10-01', paid_until: '2026-10-27' }); // paid, renews on the 28th
  const noa = ws('noa-studio', 'סטודיו נועה', ['teder']);
  sub(noa, 'teder', { monthly: 932.2, vat: 'included', setup: 1490, started_on: '2026-10-10', paid_until: '2026-11-09' }); // 790 before VAT
  const yossi = ws('yossi-store', 'החנות של יוסי', ['toran']);
  sub(yossi, 'toran', { paid_until: '2026-10-20' }); // late since the 21st
  const gal = ws('gal-shop', 'החנות של גל', ['teder']);
  sub(gal, 'teder', { monthly: 790, setup: 1490, started_on: '2026-10-20' }); // waiting for the first payment
  const ron = ws('ron-shop', 'החנות של רון', ['toran']);
  sub(ron, 'toran', { paid_until: '2026-11-05', ends_on: '2026-11-05' }); // ending, still counted
  const off = ws('closed-shop', 'חנות סגורה', ['toran']);
  sub(off, 'toran', { started_on: '2026-10-05', paid_until: '2026-11-04' });
  db.update('workspaces', off.id, { disabled_at: '2026-10-20T09:00:00.000Z' });
  return { dana, noa, yossi, gal, ron, off };
}

async function setup({ toran = true, env = {} } = {}) {
  const h = tempHome();
  setNow(`${TODAY}T09:00:00.000Z`);
  const ws = customers(h.db);
  const fake = toran ? await startToran({ data: sampleOps(now()) }) : null;
  const site = await startSite(h.db, { env: { ...(fake ? { OF_TORAN_INTERNAL: fake.url } : {}), ...env } });
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'נתנאל' });
  const op = signedIn(site, h.db, admin);
  return { ...h, ...site, ws, fake, admin, op, done: async () => (await site.close(), await fake?.close(), h.cleanup()) };
}

test('the superadmin gets the whole dashboard: who to write to with the message, the conversations, the funnels and the money', async () => {
  const t = await setup();
  try {
    const r = await t.op.get('/admin');
    assert.equal(r.status, 200);
    const b = r.body;
    // Our own script files only: admin.js here, and load.js (the loading state) on every page. Nothing inline.
    assert.match(r.headers['content-security-policy'], /script-src 'self';/);
    assert.match(b, /<script src="\/static\/admin\.js\?v=[^"]+" defer><\/script>/);
    assert.match(b, /<script src="\/static\/load\.js\?v=[^"]+" defer><\/script>/);
    const other = await t.op.get('/admin/accounts');
    assert.match(other.headers['content-security-policy'], /script-src 'self';/);
    assert.doesNotMatch(other.headers['content-security-policy'], /unsafe-inline|unsafe-eval|nonce-/);
    assert.doesNotMatch(other.body, /admin\.js/);
    assert.equal(t.fake.calls[0].auth, 'Bearer internal-token-for-tests-only-0123456789');
    assert.equal(t.fake.calls[0].path, '/internal/ops');

    // The tabs, our number, and the numbers at the top.
    assert.match(b, /<a href="\/admin" aria-current="page">היום<\/a><a href="\/admin\/accounts">חשבונות<\/a>/);
    assert.match(b, /<p class="number-line ok" role="note">המספר שלנו מחובר דרך Meta\. <bdi class="ltr">\+972500000999<\/bdi><\/p>\s*<div class="kpis top-kpis">/);
    assert.match(b, /<a class="kpi lead" href="#contact"><span class="l">לפנות היום<\/span><span class="v">4<\/span><span class="s">ההודעה מוכנה בכל כרטיס/);
    assert.match(b, /בשיחה<\/span><span class="cnt sig">2<\/span>/);
    assert.match(b, /הכנסה חודשית<\/span><span class="cnt ok">1,688 ₪<\/span>/);
    assert.match(b, /באיחור<\/span><span class="cnt bad">1<\/span>/);
    assert.match(b, /ענו ב-30 יום<\/span><span class="cnt ok">3<\/span>/);

    // A card: the message in a textarea, copy and open (a link to the chat that also copies), sent, and the rest.
    assert.match(b, /<textarea id="msg-toran-12" rows="6" dir="rtl" aria-label="ההודעה">היי, ראינו שניסיתם את הדמו של תורן לנעלי הגליל\. איך היה\?<\/textarea>/);
    // The link has the message written in it, so it opens the chat with it without script too.
    const tried = encodeURIComponent('היי, ראינו שניסיתם את הדמו של תורן לנעלי הגליל. איך היה?');
    assert.ok(b.includes(`<a class="button primary" href="https://wa.me/972500000201?text=${tried}" target="_blank" rel="noopener" data-copy="#msg-toran-12" data-done="ההודעה הועתקה"`));
    assert.match(b, /data-copy="#msg-toran-12"[^>]*>להעתיק ולפתוח וואטסאפ<\/a>/);
    assert.match(b, /action="\/admin\/ops\/toran\/12\/reminded" class="inline" data-ajax="remove">[^]*?<button>שלחתי<\/button>/);
    assert.match(b, /action="\/admin\/ops\/toran\/12\/replied"[^]*?<button class="quiet">ענו לי<\/button>/);
    assert.match(b, /action="\/admin\/ops\/toran\/12\/later"[^]*?name="days" value="1"><button class="quiet">מחר<\/button>/);
    assert.match(b, /action="\/admin\/ops\/toran\/12\/later"[^]*?name="days" value="7"><button class="quiet">בעוד שבוע<\/button>/);
    assert.match(b, /<details class="lost"><summary>לא מעוניינים<\/summary><form method="post" action="\/admin\/ops\/toran\/12\/lost"[^]*?<option value="price">יקר להם<\/option>[^]*?<option value="other">אחר<\/option>/);
    assert.match(b, /<a href="https:\/\/toran\.openfrequency\.co\.il\/lead\/12" target="_blank" rel="noopener">נעלי הגליל<\/a>/);
    assert.match(b, /ניסו את הדמו · לפני 3 שעות · <bdi class="ltr">galil-shoes\.example<\/bdi>/);
    // Asked on the website, inside its hours: sending from the demo number is the primary button, copy is the second.
    assert.match(b, /action="\/admin\/ops\/toran\/15\/direct"[^]*?<button class="primary">לשלוח עכשיו מהמספר של הדמו<\/button>[^]*?<a class="button" href="https:\/\/wa\.me\/972500000203\?text=%D7%94%D7%93%D7%9E%D7%95/);
    assert.match(b, /href="mailto:hello@emek-ceramics\.example\?subject=[^"&]+&amp;body=%D7%94%D7%99%D7%99[^"]*"[^>]*>להעתיק ולפתוח מייל<\/a>/);
    // A next step that is due: open the chat, the next step's form, not interested. No message, no "sent".
    const contact = b.slice(b.indexOf('<section id="contact">'), b.indexOf('<section id="talking">'));
    const next = contact.split('<article class="op" data-item>').find((x) => x.includes('סטודיו כרמל'));
    assert.match(next, /<a class="button" href="https:\/\/wa\.me\/972500000202" target="_blank" rel="noopener">לפתוח שיחה<\/a>/);
    assert.match(next, /action="\/admin\/ops\/teder\/7\/next" class="next-form" data-ajax="reload">[^]*?placeholder="הצעד הבא, למשל: לשלוח הצעת מחיר"[^]*?<option value="14">בעוד שבועיים<\/option>/);
    assert.doesNotMatch(next, /שלחתי|<textarea/);

    // No contact, and the requests with nothing to send.
    assert.match(b, /<summary>דף אחד מוכן, ואין לנו איך לפנות לחנות<\/summary>[^]*?href="https:\/\/toran\.openfrequency\.co\.il\/lead\/31"[^]*?צמחים בבית[^]*?ציון 64/);
    assert.match(b, /<h2>ביקשו דמו באתר, ועוד אין מה לשלוח<\/h2>[^]*?wix-store\.example[^]*?האתר על Wix, ותורן בונה דמו רק לחנויות Shopify · ביקשו לפני 6 שעות · <bdi class="ltr">\+972500000204<\/bdi>/);
    // Each with Toran's message for its reason, to copy and send to the number that asked; no "sent", it is no lead.
    const stuck = b.slice(b.indexOf('<section id="stuck">'), b.indexOf('<section id="talking">'));
    assert.match(stuck, /<textarea id="stuck-0" rows="4" dir="rtl" aria-label="ההודעה">היי, כאן OpenFrequency\. ביקשתם באתר דמו של תורן ל־wix-store\. תורן בונה דמו רק לחנויות Shopify, והחנות על Wix, אז לא יכולנו לבנות אותו\. אם יש שאלה, אפשר לענות כאן\.<\/textarea>/);
    assert.match(stuck, /<a class="button primary" href="https:\/\/wa\.me\/972500000204\?text=%D7%94%D7%99%D7%99[^"]*" target="_blank" rel="noopener" data-copy="#stuck-0" data-done="ההודעה הועתקה"[^>]*>להעתיק ולפתוח וואטסאפ<\/a>/);
    assert.match(stuck, /<a href="https:\/\/toran\.openfrequency\.co\.il\/lead\/40" target="_blank" rel="noopener"><bdi class="ltr">wix-store\.example<\/bdi><\/a> <span class="tag p-toran">תורן<\/span>/);
    assert.doesNotMatch(stuck, /<form|שלחתי/);

    // In a conversation: Toran's pilot (already a pilot: only "paying"), Teder's customer, the next step's form.
    const talking = b.slice(b.indexOf('<section id="talking">'), b.indexOf('<section id="funnel">'));
    assert.match(talking, /מאפיית השכונה[^]*?<span class="tag">בפיילוט<\/span>[^]*?ענו לפני 2 ימים · הצעד הבא: לקבוע שיחה, 25 באוק׳ ב-07:00<\/small>/);
    assert.match(talking, /action="\/admin\/ops\/toran\/9\/next"[^]*?value="לקבוע שיחה"/);
    assert.match(talking, /action="\/admin\/ops\/toran\/9\/paid"[^]*?name="back" value="talking"[^]*?משלמים/);
    assert.doesNotMatch(talking, /\/toran\/9\/pilot/);
    assert.match(talking, /action="\/admin\/ops\/teder\/7\/won"[^]*?<button>לקוח<\/button>/);
    assert.match(talking, /<b>הצעד הבא: לשלוח הצעת מחיר, 24 באוק׳ ב-10:00<\/b>/, 'a next step that is due is in bold');

    // The funnels, with the rate from the stage before; the customers come from our subscriptions.
    assert.match(b, /<th scope="row">מתאימות<\/th><td><b>20<\/b> <small class="pct">50%<\/small><\/td><td><b>6<\/b> <small class="pct">50%<\/small><\/td>/);
    assert.match(b, /<th scope="row">נמצאו<\/th><td><b>40<\/b><\/td>/);
    assert.match(b, /<th scope="row">לקוחות<\/th><td><b>2<\/b> <small class="pct">67%<\/small><\/td><td><b>1<\/b> <small class="pct">50%<\/small><\/td>/);
    assert.match(b, /<th scope="row">לקוחות<\/th><td><b>1<\/b> <small class="pct">50%<\/small><\/td><td><b>1<\/b> <small class="pct">100%<\/small><\/td>/);

    // The money, each name a link to its workspace on the accounts tab.
    const money = b.slice(b.indexOf('<section id="money">'));
    assert.match(money, /הכנסה חודשית, לפני מע״מ<\/span><span class="v">1,688 ₪<\/span>/);
    assert.match(money, /לקוחות משלמים<\/span><span class="v">3<\/span><span class="s">תורן 2 · תדר 1<\/span>/);
    assert.match(money, new RegExp(`<a href="/admin/accounts#ws-${t.ws.yossi.id}">החנות של יוסי</a> · תורן · 449 ₪ לחודש · מ-21\\.10\\.2026`));
    assert.match(money, new RegExp(`<a href="/admin/accounts#ws-${t.ws.gal.id}">החנות של גל</a> · תדר · 790 ₪ לחודש, ודמי הקמה 1,490 ₪`));
    assert.match(money, new RegExp(`28\\.10\\.2026 · <a href="/admin/accounts#ws-${t.ws.dana.id}">החנות של דנה</a> · תורן · 449 ₪`));
    assert.doesNotMatch(money, /חנות סגורה/);
    assert.match((await t.op.get('/admin/accounts')).body, new RegExp(`<article class="ws" id="ws-${t.ws.yossi.id}">`));
  } finally {
    await t.done();
  }
});

test('a customer and a signed-out browser never reach the dashboard or its buttons, and nothing reaches Toran', async () => {
  const t = await setup();
  try {
    const dana = makeUser(t.db, 'dana@example.com');
    t.db.insert('memberships', { user_id: dana.id, workspace_id: t.ws.dana.id, role: 'client_owner', created_at: '2026-10-01T09:00:00.000Z' });
    for (const [b, home] of [[signedIn(t, t.db, dana), '/'], [t.browser(), '/login']]) {
      assert.equal((await b.get('/admin')).headers.location, '/admin/login');
      assert.equal((await b.get(home)).status, 200);
      assert.ok(b.csrf);
      const r = await b.post('/admin/ops/toran/12/sent', { back: 'contact' });
      assert.equal(r.status, 403);
      assert.doesNotMatch(r.body, /סומן/);
    }
    // The customer's home page asks Toran for its setup checklist (/internal/setup); nothing of the dashboard's.
    assert.equal(t.fake.calls.filter((c) => !c.path.startsWith('/internal/setup?')).length, 0);
  } finally {
    await t.done();
  }
});

test('every button goes to Toran as its action, with only what it takes, and the page comes back with Toran\'s line', async () => {
  const t = await setup();
  try {
    await t.op.get('/admin');
    const by = 'נתנאל';
    const cases = [
      ['/admin/ops/toran/12/sent', {}, '/internal/ops/toran/12/sent', { by }],
      ['/admin/ops/toran/12/reminded', {}, '/internal/ops/toran/12/reminded', { by }],
      ['/admin/ops/toran/15/direct', {}, '/internal/ops/toran/15/direct', { by }],
      ['/admin/ops/teder/7/replied', {}, '/internal/ops/teder/7/replied', { by }],
      ['/admin/ops/teder/7/next', { text: '  לשלוח הצעת מחיר  ', days: '3', back: 'talking' }, '/internal/ops/teder/7/next', { by, text: 'לשלוח הצעת מחיר', days: 3 }],
      ['/admin/ops/toran/12/later', { days: '1' }, '/internal/ops/toran/12/later', { by, days: 1 }],
      ['/admin/ops/toran/12/later', { days: '7' }, '/internal/ops/toran/12/later', { by, days: 7 }],
      ['/admin/ops/toran/21/lost', { reason: 'has_solution' }, '/internal/ops/toran/21/lost', { by, reason: 'has_solution' }],
      ['/admin/ops/toran/21/reopen', {}, '/internal/ops/toran/21/reopen', { by }],
      ['/admin/ops/toran/9/pilot', { back: 'talking' }, '/internal/ops/toran/9/pilot', { by }],
      ['/admin/ops/toran/9/paid', { back: 'talking' }, '/internal/ops/toran/9/paid', { by }],
      ['/admin/ops/teder/7/won', { back: 'talking' }, '/internal/ops/teder/7/won', { by }],
    ];
    for (const [path, fields, toPath, body] of cases) {
      const before = t.fake.posts().length;
      const r = await t.op.post(path, { back: 'contact', ...fields });
      assert.equal(r.status, 303, path);
      assert.equal(r.headers.location, `/admin#${fields.back || 'contact'}`);
      const sent = t.fake.posts();
      assert.equal(sent.length, before + 1, path);
      assert.equal(sent.at(-1).path, toPath);
      assert.deepEqual(sent.at(-1).body, body);
      assert.equal(sent.at(-1).auth, 'Bearer internal-token-for-tests-only-0123456789');
      const page = await t.op.get('/admin');
      const action = toPath.split('/').at(-1);
      assert.ok(page.body.includes(`<p class="flash" role="status">${SAID[action].replace(/"/g, '&quot;')}</p>`), `${path}: the flash`);
    }
    // The page's script asks for JSON instead of the redirect.
    const r = await t.op.post('/admin/ops/toran/12/sent', {}, { 'x-of-ajax': '1' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true, message: SAID.sent });
    // The superadmin's name, else the email, is who did it, for Toran's audit and ours.
    t.db.run("UPDATE users SET name = '' WHERE id = ?", t.admin.id);
    await t.op.post('/admin/ops/toran/12/sent', {});
    assert.deepEqual(t.fake.posts().at(-1).body, { by: 'admin@example.com' });
    assert.ok(t.db.get("SELECT count(*) AS n FROM audit WHERE action = 'ops_action'").n >= cases.length);
  } finally {
    await t.done();
  }
});

test('what Toran refuses comes back as an error line, and what cannot be right never leaves accounts', async () => {
  const t = await setup();
  try {
    t.fake.state.answers.reminded = { status: 400, body: { ok: false, error: 'כבר נשלחה להם תזכורת. אחריה לא כותבים, אלא אם יכתבו.' } };
    t.fake.state.answers.direct = { status: 500, body: { error: 'server_error' } };
    await t.op.get('/admin');
    await t.op.post('/admin/ops/toran/12/reminded', { back: 'contact' });
    assert.match((await t.op.get('/admin')).body, /<p class="flash bad" role="alert">כבר נשלחה להם תזכורת\. אחריה לא כותבים, אלא אם יכתבו\.<\/p>/);
    const ajax = await t.op.post('/admin/ops/toran/12/reminded', {}, { 'x-of-ajax': '1' });
    assert.equal(ajax.status, 400);
    assert.deepEqual(JSON.parse(ajax.body), { ok: false, message: 'כבר נשלחה להם תזכורת. אחריה לא כותבים, אלא אם יכתבו.' });
    await t.op.post('/admin/ops/toran/15/direct', {});
    assert.match((await t.op.get('/admin')).body, /<p class="flash bad" role="alert">תורן החזיר שגיאה \(500\), אז שום דבר לא נרשם\.<\/p>/);

    const calls = t.fake.posts().length;
    const refused = [
      ['/admin/ops/teder/7/direct', {}, 'אפשר לשלוח מהמספר של הדמו רק את תורן'],
      ['/admin/ops/teder/7/paid', {}, 'פיילוט ותשלום נרשמים כאן רק לתורן'],
      ['/admin/ops/toran/9/won', {}, 'לקוח נרשם כאן רק לתדר'],
      ['/admin/ops/toran/12/lost', { reason: 'rude' }, 'צריך לבחור למה'],
      ['/admin/ops/toran/12/delete', {}, 'אין פעולה כזו'],
      ['/admin/ops/toran/12%2F..%2Fx/sent', {}, 'אין פעולה כזו'],
    ];
    for (const [path, fields, line] of refused) {
      const r = await t.op.post(path, fields, { 'x-of-ajax': '1' });
      assert.deepEqual([r.status, JSON.parse(r.body)], [400, { ok: false, message: line }], path);
    }
    assert.equal(t.fake.posts().length, calls);
    // Without the CSRF token, nothing at all.
    const stale = await t.op.go('POST', '/admin/ops/toran/12/sent', null, { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://accounts.openfrequency.co.il' });
    assert.equal(stale.status, 403);
    assert.equal(t.fake.posts().length, calls);
  } finally {
    await t.done();
  }
});

test('in view-as the dashboard is closed and its buttons do nothing', async () => {
  const t = await setup();
  try {
    await t.op.get('/admin/accounts');
    await t.op.post(`/admin/workspaces/${t.ws.dana.id}/view-as`, { product: 'toran' });
    const page = await t.op.get('/admin');
    assert.match(page.body, /אתם צופים ב-החנות של דנה/);
    assert.match(page.body, /בזמן צפייה כלקוח הלוח סגור\. מסיימים את הצפייה וחוזרים אליו\./);
    assert.doesNotMatch(page.body, /לפנות היום|<textarea/);
    const r = await t.op.post('/admin/ops/toran/12/sent', {}, { 'x-of-ajax': '1' });
    assert.deepEqual(JSON.parse(r.body), { ok: false, message: 'בזמן צפייה כלקוח הלוח סגור. מסיימים את הצפייה וחוזרים אליו.' });
    assert.equal(t.fake.calls.length, 0);
  } finally {
    await t.done();
  }
});

test('Toran not answering leaves its sections saying so; the money and the console work as usual', async () => {
  const t = await setup();
  try {
    t.fake.state.down = true;
    const r = await t.op.get('/admin');
    assert.equal(r.status, 200);
    const b = r.body;
    assert.equal((b.match(/<b>תורן לא ענה עכשיו<\/b>/g) || []).length, 3, 'who to write to, the conversations, the funnels');
    assert.ok(b.includes(`החלק הזה מגיע מתורן, מ-GET /internal/ops ב-${t.fake.url}. שאר הדף עובד בלעדיו.`));
    assert.match(b, /לפנות היום<\/span><span class="v">\?<\/span>/);
    assert.match(b, /בשיחה<\/span><span class="cnt">\?<\/span>/);
    assert.match(b, /הכנסה חודשית, לפני מע״מ<\/span><span class="v">1,688 ₪<\/span>/);
    // A button pressed while it is down: nothing recorded, and it says so.
    await t.op.post('/admin/ops/toran/12/sent', {});
    assert.match((await t.op.get('/admin')).body, /<p class="flash bad" role="alert">תורן החזיר שגיאה \(503\), אז שום דבר לא נרשם\.<\/p>/);
    await t.fake.close();
    assert.match((await t.op.get('/admin')).body, /<b>תורן לא ענה עכשיו<\/b>/);
    await t.op.post('/admin/ops/toran/12/sent', {});
    assert.match((await t.op.get('/admin')).body, /<p class="flash bad" role="alert">תורן לא ענה, אז שום דבר לא נרשם\. כדאי לנסות שוב בעוד רגע\.<\/p>/);

    // The console, on its tab.
    const c = await t.op.get('/admin/accounts');
    assert.equal(c.status, 200);
    assert.match(c.body, /<a href="\/admin">היום<\/a><a href="\/admin\/accounts" aria-current="page">חשבונות<\/a>/);
    assert.match(c.body, /החנות של דנה/);
    const made = await t.op.post('/admin/workspaces', { name: 'סטודיו חדש', slug: 'new-studio', owner: 'new@example.com', products: ['teder'] });
    assert.equal(made.headers.location, '/admin/accounts');
    assert.match((await t.op.get('/admin/accounts')).body, /פתחנו את סטודיו חדש ושלחנו הזמנה ל-new@example\.com\./);
  } finally {
    t.fake.close().catch(() => {});
    await t.done().catch(() => {});
  }
});

test('with OF_INTERNAL_TOKEN unset, /admin does not call Toran and says why', async () => {
  const t = await setup({ env: { OF_INTERNAL_TOKEN: '' } });
  try {
    const b = (await t.op.get('/admin')).body;
    assert.match(b, /OF_INTERNAL_TOKEN לא מוגדר כאן, או שהוא קצר מ-32 תווים, אז לא פנינו לתורן\./);
    assert.equal(t.fake.calls.length, 0);
  } finally {
    await t.done();
  }
});

test('a request with nothing to say (a Teder demo taken down), or from a Toran before the messages, opens the chat alone', async () => {
  const t = await setup();
  try {
    const at = new Date(now() - 3_600_000).toISOString();
    t.fake.state.data = {
      ...sampleOps(now()),
      stuck: [
        { product: 'teder', domain: 'gone.example', phone: '972500000211', at, why: 'הדמו של תדר הוסר', storeId: null, message: null, target: { kind: 'whatsapp', href: 'https://wa.me/972500000211', label: 'להעתיק ולפתוח וואטסאפ' }, leadUrl: null },
        { domain: 'old.example', phone: '972500000212', at, why: 'הדף לא נבנה', storeId: 41, leadUrl: null },
      ],
    };
    const b = (await t.op.get('/admin')).body;
    const stuck = b.slice(b.indexOf('<section id="stuck">'), b.indexOf('<section id="talking">'));
    assert.equal((stuck.match(/<article class="op" data-item>/g) || []).length, 2);
    assert.match(stuck, /<span class="tag p-teder">תדר<\/span><\/h3><small>הדמו של תדר הוסר · ביקשו לפני שעה[^]*?<a class="button" href="https:\/\/wa\.me\/972500000211" target="_blank" rel="noopener">לפתוח שיחה<\/a>/);
    assert.match(stuck, /<bdi class="ltr">old\.example<\/bdi><\/h3><small>הדף לא נבנה[^]*?<a class="button" href="https:\/\/wa\.me\/972500000212" target="_blank" rel="noopener">לפתוח שיחה<\/a>/);
    assert.doesNotMatch(stuck, /<textarea/);
  } finally {
    await t.done();
  }
});

test('our number at the top: connected and through what, not connected yet (sending from it and the automatic links wait), the simulator, or nothing from a Toran that does not say', async () => {
  const t = await setup();
  try {
    const line = async (demoLine) => {
      t.fake.state.data = { ...sampleOps(now()), demoLine };
      return /<p class="number-line[^"]*" role="note">[^]*?<\/p>/.exec((await t.op.get('/admin')).body)?.[0] || null;
    };
    assert.equal(await line({ live: false, via: 'sim', number: '972500000999' }), '<p class="number-line off" role="note">המספר שלנו עוד לא מחובר, אז שליחה ממנו והלינקים לדמואים שיוצאים לבד מחכים עד שיתחבר.</p>');
    assert.equal(await line({ live: true, via: 'twilio', number: null }), '<p class="number-line ok" role="note">המספר שלנו מחובר דרך Twilio.</p>');
    assert.equal(await line({ live: true, via: 'sim', number: null }), '<p class="number-line" role="note">הדמו כאן על הסימולטור: מה שנשלח ממנו לא יוצא לאף אחד.</p>');
    assert.equal(await line({ live: true, via: 'pigeon', number: '<b>1</b>' }), '<p class="number-line ok" role="note">המספר שלנו מחובר. <bdi class="ltr">+1</bdi></p>', 'what is not known is left out');
    assert.equal(await line(undefined), null, 'a Toran from before says nothing: no line');
    t.fake.state.down = true;
    assert.equal(await line({ live: false, via: 'sim', number: null }), null, 'Toran not answering: its own card says so');
  } finally {
    await t.done();
  }
});

test("Teder's demos not read this time: the dashboard says its copies are from the last read", async () => {
  const t = await setup();
  try {
    t.fake.state.data = { ...sampleOps(now()), teder: { ok: false } };
    assert.match((await t.op.get('/admin')).body, /את המצגות של תדר תורן לא הצליח לקרוא עכשיו \(GET \/internal\/demos\)/);
    t.fake.state.data = { ...sampleOps(now()), items: [], conversations: [], noContact: [], stuck: [] };
    const empty = (await t.op.get('/admin')).body;
    assert.match(empty, /<b>אין כרגע למי לכתוב<\/b><p>כאן יופיעו דפים מוכנים, תזכורות שהגיע זמנן, ומי שביקשו דמו באתר\.<\/p>/);
    assert.match(empty, /<b>אף אחד עוד לא בשיחה<\/b><p>מי שעונים לכם עוברים לכאן כשמסמנים &quot;ענו לי&quot;\.<\/p>/);
    assert.match(empty, /<span class="s">אין למי לכתוב עכשיו<\/span>/);
    assert.doesNotMatch(empty, /id="stuck"|no-contact/);
  } finally {
    await t.done();
  }
});

test("the funnels' customers stage is ours: paid or ending subscriptions, and those started in the last 30 days", () => {
  const h = tempHome();
  try {
    setNow(`${TODAY}T09:00:00.000Z`);
    customers(h.db);
    const c = opsCustomers(h.db, TODAY);
    assert.deepEqual(opsCustomersStage(c.workspaces, 'toran', TODAY), { all: 2, month: 1 });
    assert.deepEqual(opsCustomersStage(c.workspaces, 'teder', TODAY), { all: 1, month: 1 });
    const stages = withCustomers(sampleOps().funnels.toran, 'toran', c);
    assert.deepEqual(stages.at(-1), { key: 'customers', label: 'לקוחות', all: 2, month: 1 });
    assert.equal(rate(stages, stages.length - 1, 'all'), 67);
    assert.equal(rate(stages, 0, 'all'), null);
    assert.equal(rate([{ all: 0 }, { all: 3 }], 1, 'all'), null, 'no rate from an empty stage');
  } finally {
    h.cleanup();
  }
});

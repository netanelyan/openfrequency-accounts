import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { TERMS_VERSION } from '../src/accounts/signup.js';
import { foundersState } from '../src/accounts/founders.js';
import { setProduct } from '../src/accounts/workspaces.js';

// A product added to an account that has the other (the owner, 2026-11-11, before the launch: "correct everything that
// is incomplete"): an owner of a Teder workspace adds Toran from "עוד מאיתנו", or from /signup while signed in, in the
// same workspace: its plan, its terms ticked as at sign-up, the list price unpaid (the founders' offer by the sign-up's
// rule), the email about it with how to pay, and the operator told, as on a sign-up. Only while sign-up sells it.

const PAY_HOW = 'העברה בנקאית, בנק 12 סניף 345 חשבון 678910, על שם OpenFrequency';
const LINE = '972500000100';
const SUPPORT = '972500000000';

async function setup(env = {}, { paid = true } = {}) {
  const h = tempHome();
  setNow('2026-11-11T10:00:00.000Z');
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true });
  const ws = makeWorkspace(h.db, 'dana-shop', { name: 'החנות של דנה', products: ['teder'], members: { 'dana@example.com': 'client_owner', 'noa@example.com': 'client_member' }, terms: '2026-10-01' });
  ensureSubscription(h.db, ws.id, 'teder', undefined, 'small');
  if (paid) payMonth(h.db, ws.id, 'teder', { by: admin });
  const site = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder,toran', OF_SIGNUP_NOTIFY: 'boss@example.com', OF_PAYMENT_METHOD: PAY_HOW, OF_ASSISTANT_WA: LINE, OF_SUPPORT_WA: SUPPORT, ...env } });
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  const as = (email) => signedIn(site, h.db, user(email));
  return { ...h, ...site, ws, admin, user, as, done: async () => (await site.close(), h.cleanup()) };
}

const toranOf = (db, ws) => db.get("SELECT plan, monthly, setup, vat, paid_until FROM subscriptions WHERE workspace_id = ? AND product = 'toran'", ws.id);
const toranOn = (db, ws) => Boolean(db.get("SELECT enabled FROM workspace_products WHERE workspace_id = ? AND product = 'toran'", ws.id)?.enabled);

test('an owner of Teder adds Toran from "עוד מאיתנו": its plan, its terms, the list price unpaid, the email with how to pay, the operator told, and /setup', async () => {
  const t = await setup();
  try {
    const dana = t.as('dana@example.com');
    const home = (await dana.get('/')).body;
    // The card leads to adding it here, not to the website and back to /signup.
    assert.match(home, /<li><a href="\/subscription\/toran\/add"><span class="mark toran"[^]*?<b>תורן<\/b>[^]*?<span class="go">להוסיף לחשבון<\/span><\/a><\/li>/);

    const page = await dana.get('/subscription/toran/add');
    assert.equal(page.status, 200);
    assert.match(page.body, /<h1>להוסיף את תורן לחשבון של החנות של דנה\?<\/h1>/);
    assert.match(page.body, /עונה ללקוחות שלכם בוואטסאפ\. הוא נוסף לחשבון הזה, עם אותה כניסה ואותם אנשים\./);
    assert.match(page.body, /<input type="radio" name="plan_toran" value="store" checked>[^]*?590 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת/);
    assert.match(page.body, /<input type="radio" name="plan_toran" value="big">[^]*?1,190 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת/);
    // The box names Toran's contract and the terms, not Teder's; one blue button.
    assert.match(page.body, /<span class="c-toran"><a href="https:\/\/openfrequency\.co\.il\/toran\/contract"/);
    assert.doesNotMatch(page.body, /teder\/contract/);
    assert.equal(page.body.match(/class="primary"|class="button primary"/g).length, 1);
    assert.match(page.body, /<button class="primary">להוסיף את תורן<\/button>/);
    assert.match(page.body, /href="https:\/\/openfrequency\.co\.il\/toran">לפרטים על תורן באתר</);

    // Without the box ticked: refused by the box, nothing added.
    const noTerms = await dana.post('/subscription/toran/add', { plan_toran: 'big' });
    assert.equal(noTerms.status, 400);
    assert.match(noTerms.body, /<p class="error" id="add-err" role="alert">כדי להוסיף מוצר צריך להסכים להסכם שלו, לתנאי השימוש ולמדיניות הפרטיות\.<\/p>/);
    assert.match(noTerms.body, /value="big" checked/, 'the plan chosen is kept');
    assert.equal(toranOn(t.db, t.ws), false);
    // A plan Toran does not have: Toran's own words.
    assert.match((await dana.post('/subscription/toran/add', { plan_toran: 'full', terms: '1' })).body, /צריך לבחור אחת מהחבילות של תורן\./);
    assert.equal(toranOn(t.db, t.ws), false);

    const r = await dana.post('/subscription/toran/add', { plan_toran: 'big', terms: '1' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/setup');
    assert.equal(toranOn(t.db, t.ws), true);
    assert.deepEqual({ ...toranOf(t.db, t.ws) }, { plan: 'big', monthly: 1190, setup: 990, vat: 'excluded', paid_until: null }, 'the list price of its plan, nothing paid');
    // Today's terms, accepted with the box, on the person and on the workspace, as a sign-up keeps them.
    assert.equal(t.user('dana@example.com').terms_version, TERMS_VERSION);
    assert.equal(t.db.get('SELECT terms_version FROM workspaces WHERE id = ?', t.ws.id).terms_version, TERMS_VERSION);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'product_added' AND workspace_id = ? AND actor = 'dana@example.com'", t.ws.id));

    // /setup says so, with the payment first.
    const setup = (await dana.get('/setup')).body;
    assert.match(setup, /<p class="flash" role="status">תורן נוסף לחשבון\. שלחנו לכם מייל עם כל הפרטים\.<\/p>/);
    assert.match(setup, /<p class="pay-amount"><b>2,572\.40 ₪<\/b>/, 'Toran\'s first month and setup fee with VAT; Teder is paid');

    // The email about it: what is to pay now (Toran's month and setup fee), the WhatsApp button as its one action, and
    // under it the details for a transfer without WhatsApp; the setup page a plain link.
    const mail = t.mails.find((m) => m.to === 'dana@example.com' && m.subject === 'תורן נוסף לחשבון של החנות של דנה');
    assert.ok(mail, 'the email about the product added');
    assert.match(mail.text, /תורן נוסף לחשבון של החנות של דנה ב-OpenFrequency\. נשארו שני דברים\./);
    assert.match(mail.text, /תורן, חנות גדולה: 1,190 ₪ לחודש ועוד מע״מ, ודמי הקמה של 990 ₪ פעם אחת\.\n/);
    assert.match(mail.text, /סך הכול לתשלום עכשיו: 2,572\.40 ₪, כולל מע״מ \(2,180 ₪ ועוד 392\.40 ₪ מע״מ\)\./);
    assert.match(mail.text, /אחר כך 1,404\.20 ₪ לחודש, כולל מע״מ\./);
    assert.doesNotMatch(mail.text, /תדר/, 'Teder is paid: nothing about it');
    assert.match(mail.html, new RegExp(`href="https://wa\\.me/${LINE}\\?text=`));
    assert.ok(mail.text.includes(`אפשר גם להעביר בלי וואטסאפ. איך משלמים: ${PAY_HOW}`));
    assert.match(mail.text, /אחרי ההעברה, שלחו לנו את האסמכתא בתשובה למייל הזה\./);
    assert.equal(mail.html.match(/bgcolor="#0071e3"/g).length, 1, 'one button');
    assert.match(mail.html, /<a class="of-link" href="https:\/\/accounts\.openfrequency\.co\.il\/setup"[^>]*>לדף ההגדרה<\/a>/);
    assert.doesNotMatch(mail.text, /אין סיסמה לזכור/, 'they have been signing in for a while');

    // The operator, as on a sign-up.
    const notice = t.mails.find((m) => m.to === 'boss@example.com');
    assert.equal(notice.subject, 'מוצר נוסף: החנות של דנה, תורן');
    assert.match(notice.text, /לקוח קיים הוסיף מוצר לחשבון שלו, מהדף הראשי\./);
    assert.match(notice.text, /נוסף: תורן\n/);
    assert.match(notice.text, /תורן, חנות גדולה: 1,190 ₪ לחודש \+ 990 ₪ דמי הקמה, לא כולל מע״מ/);
    assert.match(notice.text, /פרטי התשלום כבר אצל dana@example\.com, במייל על ההוספה, לצד הכפתור "לתשלום אוטומטי בוואטסאפ"\./);
    assert.match(notice.text, /admin\/accounts#ws-/);

    // Home: Toran is the account's now, and is not offered again; the page again says nothing is left to add.
    const after = (await dana.get('/')).body;
    assert.doesNotMatch(after, /עוד מאיתנו/);
    assert.match(after, /<h3>תורן<\/h3>/);
    // Sent twice (a double click): nothing more, home.
    const again = await dana.post('/subscription/toran/add', { plan_toran: 'store', terms: '1' });
    assert.equal(again.headers.location, '/');
    assert.equal(toranOf(t.db, t.ws).plan, 'big');
    assert.equal(t.mails.filter((m) => m.subject === 'תורן נוסף לחשבון של החנות של דנה').length, 1);
  } finally {
    await t.done();
  }
});

test('/signup while signed in leads an owner to adding the product their account lacks, with the plan asked for; a member and an account that has it are told so', async () => {
  const t = await setup();
  try {
    const dana = t.as('dana@example.com');
    let r = await dana.get('/signup?p=toran&plan=big');
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/subscription/toran/add?plan=big');
    assert.match((await dana.get(r.headers.location)).body, /<input type="radio" name="plan_toran" value="big" checked>/);
    // No ?p=: the only product there is to add.
    assert.equal((await dana.get('/signup')).headers.location, '/subscription/toran/add');
    // What the account has already: said, not a dead end about signing out.
    r = await dana.get('/signup?p=teder');
    assert.equal(r.status, 200);
    assert.match(r.body, /<h1>תדר כבר פועל בחשבון של החנות של דנה<\/h1>/);
    // A member: only owners add it.
    const noa = t.as('noa@example.com');
    r = await noa.get('/signup?p=toran');
    assert.equal(r.status, 200);
    assert.match(r.body, /את תורן מוסיפים לחשבון בעלי החשבון, מהדף הראשי שלהם\./);
    const page = await noa.get('/subscription/toran/add');
    assert.equal(page.status, 403);
    assert.match(page.body, /רק בעלי החשבון יכולים להוסיף את תורן/);
    await noa.get('/logout');
    const forged = await noa.post('/subscription/toran/add', { plan_toran: 'store', terms: '1' });
    assert.equal(forged.status, 403);
    assert.match(forged.body, /רק בעלי החשבון יכולים להוסיף את תורן/, 'refused as a member, not as a stale form');
    assert.equal(toranOn(t.db, t.ws), false);
    // A member's home shows the product's page on the website, not the way to add it.
    assert.match((await noa.get('/')).body, /<li><a href="https:\/\/openfrequency\.co\.il\/toran">/);
    // Signed out: to the sign-in, and back here after it.
    const anon = t.browser();
    assert.equal((await anon.get('/subscription/toran/add')).headers.location, `/login?next=${encodeURIComponent('/subscription/toran/add')}`);
    // The operator adds nothing here.
    const admin = signedIn(t, t.db, t.admin);
    assert.equal((await admin.get('/subscription/toran/add')).status, 403);
  } finally {
    await t.done();
  }
});

test('a product sign-up does not sell cannot be added (OF_SIGNUP_PRODUCTS), nor any while sign-up is closed', async () => {
  for (const env of [{ OF_SIGNUP_PRODUCTS: 'teder' }, { OF_SIGNUP: '0' }]) {
    const t = await setup(env);
    try {
      const dana = t.as('dana@example.com');
      const home = (await dana.get('/')).body;
      assert.doesNotMatch(home, /\/subscription\/toran\/add/, JSON.stringify(env));
      const page = await dana.get('/subscription/toran/add');
      assert.equal(page.status, 403);
      assert.match(page.body, /ההרשמה לתורן עוד לא נפתחה/);
      const forged = await dana.post('/subscription/toran/add', { plan_toran: 'store', terms: '1' });
      assert.equal(forged.status, 403);
      assert.match(forged.body, /ההרשמה לתורן עוד לא נפתחה/);
      assert.equal(toranOn(t.db, t.ws), false);
      assert.equal(toranOf(t.db, t.ws) ?? null, null, 'no subscription made');
    } finally {
      await t.done();
    }
  }
});

test("the founders' offer as at sign-up: a founder adds with no setup fee and no second spot; another account takes a spot for the product added alone; none left, the list price", async () => {
  // A founder: its spot from sign-up covers what it adds (its products together are one spot).
  const t = await setup({ OF_FOUNDERS_SPOTS: '3' }, { paid: false });
  try {
    t.db.run('INSERT INTO founders (spot, workspace_id, taken_at) VALUES (1, ?, ?)', t.ws.id, '2026-11-09T10:00:00.000Z');
    t.db.run("UPDATE subscriptions SET setup = 0 WHERE workspace_id = ? AND product = 'teder'", t.ws.id);
    const dana = t.as('dana@example.com');
    const page = (await dana.get('/subscription/toran/add')).body;
    assert.match(page, /<p class="founders-note">אתם בין העסקים הראשונים שנרשמו במבצע המייסדים, אז גם כאן אין דמי הקמה\.<\/p>/);
    assert.match(page, /<small class="price">590 ₪ לחודש ועוד מע״מ<\/small>/);
    assert.doesNotMatch(page, /דמי הקמה של/);
    assert.equal((await dana.post('/subscription/toran/add', { plan_toran: 'store', terms: '1' })).status, 303);
    assert.equal(toranOf(t.db, t.ws).setup, 0);
    assert.deepEqual(foundersState(t.db, { OF_FOUNDERS_SPOTS: '3' }), { spots: 3, taken: 1, left: 2 }, 'no second spot');
    // Teder is unpaid too, so the email asks for both months, Teder's first month and Toran's, with no fee and the
    // reason once.
    const mail = t.mails.find((m) => m.subject === 'תורן נוסף לחשבון של החנות של דנה');
    assert.match(mail.text, /תדר, החבילה הקטנה: 490 ₪ לחודש ועוד מע״מ\.\n/);
    assert.match(mail.text, /תורן, חנות: 590 ₪ לחודש ועוד מע״מ\.\n/);
    assert.match(mail.text, /סך הכול לתשלום עכשיו: 1,274\.40 ₪/);
    assert.equal(mail.text.split('אתם בין העסקים הראשונים שנרשמו במבצע המייסדים').length - 1, 1);
    assert.doesNotMatch(mail.text, /דמי הקמה של/);
    assert.match(t.mails.find((m) => m.to === 'boss@example.com').text, /מבצע המייסדים: הם במקום 1 מתוך 3 מההרשמה, אז גם המוצר הזה בלי דמי הקמה\./);
  } finally {
    await t.done();
  }

  // An account that is not a founder, while spots are left: it takes one, and only the product added is waived.
  const u = await setup({ OF_FOUNDERS_SPOTS: '3' }, { paid: false });
  try {
    const dana = u.as('dana@example.com');
    assert.match((await dana.get('/subscription/toran/add')).body, /במבצע המייסדים, 3 העסקים הראשונים לא משלמים דמי הקמה\. נשארו 3 מקומות, ומי שמוסיף מוצר עכשיו מקבל אחד מהם\./);
    assert.equal((await dana.post('/subscription/toran/add', { plan_toran: 'store', terms: '1' })).status, 303);
    assert.equal(toranOf(u.db, u.ws).setup, 0);
    assert.equal(u.db.get("SELECT setup FROM subscriptions WHERE workspace_id = ? AND product = 'teder'", u.ws.id).setup, 990, "Teder's fee as it was billed");
    assert.deepEqual(foundersState(u.db, { OF_FOUNDERS_SPOTS: '3' }), { spots: 3, taken: 1, left: 2 });
    assert.ok(u.db.get("SELECT 1 FROM audit WHERE action = 'founders_spot' AND workspace_id = ?", u.ws.id));
  } finally {
    await u.done();
  }

  // No spot left: the list price, and the page quotes it.
  const v = await setup({ OF_FOUNDERS_SPOTS: '1', OF_FOUNDERS_EARLIER: 'brickdealil' });
  try {
    const dana = v.as('dana@example.com');
    const page = (await dana.get('/subscription/toran/add')).body;
    assert.doesNotMatch(page, /founders-note/);
    assert.match(page, /ודמי הקמה של 990 ₪ פעם אחת/);
    await dana.post('/subscription/toran/add', { plan_toran: 'store', terms: '1' });
    assert.equal(toranOf(v.db, v.ws).setup, 990);
  } finally {
    await v.done();
  }
});

test('a product the account had before is the operator\'s to bring back: the page says to write to us, and nothing changes', async () => {
  const t = await setup();
  try {
    // Toran was on, and the operator turned it off: its subscription is kept, with whatever was agreed for it.
    setProduct(t.db, t.ws.id, 'toran', true, { by: t.admin });
    setProduct(t.db, t.ws.id, 'toran', false, { by: t.admin });
    const dana = t.as('dana@example.com');
    // Still offered (it is not on), and the page says what to do.
    const page = await dana.get('/subscription/toran/add');
    assert.equal(page.status, 409);
    assert.match(page.body, /<h1>תורן כבר היה בחשבון הזה<\/h1>/);
    assert.match(page.body, /כדי להחזיר אותו, כתבו לנו בוואטסאפ ונחזיר אותו לחשבון\./);
    assert.match(page.body, new RegExp(`href="https://wa\\.me/${SUPPORT}\\?text=`));
    await dana.get('/');
    const forged = await dana.post('/subscription/toran/add', { plan_toran: 'big', terms: '1' });
    assert.equal(forged.status, 409);
    assert.match(forged.body, /תורן כבר היה בחשבון הזה/);
    assert.equal(toranOn(t.db, t.ws), false);
    assert.equal(toranOf(t.db, t.ws).plan, 'store', 'its old subscription as it was');
  } finally {
    await t.done();
  }
});

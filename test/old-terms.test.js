import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { pathOf, signedIn, startSite, tokenOf } from './site.js';
import { setNow } from '../src/core/clock.js';
import { addDays, ensureSubscription, graceChange, graceChangeOf, graceLast, NEVER, NOTICE_DAYS, OLD_GRACE_DAYS, onOldTerms, payMonth, TERMS_72H } from '../src/accounts/subscriptions.js';
import { accessFor, endOfIsraelDay, entitlement } from '../src/accounts/entitlement.js';
import { openWorkspace } from '../src/accounts/workspaces.js';
import { eraseWorkspace } from '../src/accounts/erase.js';
import { TERMS_URL, TERMS_VERSION } from '../src/accounts/signup.js';
import { billingKind, runDaily } from '../src/web/daily.js';
import { startProduct } from './setup-fake.js';

// The 72 hours and the terms customers accepted before them (2026-11-03). Those terms gave a payment that did not come
// 14 days, and promise "על שינוי במחיר או בהסכם נודיע לכם לפחות 30 יום מראש". So a workspace on them (an older
// workspaces.terms_version, or none recorded) is emailed the change once, and keeps the 14 days for every payment that
// falls due before its change date, the day after the 30 whole days that follow that email; from then on, the 72
// hours. Never emailed (nobody to email), it keeps the 14 days. A sign-up on today's terms has the 72 hours at once.

const ENV = { PUBLIC_HOST: 'accounts.openfrequency.co.il', OF_SIGNUP_NOTIFY: 'boss@example.com', OF_PAYMENT_METHOD: 'העברה בנקאית' };
const linesOf = (text) => text.split('\n\n');
const NOTICE = 'שינוי אחד בהסכם שלנו מ-4.12.2026';

function setup() {
  const h = tempHome();
  setNow('2026-10-22T07:00:00.000Z');
  const mails = [];
  const run = (at) => (setNow(at), runDaily(h.db, { env: ENV, mailer: { send: (m) => mails.push(m) }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {} }));
  // Noa Shop accepted the terms of 1 November and paid a month on 22.10: paid until 21.11.2026.
  const old = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', terms: '2026-11-01', members: { 'noa@example.com': 'client_owner', 'dan@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
  ensureSubscription(h.db, old.id, 'teder');
  payMonth(h.db, old.id, 'teder', { by: null });
  return { ...h, mails, run, old };
}

// ---- the rule

test('the rule: which terms are old, and each payment\'s last day of grace by the day it falls due', () => {
  for (const v of [null, '', '2026-10-24', '2026-10-27', '2026-10-29', '2026-10-30', '2026-11-01']) assert.equal(onOldTerms(v), true, String(v));
  for (const v of ['2026-11-03', '2026-12-01', TERMS_VERSION]) assert.equal(onOldTerms(v), false, v);
  assert.ok(TERMS_VERSION >= TERMS_72H, 'a sign-up today accepts the terms of the 72 hours');
  assert.deepEqual([OLD_GRACE_DAYS, NOTICE_DAYS], [14, 30]);
  assert.deepEqual([graceChange(TERMS_VERSION, null), graceChange(TERMS_VERSION, '2026-12-04'), graceChange('2026-11-01', null), graceChange(null, '2026-12-04')], [null, null, NEVER, '2026-12-04']);

  // The new terms: the 72 hours.
  assert.equal(graceLast('2026-11-21', null), '2026-11-24');
  // The old terms, never told of the change: 14 days from the day it fell due, every month.
  assert.equal(graceLast('2026-11-21', NEVER), '2026-12-06');
  assert.equal(graceLast('2027-05-31', NEVER), '2027-06-15');
  // Told, with the change from 4.12.2026: due before it, 14 days, even when they run past it; due on it or after, 72 hours.
  assert.equal(graceLast('2026-11-21', '2026-12-04'), '2026-12-06', 'due 22.11: 14 days, to 6.12, past the change date');
  assert.equal(graceLast('2026-12-02', '2026-12-04'), '2026-12-17', 'due 3.12, the day before it: 14 days');
  assert.equal(graceLast('2026-12-03', '2026-12-04'), '2026-12-06', 'due 4.12: the 72 hours');
  assert.equal(graceLast('2026-12-21', '2026-12-04'), '2026-12-24');
  // The 72 hours keep their rule for the clocks going forward: never fewer than 72 (paid until 24.3.2027: to the 28th).
  assert.equal(graceLast('2027-03-24', '2026-12-04'), '2027-03-28');
  assert.equal((Date.parse(endOfIsraelDay(graceLast('2027-03-24', '2026-12-04'))) - Date.parse(endOfIsraelDay('2027-03-24'))) / 3_600_000, 95);
  assert.equal(graceLast('2027-03-24', NEVER), '2027-04-08', 'the old terms: 14 days, clocks or not');

  // The emails follow the same day: on the old terms, due from the first day after, last on the 14th, then stopped.
  const kinds = [];
  for (let n = 0; n <= 17; n++) kinds.push(billingKind('2026-11-21', addDays('2026-11-21', n), '2026-12-04'));
  assert.deepEqual(kinds, ['soon1', ...Array(14).fill('due'), 'last', 'stopped', 'stopped']);
});

// ---- the notice

test('the notice: once, on the first run, to each owner of each workspace on the old terms that can be billed, with its change date 30 whole days on', async () => {
  const t = setup();
  try {
    // Opened on /admin (no terms recorded), and a sign-up on today's terms; complimentary only; disabled; deleted.
    const admin = openWorkspace(t.db, { name: 'Gal Shop', slug: 'gal-shop', products: ['toran'] }, { by: null });
    t.db.insert('memberships', { user_id: makeUser(t.db, 'gal@example.com').id, workspace_id: admin.id, role: 'client_owner', created_at: '2026-10-22T07:00:00.000Z' });
    makeWorkspace(t.db, 'new-shop', { members: { 'new@example.com': 'client_owner' } });
    makeWorkspace(t.db, 'comp-shop', { terms: null, comp: true, members: { 'comp@example.com': 'client_owner' } });
    const off = makeWorkspace(t.db, 'off-shop', { terms: null, members: { 'off@example.com': 'client_owner' } });
    t.db.run('UPDATE workspaces SET disabled_at = ? WHERE id = ?', '2026-10-30T10:00:00.000Z', off.id);

    // The first run after the deploy, 3.11.2026 at 09:00.
    const r = await t.run('2026-11-03T07:00:00.000Z');
    assert.equal(r.notices, 2);
    const sent = t.mails.filter((m) => m.subject === NOTICE);
    assert.deepEqual(sent.map((m) => m.to).sort(), ['dan@example.com', 'gal@example.com', 'noa@example.com'], 'each owner, never a member, never comp or disabled or the new terms');
    const m = sent.find((x) => x.to === 'noa@example.com');
    assert.deepEqual(linesOf(m.text), [
      'שלום,',
      'אנחנו משנים דבר אחד בהסכם שלנו עם Noa Shop. מ-4.12.2026, אם התשלום על חודש חדש לא יגיע אלינו תוך 72 שעות מסוף החודש ששולם, השירות ייעצר עד שישולם.',
      'עד אז הכול נשאר כמו שהוא היום.',
      'לפני שכל חודש נגמר, נזכיר לכם במייל לשלם על החודש הבא.',
      `${TERMS_URL}#t-price`,
      'OpenFrequency',
    ]);
    assert.equal(m.link, 'https://openfrequency.co.il/terms#t-price');
    assert.deepEqual([...m.html.matchAll(/<a href="([^"]+)" style="display:inline-block;padding:13px 30px[^>]*>([^<]+)<\/a>/g)].map((x) => [x[1], x[2]]), [['https://openfrequency.co.il/terms#t-price', 'לתנאי השימוש']], 'one button, to the terms');
    assert.doesNotMatch(m.subject + m.text, /—|–|!/);

    // Kept: the day it went, and the change date, the day after the 30 whole days that follow it (4.11 to 3.12).
    const row = t.db.get('SELECT * FROM terms_notices WHERE workspace_id = ?', t.old.id);
    assert.deepEqual([row.sent_on, row.change_on, row.recipients], ['2026-11-03', '2026-12-04', 2]);
    assert.equal(row.sent_at, '2026-11-03T07:00:00.000Z');
    assert.equal(row.change_on, addDays(row.sent_on, NOTICE_DAYS + 1));
    const startOfChange = Date.parse(endOfIsraelDay('2026-12-03')) + 1;
    assert.ok(startOfChange - Date.parse(row.sent_at) >= 30 * 86_400_000, 'at least 30 days between the email and the change');
    assert.equal(graceChangeOf(t.db, t.old.id), '2026-12-04');
    assert.equal(graceChangeOf(t.db, admin.id), '2026-12-04', 'no terms recorded: the old terms');
    assert.equal(graceChangeOf(t.db, t.db.get("SELECT id FROM workspaces WHERE slug = 'new-shop'").id), null);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'terms_notice_sent' AND workspace_id = ?", t.old.id));

    // Never twice, and its date never moves.
    t.mails.length = 0;
    for (const day of ['2026-11-04', '2026-11-20', '2026-12-10']) assert.equal((await t.run(`${day}T07:00:00.000Z`)).notices, 0, day);
    assert.equal(t.mails.filter((x) => x.subject.startsWith('שינוי אחד בהסכם')).length, 0);
    assert.equal(t.db.get('SELECT change_on FROM terms_notices WHERE workspace_id = ?', t.old.id).change_on, '2026-12-04');

    // A complimentary workspace that becomes billable is told then, with its own 30 days.
    t.db.run("UPDATE workspace_products SET comp = 0 WHERE workspace_id = (SELECT id FROM workspaces WHERE slug = 'comp-shop')");
    t.mails.length = 0;
    await t.run('2026-12-11T07:00:00.000Z');
    assert.deepEqual(t.mails.map((x) => [x.to, x.subject]), [['comp@example.com', 'שינוי אחד בהסכם שלנו מ-11.1.2027']]);
  } finally {
    t.cleanup();
  }
});

test('no owner to email: nothing kept, the 14 days stay; an owner later is emailed then, and the date counts from then', async () => {
  const t = setup();
  try {
    const lone = makeWorkspace(t.db, 'lone-shop', { name: 'Lone Shop', terms: null, members: { 'staff@example.com': 'client_member' } });
    ensureSubscription(t.db, lone.id, 'teder');
    payMonth(t.db, lone.id, 'teder', { by: null }); // paid until 21.11.2026
    await t.run('2026-11-03T07:00:00.000Z');
    assert.equal(t.db.get('SELECT 1 FROM terms_notices WHERE workspace_id = ?', lone.id), null);
    assert.equal(graceChangeOf(t.db, lone.id), NEVER);
    // Its payment due 22.11 has the 14 days; so has the one after, while nobody was told.
    assert.equal(accessFor(t.db, lone.id, 'teder', '2026-12-06').access, 'due');
    assert.equal(accessFor(t.db, lone.id, 'teder', '2026-12-07').access, 'unpaid');
    t.db.run("UPDATE subscriptions SET paid_until = '2026-12-21' WHERE workspace_id = ?", lone.id);
    assert.equal(accessFor(t.db, lone.id, 'teder', '2027-01-05').graceUntil, '2027-01-05');
    // An owner joins: the next run emails them, and the change counts from that day.
    t.db.insert('memberships', { user_id: makeUser(t.db, 'lone@example.com').id, workspace_id: lone.id, role: 'client_owner', created_at: '2026-12-01T07:00:00.000Z' });
    t.mails.length = 0;
    await t.run('2026-12-22T07:00:00.000Z');
    const theirs = t.mails.filter((m) => m.to === 'lone@example.com');
    assert.deepEqual(theirs.map((m) => m.subject), ['שינוי אחד בהסכם שלנו מ-22.1.2027', 'התשלום על החודש החדש של תדר עוד לא הגיע']);
    // The payment due that day, before its change date: the 14 days, said so.
    assert.equal(linesOf(theirs[1].text)[2], 'תדר ממשיך לעבוד עד סוף יום שלישי, 5.1.2027. אם התשלום לא יגיע עד אז, תדר ייעצר עד שישולם.');
    assert.equal(graceChangeOf(t.db, lone.id), '2027-01-22');
    // The workspace's data deleted: its notice goes with it.
    eraseWorkspace(t.db, lone.id, { by: null });
    assert.equal(t.db.get('SELECT 1 FROM terms_notices WHERE workspace_id = ?', lone.id), null);
  } finally {
    t.cleanup();
  }
});

// ---- the grace, before and after the change date

test('on the old terms: the payment due before the change date keeps its 14 days past it, in access, graceUntil and the emails; the next one has the 72 hours', async () => {
  const t = setup();
  try {
    await t.run('2026-11-03T07:00:00.000Z'); // the notice: the change from 4.12.2026
    // Paid until 21.11, due 22.11 (before 4.12): due to the end of 6.12, then unpaid.
    for (const day of ['2026-11-22', '2026-11-25', '2026-12-04', '2026-12-06']) assert.equal(accessFor(t.db, t.old.id, 'teder', day).access, 'due', day);
    assert.equal(accessFor(t.db, t.old.id, 'teder', '2026-12-07').access, 'unpaid');
    setNow('2026-11-25T10:00:00.000Z');
    assert.deepEqual([entitlement(t.db, t.old.id, 'teder').access, entitlement(t.db, t.old.id, 'teder').graceUntil], ['due', '2026-12-06T21:59:59.999Z']);

    // Its emails, day by day: due on 22.11 with the 14 days' last day, nothing until last on 6.12, stopped on 7.12.
    const sent = {};
    for (let day = '2026-11-21'; day <= '2026-12-08'; day = addDays(day, 1)) {
      t.mails.length = 0;
      await t.run(`${day}T07:00:00.000Z`);
      const m = t.mails.find((x) => x.to === 'noa@example.com');
      if (m) sent[day] = m.subject;
      if (day === '2026-11-22') assert.equal(linesOf(m.text)[2], 'תדר ממשיך לעבוד עד סוף יום ראשון, 6.12.2026. אם התשלום לא יגיע עד אז, תדר ייעצר עד שישולם.');
      if (day === '2026-12-06') assert.equal(linesOf(m.text)[1], 'היום האחרון לשלם על החודש החדש של תדר בחשבון של Noa Shop הוא היום, יום ראשון, 6.12.2026. הסכום: 790 ₪ ועוד מע״מ, 932.20 ₪ בסך הכול.');
    }
    assert.deepEqual(sent, { '2026-11-21': 'התשלום הבא על תדר: 22.11.2026', '2026-11-22': 'התשלום על החודש החדש של תדר עוד לא הגיע', '2026-12-06': 'תדר ייעצר מחר אם התשלום לא יגיע היום', '2026-12-07': 'תדר נעצר עד שהתשלום יגיע' });

    // Paid again on 8.12: until 7.1.2027, due 8.1 (after the change date): the 72 hours, to 10.1.
    payMonth(t.db, t.old.id, 'teder', { by: null });
    assert.equal(t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ?', t.old.id).paid_until, '2027-01-07');
    assert.equal(accessFor(t.db, t.old.id, 'teder', '2027-01-10').graceUntil, '2027-01-10');
    assert.equal(accessFor(t.db, t.old.id, 'teder', '2027-01-11').access, 'unpaid');
    // A payment due on the day before the change date (paid until 2.12) has the 14 days, to 17.12; on it, 72 hours.
    t.db.run("UPDATE subscriptions SET paid_until = '2026-12-02' WHERE workspace_id = ?", t.old.id);
    assert.equal(accessFor(t.db, t.old.id, 'teder', '2026-12-10').graceUntil, '2026-12-17');
    t.db.run("UPDATE subscriptions SET paid_until = '2026-12-03' WHERE workspace_id = ?", t.old.id);
    assert.equal(accessFor(t.db, t.old.id, 'teder', '2026-12-05').graceUntil, '2026-12-06');
  } finally {
    t.cleanup();
  }
});

test('a sign-up on today\'s terms has the 72 hours at once, and no notice', async () => {
  const h = tempHome();
  setNow('2026-11-03T08:00:00.000Z');
  const teder = await startProduct('teder');
  const s = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder', OF_TEDER_INTERNAL: teder.url, ...ENV, PUBLIC_HOST: '' } });
  try {
    const b = s.browser();
    await b.get('/signup');
    await b.post('/signup', { name: 'Gal Cohen', business: 'Gal Ceramics', email: 'gal@example.com', products: ['teder'], plan: 'small', terms: '1', website: '', via: 'email' });
    await b.get(pathOf(s.mails[0].link));
    await b.post('/signup/confirm', { t: tokenOf(s.mails[0].link) });
    const ws = h.db.get("SELECT id, terms_version FROM workspaces WHERE name = 'Gal Ceramics'");
    assert.equal(ws.terms_version, TERMS_VERSION);
    assert.equal(graceChangeOf(h.db, ws.id), null);
    payMonth(h.db, ws.id, 'teder', { by: null }); // paid until 2.12.2026
    assert.equal(accessFor(h.db, ws.id, 'teder', '2026-12-05').access, 'due');
    assert.equal(accessFor(h.db, ws.id, 'teder', '2026-12-06').access, 'unpaid');
    const mails = [];
    const r = await runDaily(h.db, { env: ENV, mailer: { send: (m) => mails.push(m) }, eraser: { erase: async () => ({ results: {}, ok: true, failed: [] }) }, log: () => {} });
    assert.equal(r.notices, 0);
    assert.equal(mails.filter((m) => m.subject.startsWith('שינוי אחד בהסכם')).length, 0);
  } finally {
    await s.close();
    await teder.close();
    h.cleanup();
  }
});

test('the pages of a workspace on the old terms in its 14 days: the home page and /setup name the day it stops', async () => {
  const t = setup();
  const teder = await startProduct('teder');
  const s = await startSite(t.db, { env: { OF_TEDER_INTERNAL: teder.url, TEDER_URL: 'https://teder.openfrequency.co.il/', OF_SUPPORT_WA: '972500000100' } });
  try {
    await t.run('2026-11-03T07:00:00.000Z');
    setNow('2026-11-25T10:00:00.000Z'); // 72 hours would be over; on the old terms it works to 6.12
    const b = signedIn(s, t.db, t.db.get("SELECT * FROM users WHERE email = 'noa@example.com'"));
    assert.match((await b.get('/')).body, /התשלום לחודש שהתחיל ב-22\.11\.2026 עוד לא הגיע אלינו\. המנוי ממשיך לעבוד עד סוף יום ראשון, 6\.12\.2026, ואם התשלום לא יגיע עד אז הוא ייעצר עד שישולם\./);
    assert.match((await b.get('/setup')).body, /<li>תדר, החבילה המלאה: התשלום על החודש החדש עוד לא הגיע\. המנוי עובד עד סוף יום ראשון, 6\.12\.2026, ואחרי זה נעצר עד שישולם\.<\/li>/);
  } finally {
    await s.close();
    await teder.close();
    t.cleanup();
  }
});

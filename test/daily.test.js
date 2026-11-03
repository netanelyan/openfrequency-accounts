import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { setNow } from '../src/core/clock.js';
import { createSession } from '../src/auth/sessions.js';
import { addDays, ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { cancelSubscription } from '../src/accounts/entitlement.js';
import { billingKind, idleWorkspaces, lastRuns, runDaily } from '../src/web/daily.js';
import { billingMail } from '../src/mail/messages.js';

// The daily jobs (src/web/daily.js): the billing emails before a payment falls due, on the first and the last of the
// 72 hours after the paid month, and when they are over (ACC-01), each once, with the operator told of due and stopped; and the deletions the privacy policy promises (ACC-07,
// PRA-DB-005): sign-ups never confirmed, old links and sessions, and a workspace nobody used and nobody paid for,
// warned 14 days before and deleted through every product first.

const ENV = { OF_SIGNUP_NOTIFY: 'boss@example.com', PUBLIC_HOST: 'accounts.openfrequency.co.il', OF_PAYMENT_METHOD: 'העברה בנקאית' };

function setup() {
  const h = tempHome();
  setNow('2026-10-22T07:00:00.000Z');
  const mails = [];
  const mailer = { send: (m) => mails.push(m) };
  const asked = [];
  const eraser = { answer: 'deleted', erase: async (id, products) => (asked.push([id, products]), { results: Object.fromEntries(products.map((p) => [p, eraser.answer])), ok: eraser.answer === 'deleted', failed: eraser.answer === 'deleted' ? [] : products }) };
  const run = (at) => (setNow(at), runDaily(h.db, { env: ENV, mailer, eraser, log: () => {} }));
  return { ...h, mails, mailer, eraser, asked, run };
}

// The 72 hours (the owner, 2026-11-03: "add a reminder to pay for the new month ... A user has 72 hours to pay for a
// new month once their subscription has ended"): paid until P, soon7 in the week before it falls due, soon1 on P, due
// on P+1 (or P+2, if that run was missed), last on P+3, the last of the 3 days, stopped from P+4 for a week.
const AROUND = [null, null, null, null, 'soon7', 'soon7', 'soon7', 'soon7', 'soon7', 'soon7', 'soon1', 'due', 'due', 'last', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped', null, null];
const linesOf = (text) => text.split('\n\n');
const buttons = (html) => [...html.matchAll(/<a href="([^"]+)" style="display:inline-block;padding:13px 30px[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);

test('which billing email a day owes: a week before, the day before, the first day after, the last of the 72 hours, then stopped', () => {
  const k = (today) => billingKind('2026-11-21', today);
  assert.equal(k('2026-11-14'), null);
  assert.equal(k('2026-11-15'), 'soon7');
  assert.equal(k('2026-11-20'), 'soon7');
  assert.equal(k('2026-11-21'), 'soon1');
  assert.equal(k('2026-11-22'), 'due');
  assert.equal(k('2026-11-23'), 'due');
  assert.equal(k('2026-11-24'), 'last');
  assert.equal(k('2026-11-25'), 'stopped');
  assert.equal(k('2026-12-01'), 'stopped');
  assert.equal(k('2026-12-02'), null);
  // Every day from 10 before to 12 after, at a month's end, a year's, February's and a leap February's: one kind a
  // day at most, in that order, with no day between them left out.
  for (const paid of ['2026-11-21', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2028-02-28', '2028-02-29']) {
    const got = [];
    for (let n = -10; n <= 12; n++) got.push(billingKind(paid, addDays(paid, n)));
    assert.deepEqual(got, AROUND, paid);
  }
  assert.equal(addDays('2026-11-30', 3), '2026-12-03');
  assert.equal(addDays('2028-02-28', 3), '2028-03-02');
  // The week the clocks go forward (26.3.2027): paid until the 24th, the 3 days are 71 hours, so the grace has a 4th
  // day and last moves to it; the week they go back (31.10.2027) is 73 hours and stays as every other.
  const march = [];
  for (let n = -1; n <= 6; n++) march.push(billingKind('2027-03-24', addDays('2027-03-24', n)));
  assert.deepEqual(march, ['soon7', 'soon1', 'due', 'due', 'due', 'last', 'stopped', 'stopped']);
  const october = [];
  for (let n = -10; n <= 12; n++) october.push(billingKind('2027-10-29', addDays('2027-10-29', n)));
  assert.deepEqual(october, AROUND);
});

test('the billing emails: each kind once for each paid period, to the owners, the operator told when it is due and when it stops', async () => {
  const t = setup();
  try {
    const ws = makeWorkspace(t.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
    ensureSubscription(t.db, ws.id, 'teder');
    payMonth(t.db, ws.id, 'teder', { by: null }); // paid until 21.11.2026, a Saturday
    // Never paid, complimentary, cancelled: no billing email.
    makeWorkspace(t.db, 'never-paid', { products: ['teder'], members: { 'gal@example.com': 'client_owner' } });
    const comp = makeWorkspace(t.db, 'comp-shop', { products: ['teder'], comp: true, members: { 'comp@example.com': 'client_owner' } });
    ensureSubscription(t.db, comp.id, 'teder');
    payMonth(t.db, comp.id, 'teder', { by: null });
    const gone = makeWorkspace(t.db, 'gone-shop', { products: ['teder'], members: { 'gone@example.com': 'client_owner' } });
    ensureSubscription(t.db, gone.id, 'teder');
    payMonth(t.db, gone.id, 'teder', { by: null });
    cancelSubscription(t.db, gone.id, 'teder', { by: null });

    const r = await t.run('2026-11-15T08:00:00.000Z');
    assert.deepEqual(r.billing, { soon7: 1, soon1: 0, due: 0, last: 0, stopped: 0 });
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'התשלום הבא על תדר: 22.11.2026']]);
    assert.match(t.mails[0].text, /החודש הבא של תדר בחשבון של Noa Shop מתחיל ב-22\.11\.2026\. הסכום: 790 ₪ ועוד מע״מ, 932\.20 ₪ בסך הכול\./);
    // Manual payment (OF_PAYMENT unset) with the owner's details (OF_PAYMENT_METHOD): the details themselves, the receipt
    // (אסמכתא) to us, and a reply for questions; nothing points to an earlier email.
    assert.match(t.mails[0].text, /איך משלמים: העברה בנקאית\n\nאחרי ההעברה, שלחו לנו את האסמכתא בתשובה למייל הזה\. ככה נמצא את ההעברה ונרשום את התשלום\.\n\nיש שאלה על התשלום\? ענו למייל הזה\./);
    assert.doesNotMatch(t.mails[0].text, /ששלחנו לכם במייל/);
    assert.equal(t.mails[0].link, 'https://accounts.openfrequency.co.il/setup');
    // Once a day; and the same kind is never sent twice, the next day included.
    assert.equal((await t.run('2026-11-15T12:00:00.000Z')).ran, false);
    await t.run('2026-11-16T08:00:00.000Z');
    assert.equal(t.mails.length, 1);

    await t.run('2026-11-21T08:00:00.000Z');
    assert.equal(t.mails.at(-1).subject, 'התשלום הבא על תדר: 22.11.2026');

    // The first day after the paid month: the month is over, Teder works to the end of Tuesday 24.11, then stops.
    t.mails.length = 0;
    assert.deepEqual((await t.run('2026-11-22T08:00:00.000Z')).billing, { soon7: 0, soon1: 0, due: 1, last: 0, stopped: 0 });
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'התשלום על החודש החדש של תדר עוד לא הגיע'], ['boss@example.com', 'תשלום לא הגיע: Noa Shop, תדר']]);
    const due = t.mails[0];
    assert.deepEqual(linesOf(due.text), [
      'שלום,',
      'המנוי לתדר בחשבון של Noa Shop שולם עד 21.11.2026, והתשלום על החודש החדש (790 ₪ ועוד מע״מ, 932.20 ₪ בסך הכול) עוד לא הגיע אלינו.',
      'תדר ממשיך לעבוד עד סוף יום שלישי, 24.11.2026. אם התשלום לא יגיע עד אז, תדר ייעצר עד שישולם.',
      'איך משלמים: העברה בנקאית',
      'אחרי ההעברה, שלחו לנו את האסמכתא בתשובה למייל הזה. ככה נמצא את ההעברה ונרשום את התשלום.',
      'יש שאלה על התשלום? ענו למייל הזה.',
      'https://accounts.openfrequency.co.il/setup',
      'OpenFrequency',
    ]);
    assert.deepEqual(buttons(due.html), [['https://accounts.openfrequency.co.il/setup', 'לחשבון']], 'one button');
    assert.match(due.html, /עד סוף יום שלישי, <span dir="ltr" style="white-space:nowrap">24\.11\.2026<\/span>\./);
    // The operator's notice says until when it works, the same day.
    assert.match(t.mails[1].text, /התשלום של Noa Shop על תדר היה צריך להגיע ב-22\.11\.2026\. שלחנו לבעלים מייל, והמנוי ממשיך לעבוד עד 24\.11\.2026\./);
    assert.equal(t.mails[1].link, `https://accounts.openfrequency.co.il/admin/accounts#ws-${ws.id}`);
    // The second day: nothing new.
    t.mails.length = 0;
    assert.deepEqual((await t.run('2026-11-23T08:00:00.000Z')).billing, { soon7: 0, soon1: 0, due: 0, last: 0, stopped: 0 });
    assert.equal(t.mails.length, 0);

    // The last of the 3 days: today is the last day to pay. The owners alone: the operator hears of due and stopped.
    assert.deepEqual((await t.run('2026-11-24T08:00:00.000Z')).billing, { soon7: 0, soon1: 0, due: 0, last: 1, stopped: 0 });
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'תדר ייעצר מחר אם התשלום לא יגיע היום']]);
    const last = t.mails[0];
    assert.deepEqual(linesOf(last.text), [
      'שלום,',
      'היום האחרון לשלם על החודש החדש של תדר בחשבון של Noa Shop הוא היום, יום שלישי, 24.11.2026. הסכום: 790 ₪ ועוד מע״מ, 932.20 ₪ בסך הכול.',
      'אם התשלום לא יגיע עד סוף היום, תדר ייעצר עד שישולם.',
      'איך משלמים: העברה בנקאית',
      'אחרי ההעברה, שלחו לנו את האסמכתא בתשובה למייל הזה. ככה נמצא את ההעברה ונרשום את התשלום.',
      'יש שאלה על התשלום? ענו למייל הזה.',
      'https://accounts.openfrequency.co.il/setup',
      'OpenFrequency',
    ]);
    assert.deepEqual(buttons(last.html), [['https://accounts.openfrequency.co.il/setup', 'לחשבון']], 'one button');
    // The day run again (its row gone, as `npm run daily -- --again` does): the same email is not sent twice.
    t.db.run('DELETE FROM daily_runs');
    t.mails.length = 0;
    assert.deepEqual((await t.run('2026-11-24T12:00:00.000Z')).billing, { soon7: 0, soon1: 0, due: 0, last: 0, stopped: 0 });
    assert.equal(t.mails.length, 0);

    // The 72 hours are over: stopped, to the owners and the operator.
    await t.run('2026-11-25T08:00:00.000Z');
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'תדר נעצר עד שהתשלום יגיע'], ['boss@example.com', 'נעצר על תשלום: Noa Shop, תדר']]);
    // Each one in the audit log, and kept once for the period with how many it went to.
    assert.deepEqual(t.db.all("SELECT action FROM audit WHERE action LIKE 'billing_%' ORDER BY id").map((a) => a.action), ['billing_soon7', 'billing_soon1', 'billing_due', 'billing_last', 'billing_stopped']);
    assert.deepEqual(t.db.all('SELECT kind, due_on, recipients FROM billing_notices WHERE workspace_id = ? ORDER BY sent_at', ws.id).map((n) => [n.kind, n.due_on, n.recipients]), [['soon7', '2026-11-22', 1], ['soon1', '2026-11-22', 1], ['due', '2026-11-22', 1], ['last', '2026-11-22', 1], ['stopped', '2026-11-22', 1]]);

    // A payment moves the period on, and its emails follow it.
    t.mails.length = 0;
    payMonth(t.db, ws.id, 'teder', { by: null }); // from 25.11: paid until 24.12
    assert.equal(t.db.get("SELECT paid_until FROM subscriptions WHERE workspace_id = ? AND product = 'teder'", ws.id).paid_until, '2026-12-24');
    await t.run('2026-12-18T08:00:00.000Z');
    assert.deepEqual(t.mails.map((m) => m.subject), ['התשלום הבא על תדר: 25.12.2026']);
    assert.ok(lastRuns(t.db)[0].finished_at);
  } finally {
    t.cleanup();
  }
});

test("the 72 hours at a month's end, for Teder and Toran each: due on the 1st, last on the 3rd, stopped on the 4th; a missed day sends due the next", async () => {
  const t = setup();
  try {
    const ws = makeWorkspace(t.db, 'gal-shop', { name: 'Gal Shop', products: ['teder', 'toran'], members: { 'gal@example.com': 'client_owner' } });
    for (const p of ['teder', 'toran']) ensureSubscription(t.db, ws.id, p);
    t.db.run("UPDATE subscriptions SET paid_until = '2026-11-30', monthly = 500, vat = 'included' WHERE workspace_id = ?", ws.id);
    const sent = {};
    for (let day = '2026-11-22'; day <= '2026-12-12'; day = addDays(day, 1)) {
      if (day === '2026-12-01') continue; // no run on the 1st (the server was down): due goes on the 2nd
      t.mails.length = 0;
      await t.run(`${day}T08:00:00.000Z`);
      for (const m of t.mails.filter((x) => x.to === 'gal@example.com')) (sent[day] ||= []).push(m.subject);
    }
    assert.deepEqual(sent, {
      '2026-11-24': ['התשלום הבא על תדר: 1.12.2026', 'התשלום הבא על תורן: 1.12.2026'],
      '2026-11-30': ['התשלום הבא על תדר: 1.12.2026', 'התשלום הבא על תורן: 1.12.2026'],
      '2026-12-02': ['התשלום על החודש החדש של תדר עוד לא הגיע', 'התשלום על החודש החדש של תורן עוד לא הגיע'],
      '2026-12-03': ['תדר ייעצר מחר אם התשלום לא יגיע היום', 'תורן ייעצר מחר אם התשלום לא יגיע היום'],
      '2026-12-04': ['תדר נעצר עד שהתשלום יגיע', 'תורן נעצר עד שהתשלום יגיע'],
    });
    for (const kind of ['soon7', 'soon1', 'due', 'last', 'stopped']) assert.equal(t.db.get('SELECT COUNT(*) AS n FROM billing_notices WHERE kind = ?', kind).n, 2, `${kind}: one for each subscription`);
  } finally {
    t.cleanup();
  }
});

test('the week the clocks go forward: due on the first day, last on the 4th, each saying the day it really stops', async () => {
  const t = setup();
  try {
    const ws = makeWorkspace(t.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
    ensureSubscription(t.db, ws.id, 'teder');
    t.db.run("UPDATE subscriptions SET paid_until = '2027-03-24' WHERE workspace_id = ?", ws.id);
    const sent = {};
    for (let day = '2027-03-24'; day <= '2027-03-30'; day = addDays(day, 1)) {
      t.mails.length = 0;
      await t.run(`${day}T07:00:00.000Z`);
      const m = t.mails.find((x) => x.to === 'noa@example.com');
      if (m) sent[day] = [m.subject, linesOf(m.text)[1] + (m.subject.startsWith('התשלום על') ? ` ${linesOf(m.text)[2]}` : '')];
    }
    assert.deepEqual(sent, {
      '2027-03-24': ['התשלום הבא על תדר: 25.3.2027', 'החודש הבא של תדר בחשבון של Noa Shop מתחיל ב-25.3.2027. הסכום: 790 ₪ ועוד מע״מ, 932.20 ₪ בסך הכול.'],
      '2027-03-25': ['התשלום על החודש החדש של תדר עוד לא הגיע', 'המנוי לתדר בחשבון של Noa Shop שולם עד 24.3.2027, והתשלום על החודש החדש (790 ₪ ועוד מע״מ, 932.20 ₪ בסך הכול) עוד לא הגיע אלינו. תדר ממשיך לעבוד עד סוף יום ראשון, 28.3.2027. אם התשלום לא יגיע עד אז, תדר ייעצר עד שישולם.'],
      '2027-03-28': ['תדר ייעצר מחר אם התשלום לא יגיע היום', 'היום האחרון לשלם על החודש החדש של תדר בחשבון של Noa Shop הוא היום, יום ראשון, 28.3.2027. הסכום: 790 ₪ ועוד מע״מ, 932.20 ₪ בסך הכול.'],
      '2027-03-29': ['תדר נעצר עד שהתשלום יגיע', 'התשלום על תדר בחשבון של Noa Shop לא הגיע עד סוף תקופת החסד, אז תדר נעצר. הנתונים נשמרים, ותדר ייפתח שוב כשהתשלום יגיע.'],
    });
  } finally {
    t.cleanup();
  }
});

test('a payment in the 72 hours: no last and no stopped for that month, and the next month gets its own', async () => {
  const t = setup();
  try {
    const ws = makeWorkspace(t.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner' } });
    ensureSubscription(t.db, ws.id, 'teder');
    payMonth(t.db, ws.id, 'teder', { by: null }); // paid until 21.11.2026
    await t.run('2026-11-22T08:00:00.000Z');
    assert.equal(t.mails.filter((m) => m.to === 'noa@example.com').at(-1).subject, 'התשלום על החודש החדש של תדר עוד לא הגיע');
    setNow('2026-11-22T12:00:00.000Z');
    payMonth(t.db, ws.id, 'teder', { by: null }); // paid on the first of the 3 days: the next month runs on, to 21.12
    t.mails.length = 0;
    for (const day of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) await t.run(`${day}T08:00:00.000Z`);
    assert.deepEqual(t.mails, []);
    await t.run('2026-12-15T08:00:00.000Z');
    assert.deepEqual(t.mails.map((m) => m.subject), ['התשלום הבא על תדר: 22.12.2026']);
  } finally {
    t.cleanup();
  }
});

test('the due and last emails, in their words: the day it was paid until, the day it stops with its weekday, the amount, how to pay and one button', () => {
  const fields = { business: 'Gal Shop', paidUntil: '2026-11-30', dueOn: '2026-12-01', graceUntil: '2026-12-03', amount: '500 ₪', pay: 'משלמים לפי פרטי התשלום ששלחנו לכם במייל.', link: 'https://accounts.openfrequency.co.il/setup' };
  const due = billingMail('gal@example.com', { ...fields, kind: 'due', product: 'toran' });
  assert.equal(due.subject, 'התשלום על החודש החדש של תורן עוד לא הגיע');
  assert.deepEqual(linesOf(due.text).slice(1, 4), [
    'המנוי לתורן בחשבון של Gal Shop שולם עד 30.11.2026, והתשלום על החודש החדש (500 ₪) עוד לא הגיע אלינו.',
    'תורן ממשיך לעבוד עד סוף יום חמישי, 3.12.2026. אם התשלום לא יגיע עד אז, תורן ייעצר עד שישולם.',
    'משלמים לפי פרטי התשלום ששלחנו לכם במייל.',
  ]);
  const last = billingMail('gal@example.com', { ...fields, kind: 'last', product: 'teder', payLink: 'https://pay.example.com/openfrequency', payButton: 'לתשלום' });
  assert.equal(last.subject, 'תדר ייעצר מחר אם התשלום לא יגיע היום');
  assert.equal(linesOf(last.text)[1], 'היום האחרון לשלם על החודש החדש של תדר בחשבון של Gal Shop הוא היום, יום חמישי, 3.12.2026. הסכום: 500 ₪.');
  assert.deepEqual(buttons(last.html), [['https://pay.example.com/openfrequency', 'לתשלום']]);
  assert.equal(last.link, 'https://pay.example.com/openfrequency');
  for (const m of [due, last]) {
    assert.doesNotMatch(m.subject + m.text, /—|–|14 יום|!/);
    assert.doesNotMatch(m.html, /—|–/);
  }
});

test('retention: unconfirmed sign-ups after 30 days, links 30 days after they end, sessions 90 days after; recent ones stay', async () => {
  const t = setup();
  try {
    const u = makeUser(t.db, 'noa@example.com');
    const row = (at, extra = {}) => ({ token_hash: `h${Math.random()}`, kind: 'email', email: 'x@example.com', name: 'X', business: 'X', products_json: '["teder"]', terms_version: 'v', terms_accepted_at: at, created_at: at, expires_at: at, ...extra });
    t.db.insert('signups', row('2026-09-01T00:00:00.000Z'));
    t.db.insert('signups', row('2026-10-20T00:00:00.000Z'));
    t.db.insert('signups', row('2026-09-01T00:00:00.000Z', { used_at: '2026-09-01T00:05:00.000Z' })); // confirmed: it goes with its workspace
    t.db.insert('tokens', { token_hash: 'old', kind: 'magic', email: 'noa@example.com', created_at: '2026-09-01T00:00:00.000Z', expires_at: '2026-09-01T00:15:00.000Z' });
    t.db.insert('tokens', { token_hash: 'new', kind: 'magic', email: 'noa@example.com', created_at: '2026-10-20T00:00:00.000Z', expires_at: '2026-10-20T00:15:00.000Z' });
    const s = (exp, extra = {}) => t.db.insert('sessions', { id_hash: `s${Math.random()}`, user_id: u.id, created_at: '2026-06-01T00:00:00.000Z', last_seen_at: '2026-06-01T00:00:00.000Z', expires_at: exp, ...extra });
    s('2026-07-01T00:00:00.000Z');
    s('2026-12-01T00:00:00.000Z', { revoked_at: '2026-07-10T00:00:00.000Z' });
    s('2026-10-01T00:00:00.000Z');
    const r = await t.run('2026-10-22T08:00:00.000Z');
    assert.deepEqual([r.retention.signups, r.retention.links, r.retention.sessions], [1, 1, 2]);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM signups').n, 2);
    assert.deepEqual(t.db.all('SELECT token_hash FROM tokens').map((x) => x.token_hash), ['new']);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM sessions').n, 1);
  } finally {
    t.cleanup();
  }
});

test('a workspace nobody used for six months and nobody paid for: its owners warned, then deleted 14 days later through every product', async () => {
  const t = setup();
  try {
    setNow('2026-01-10T10:00:00.000Z');
    const idle = makeWorkspace(t.db, 'idle-shop', { name: 'Idle Shop', products: ['teder', 'toran'], members: { 'idle@example.com': 'client_owner' } });
    for (const p of ['teder', 'toran']) ensureSubscription(t.db, idle.id, p);
    t.db.run('UPDATE workspaces SET created_at = ? WHERE id = ?', '2026-01-10T10:00:00.000Z', idle.id);
    // Kept: complimentary, paid once, and one someone signs in to.
    const comp = makeWorkspace(t.db, 'comp-shop', { products: ['teder'], comp: true, members: { 'comp@example.com': 'client_owner' } });
    const paid = makeWorkspace(t.db, 'paid-shop', { products: ['teder'], members: { 'paid@example.com': 'client_owner' } });
    ensureSubscription(t.db, paid.id, 'teder');
    payMonth(t.db, paid.id, 'teder', { by: null });
    const back = makeWorkspace(t.db, 'back-shop', { name: 'Back Shop', products: ['teder'], members: { 'back@example.com': 'client_owner' } });
    for (const w of [comp, paid, back]) t.db.run('UPDATE workspaces SET created_at = ? WHERE id = ?', '2026-01-10T10:00:00.000Z', w.id);

    // Five and a half months: nothing yet.
    let r = await t.run('2026-06-20T08:00:00.000Z');
    assert.equal(r.retention.idleWarned, 0);
    // Unused for six months less 14 days (since 10.1, the day they opened): the owners of the two unused ones are warned.
    r = await t.run('2026-06-28T08:00:00.000Z');
    assert.equal(r.retention.idleWarned, 2);
    assert.deepEqual(idleWorkspaces(t.db, '2026-01-11T00:00:00.000Z').map((w) => w.id).sort(), [idle.id, back.id].sort());
    const warn = t.mails.find((m) => m.to === 'idle@example.com');
    assert.equal(warn.subject, 'החשבון של Idle Shop יימחק ב-14 הימים הקרובים');
    assert.match(warn.text, /אף אחד לא נכנס אליו כבר חצי שנה, ולא שולם בו מנוי\. לפי מדיניות הפרטיות שלנו, ב-12\.7\.2026 נמחק אותו/);
    assert.equal(warn.link, 'https://accounts.openfrequency.co.il/login');
    // Someone at Back Shop signs in: off the list.
    setNow('2026-07-01T09:00:00.000Z');
    createSession(t.db, t.db.get("SELECT * FROM users WHERE email = 'back@example.com'"));

    // A product that does not delete its part: nothing deleted here, tried again the next day.
    t.eraser.answer = 'failed';
    r = await t.run('2026-07-12T08:00:00.000Z');
    assert.deepEqual([r.retention.idleDeleted, r.retention.idleFailed], [0, 1]);
    assert.equal(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', idle.id).deleted_at, null);
    t.eraser.answer = 'deleted';
    t.mails.length = 0;
    r = await t.run('2026-07-13T08:00:00.000Z');
    assert.equal(r.retention.idleDeleted, 1);
    assert.deepEqual(t.asked.at(-1), [idle.id, ['teder', 'toran']]);
    assert.ok(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', idle.id).deleted_at);
    assert.equal(t.db.get("SELECT 1 FROM users WHERE email = 'idle@example.com'"), null);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'workspace_deleted' AND workspace_id = ? AND detail_json LIKE '%retention%'", idle.id));
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['boss@example.com', 'חשבון אחד נמחק כי לא היה בו שימוש']]);
    // The others stay.
    for (const w of [comp, paid, back]) assert.equal(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', w.id).deleted_at, null);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM retention_notices').n, 0);
  } finally {
    t.cleanup();
  }
});

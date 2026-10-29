import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { setNow } from '../src/core/clock.js';
import { createSession } from '../src/auth/sessions.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { cancelSubscription } from '../src/accounts/entitlement.js';
import { billingKind, idleWorkspaces, lastRuns, runDaily } from '../src/web/daily.js';

// The daily jobs (src/web/daily.js): the billing emails before and when a payment falls due and when the grace ends
// (ACC-01), each once, with the operator told of the last two; and the deletions the privacy policy promises (ACC-07,
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

test('which billing email a day owes: a week before, the day before, the day it falls due and the 14 days of grace, then stopped', () => {
  const k = (today) => billingKind('2026-11-21', today);
  assert.equal(k('2026-11-14'), null);
  assert.equal(k('2026-11-15'), 'soon7');
  assert.equal(k('2026-11-20'), 'soon7');
  assert.equal(k('2026-11-21'), 'soon1');
  assert.equal(k('2026-11-22'), 'due');
  assert.equal(k('2026-12-06'), 'due');
  assert.equal(k('2026-12-07'), 'stopped');
  assert.equal(k('2026-12-15'), null);
});

test('the billing emails: each kind once for each paid period, to the owners, the operator told when it is due and when it stops', async () => {
  const t = setup();
  try {
    const ws = makeWorkspace(t.db, 'noa-shop', { name: 'Noa Shop', products: ['teder'], members: { 'noa@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
    ensureSubscription(t.db, ws.id, 'teder');
    payMonth(t.db, ws.id, 'teder', { by: null }); // paid until 21.11.2026
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
    assert.deepEqual(r.billing, { soon7: 1, soon1: 0, due: 0, stopped: 0 });
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'התשלום הבא על תדר: 22.11.2026']]);
    assert.match(t.mails[0].text, /החודש הבא של תדר בחשבון של Noa Shop מתחיל ב-22\.11\.2026\. הסכום: 790 ₪ ועוד מע״מ\./);
    assert.match(t.mails[0].text, /התשלום באתר עוד לא פתוח\.[^]*איך משלמים: העברה בנקאית/);
    assert.equal(t.mails[0].link, 'https://accounts.openfrequency.co.il/setup');
    // Once a day; and the same kind is never sent twice, the next day included.
    assert.equal((await t.run('2026-11-15T12:00:00.000Z')).ran, false);
    await t.run('2026-11-16T08:00:00.000Z');
    assert.equal(t.mails.length, 1);

    await t.run('2026-11-21T08:00:00.000Z');
    assert.equal(t.mails.at(-1).subject, 'התשלום הבא על תדר: 22.11.2026');
    t.mails.length = 0;
    await t.run('2026-11-22T08:00:00.000Z');
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'התשלום על תדר עוד לא הגיע'], ['boss@example.com', 'תשלום לא הגיע: Noa Shop, תדר']]);
    assert.match(t.mails[0].text, /תדר ממשיך לעבוד עד 6\.12\.2026\. אם התשלום לא יגיע עד אז, תדר ייעצר עד שישולם\. שום דבר לא נמחק\./);
    assert.equal(t.mails[1].link, `https://accounts.openfrequency.co.il/admin/accounts#ws-${ws.id}`);
    t.mails.length = 0;
    await t.run('2026-12-07T08:00:00.000Z');
    assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [['noa@example.com', 'תדר נעצר עד שהתשלום יגיע'], ['boss@example.com', 'נעצר על תשלום: Noa Shop, תדר']]);
    // Each one in the audit log, with how many it went to.
    assert.deepEqual(t.db.all("SELECT action FROM audit WHERE action LIKE 'billing_%' ORDER BY id").map((a) => a.action), ['billing_soon7', 'billing_soon1', 'billing_due', 'billing_stopped']);

    // A payment moves the period on, and its emails follow it.
    t.mails.length = 0;
    payMonth(t.db, ws.id, 'teder', { by: null }); // from 7.12: paid until 6.1.2027
    await t.run('2026-12-31T08:00:00.000Z');
    assert.deepEqual(t.mails.map((m) => m.subject), ['התשלום הבא על תדר: 7.1.2027']);
    assert.ok(lastRuns(t.db)[0].finished_at);
  } finally {
    t.cleanup();
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

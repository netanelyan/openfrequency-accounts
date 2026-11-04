import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { linkPhone, makeUser, makeWorkspace, tempHome } from './helpers.js';
import { TOKEN } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ROOT } from '../src/core/paths.js';
import { addDays, ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { setConsent } from '../src/accounts/phones.js';
import { runDaily } from '../src/web/daily.js';

// The payment reminders on WhatsApp (the owner, 2026-11-03: "add a reminder to pay for the new month, whatsapp, email
// and dashboard. A user has 72 hours to pay for a new month once their subscription has ended"): the daily run hands
// soon1, due and last to Toran (POST /internal/pay/remind, docs/contracts/pay-remind.json), once each, for each number
// the workspace's owners linked, after the emails, which go whatever Toran does. Toran is a stand-in on 127.0.0.1 here;
// the numbers are fictional (050-000-0xxx).

const CONTRACT = JSON.parse(readFileSync(path.join(ROOT, 'docs', 'contracts', 'pay-remind.json'), 'utf8'));
const EXAMPLE = CONTRACT.routes[0].request.body;
const ENV = { OF_SIGNUP_NOTIFY: 'boss@example.com', PUBLIC_HOST: 'accounts.openfrequency.co.il', OF_PAYMENT_METHOD: 'העברה בנקאית', OF_INTERNAL_TOKEN: TOKEN };
const NOA = '972500000123';
const RON = '972500000124';
const DAN = '972500000125';
const GAL = '972500000126';
const T0 = '2026-10-22T07:00:00.000Z';

/**
 * Toran's route as a stand-in: every request kept in `calls` and in `order`; answered 200 sent, or as `answer` says
 * ({ status, body }); `hang` never answers; close() stops it, so a connection after is refused.
 */
async function fakeToran(order) {
  const calls = [];
  const state = { answer: null, queue: [], hang: false };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const call = { method: req.method, path: req.url, auth: req.headers.authorization || null, type: req.headers['content-type'] || null, body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    order.push(['whatsapp', call.body?.phone, call.body?.kind]);
    if (state.hang) return;
    const a = state.queue.length ? { status: 200, body: state.queue.shift() } : state.answer || { status: 200, body: { ok: true, sent: true, why: null } };
    res.writeHead(a.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(a.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, state, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

async function setup(env = {}) {
  const h = tempHome();
  setNow(T0);
  const order = [];
  const toran = await fakeToran(order);
  const mails = [];
  const logs = [];
  const mailer = { send: (m) => (mails.push(m), order.push(['email', m.to, m.subject])) };
  const eraser = { erase: async (id, products) => ({ results: Object.fromEntries(products.map((p) => [p, 'deleted'])), ok: true, failed: [] }) };
  const fullEnv = { ...ENV, OF_TORAN_INTERNAL: toran.url, ...env };
  const run = (at, extra = {}) => (setNow(at), runDaily(h.db, { env: fullEnv, mailer, eraser, log: (m) => logs.push(String(m)), ...extra }));
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  /** A workspace paid until 21.11.2026 (a Saturday), its owner's number linked, and a member's. */
  const shop = (slug, { name = 'Noa Shop', products = ['teder'], terms, owner = `${slug}@example.com`, phone = null, member = null, memberPhone = null } = {}) => {
    setNow(T0);
    const ws = makeWorkspace(h.db, slug, { name, products, members: { [owner]: 'client_owner', ...(member ? { [member]: 'client_member' } : {}) }, ...(terms !== undefined ? { terms } : {}) });
    for (const p of products) {
      ensureSubscription(h.db, ws.id, p);
      payMonth(h.db, ws.id, p, { by: null });
    }
    if (phone) linkPhone(h.db, phone, user(owner), ws);
    if (member && memberPhone) linkPhone(h.db, memberPhone, user(member), ws);
    return ws;
  };
  const done = async () => (await toran.close(), h.cleanup());
  return { ...h, toran, mails, logs, order, run, shop, user, done };
}

/** Run every morning from `from` to `to`; each call to Toran is marked with its day. */
async function days(t, from, to, extra) {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = t.toran.calls.length;
    await t.run(`${d}T07:00:00.000Z`, extra);
    for (const c of t.toran.calls.slice(n)) c.day = d;
  }
}
/** What Toran was handed, as [day, kind, phone, products, graceUntil]. */
const handed = (t) => t.toran.calls.map((c) => [c.day, c.body.kind, c.body.phone, c.body.products.join('+'), c.body.graceUntil]);
const subjects = (t, to) => t.mails.filter((m) => m.to === to).map((m) => m.subject);
const noFullNumber = (t) => {
  const all = t.logs.join('\n') + JSON.stringify(t.db.all("SELECT detail_json FROM audit WHERE action = 'billing_whatsapp'"));
  for (const n of [NOA, RON, DAN, GAL]) assert.ok(!all.includes(n), `${n} in full in the log or the audit:\n${all}`);
};

test("soon1, due and last once each, to the owners' linked numbers, as the contract has it, after the emails; never soon7 or stopped, a member's or an opted-out number", async () => {
  const t = await setup();
  try {
    const ws = t.shop('noa-shop', { owner: 'noa@example.com', phone: NOA, member: 'ron@example.com', memberPhone: RON });
    // A second owner, whose number said "הפסק" on WhatsApp: the emails, and no reminder to that number.
    const dan = makeUser(t.db, 'dan@example.com');
    t.db.insert('memberships', { user_id: dan.id, workspace_id: ws.id, role: 'client_owner', created_at: T0 });
    linkPhone(t.db, DAN, dan, ws);
    setNow('2026-11-01T07:00:00.000Z');
    setConsent(t.db, DAN, { optIn: false, source: 'whatsapp' });

    await days(t, '2026-11-13', '2026-12-02');
    assert.deepEqual(handed(t), [
      ['2026-11-21', 'soon1', NOA, 'teder', '2026-11-24'],
      ['2026-11-22', 'due', NOA, 'teder', '2026-11-24'],
      ['2026-11-24', 'last', NOA, 'teder', '2026-11-24'],
    ]);
    const code = t.db.get('SELECT code FROM pay_codes WHERE workspace_id = ?', ws.id).code;
    assert.match(code, /^PAY-[A-Z2-9]{6}$/, "the workspace's payment code, the button's payload");
    for (const c of t.toran.calls) {
      assert.deepEqual([c.method, c.path, c.auth, c.type], ['POST', '/internal/pay/remind', `Bearer ${TOKEN}`, 'application/json']);
      assert.deepEqual(Object.keys(c.body).sort(), Object.keys(EXAMPLE).sort(), "the contract's fields");
      for (const k of Object.keys(EXAMPLE)) assert.equal(Array.isArray(c.body[k]) ? 'array' : typeof c.body[k], Array.isArray(EXAMPLE[k]) ? 'array' : typeof EXAMPLE[k], k);
      assert.deepEqual({ ...c.body, kind: null }, { workspace: ws.id, phone: NOA, kind: null, business: 'Noa Shop', products: ['teder'], paidUntil: '2026-11-21', graceUntil: '2026-11-24', code });
    }
    // The emails as before, to both owners: each kind once.
    const owner = ['התשלום הבא על תדר: 22.11.2026', 'התשלום הבא על תדר: 22.11.2026', 'התשלום על החודש החדש של תדר עוד לא הגיע', 'תדר ייעצר מחר אם התשלום לא יגיע היום', 'תדר נעצר עד שהתשלום יגיע'];
    assert.deepEqual(subjects(t, 'noa@example.com'), owner);
    assert.deepEqual(subjects(t, 'dan@example.com'), owner);
    // Each day's reminder after that day's emails.
    for (const kind of ['soon1', 'due', 'last']) {
      const wa = t.order.findIndex((o) => o[0] === 'whatsapp' && o[2] === kind);
      const mail = t.order.findLastIndex((o, i) => i < wa && o[0] === 'email' && o[1] === 'noa@example.com');
      assert.ok(mail >= 0 && t.order.slice(mail + 1, wa).every((o) => o[0] === 'email'), `${kind}: the emails first`);
    }
    assert.equal(t.db.get(`SELECT COUNT(*) AS n FROM audit WHERE action = 'billing_whatsapp' AND detail_json LIKE '%"outcome":"sent"%' AND detail_json LIKE '%"phone":"…0123"%'`).n, 3);
    assert.ok(t.logs.some((l) => l.includes('WhatsApp reminders {"sent":1,"notSent":0,"notTried":0}')), "the day's line counts it");

    // The day run again (its row gone, as `npm run daily -- --again` does): nothing handed over twice.
    t.db.run('DELETE FROM daily_runs');
    await t.run('2026-11-24T12:00:00.000Z');
    assert.equal(t.toran.calls.length, 3);
    noFullNumber(t);
  } finally {
    await t.done();
  }
});

test('no linked number: the emails, and nothing asked of Toran; without the transfer details or with a provider, a line in the log and no reminder', async () => {
  const t = await setup();
  try {
    t.shop('quiet-shop', { owner: 'quiet@example.com' });
    // A member's number alone is no owner's.
    t.shop('member-shop', { owner: 'own@example.com', member: 'mem@example.com', memberPhone: RON });
    await days(t, '2026-11-20', '2026-11-25');
    assert.deepEqual(t.toran.calls, []);
    assert.equal(subjects(t, 'quiet@example.com').length, 5, 'soon7, soon1, due, last, stopped');
    assert.ok(!t.logs.some((l) => /Toran did not take|Toran said|would also go on WhatsApp/.test(l)), t.logs.join('\n'));
  } finally {
    await t.done();
  }
  const cases = [
    [{ OF_PAYMENT_METHOD: '' }, /^\[accounts\] daily: 1 of today's billing emails would also go on WhatsApp, and none does: OF_PAYMENT_METHOD is unset/],
    [{ OF_PAYMENT: 'provider', OF_PAYMENT_URL: 'https://pay.example.com/openfrequency' }, /^\[accounts\] daily: 1 of today's billing emails would also go on WhatsApp, and none does: with a payment provider on/],
    [{ OF_INTERNAL_TOKEN: '' }, /^\[accounts\] daily: WhatsApp reminder to …0123 \(workspace \d+, soon1\): Toran did not take it \(OF_INTERNAL_TOKEN is not set\)/],
  ];
  for (const [env, line] of cases) {
    const u = await setup(env);
    try {
      u.shop('noa-shop', { owner: 'noa@example.com', phone: NOA });
      await days(u, '2026-11-21', '2026-11-22');
      assert.deepEqual(u.toran.calls, [], JSON.stringify(env));
      assert.equal(subjects(u, 'noa@example.com').length, 2, 'soon1 and due, by email');
      assert.ok(u.logs.some((l) => line.test(l)), u.logs.join('\n'));
    } finally {
      await u.done();
    }
  }
});

test('Toran down or refusing the request: the emails go, one line in the log, the rest of that run not tried, nothing sent again; Toran held or failed: the next is tried', async () => {
  const t = await setup();
  try {
    for (const [slug, phone] of [['noa-shop', NOA], ['gal-shop', GAL], ['dan-shop', DAN]]) t.shop(slug, { owner: `${slug}@example.com`, phone });
    // 21.11, soon1: Toran is down (nothing listens). One try, one line; the other two not tried.
    await t.toran.close();
    await t.run('2026-11-21T07:00:00.000Z');
    assert.deepEqual(t.toran.calls, []);
    const down = t.logs.filter((l) => /Toran did not take it/.test(l));
    assert.equal(down.length, 1, t.logs.join('\n'));
    assert.match(down[0], /^\[accounts\] daily: WhatsApp reminder to …0123 \(workspace \d+, soon1\): Toran did not take it \(ECONNREFUSED\); the email went as always, and the 2 other WhatsApp reminders of today are not tried\. None is sent again later$/);
    for (const slug of ['noa-shop', 'gal-shop', 'dan-shop']) assert.deepEqual(subjects(t, `${slug}@example.com`), ['התשלום הבא על תדר: 22.11.2026'], `${slug}: the email`);
    assert.ok(t.logs.some((l) => l.includes('WhatsApp reminders {"sent":0,"notSent":0,"notTried":3}')));

    // 22.11, due: Toran is back, and answers 503 (its token unset): the same, and nothing of 21.11 again.
    const back = await fakeToran(t.order);
    const env = { ...ENV, OF_TORAN_INTERNAL: back.url };
    try {
      back.state.answer = { status: 503, body: { error: 'not_configured' } };
      t.logs.length = 0;
      await t.run('2026-11-22T07:00:00.000Z', { env });
      assert.deepEqual(back.calls.map((c) => c.body.kind), ['due'], 'one try, the due of 22.11 only');
      assert.ok(t.logs.some((l) => /WhatsApp reminder to …0123 \(workspace \d+, due\): Toran did not take it \(503 not_configured\)/.test(l)), t.logs.join('\n'));
      for (const slug of ['noa-shop', 'gal-shop', 'dan-shop']) assert.equal(subjects(t, `${slug}@example.com`).at(-1), 'התשלום על החודש החדש של תדר עוד לא הגיע', `${slug}: the email`);

      // 23.11: nothing is owed, nothing asked. 24.11, last: Toran holds the first (a phone's limit) and failed the second
      // (Meta refused it): each a line, and the next still tried; the third sent.
      await t.run('2026-11-23T07:00:00.000Z', { env });
      assert.equal(back.calls.length, 1, 'nothing on 23.11');
      back.state.answer = null;
      back.state.queue = [{ ok: true, sent: false, why: 'held' }, { ok: true, sent: false, why: 'failed' }];
      t.logs.length = 0;
      await t.run('2026-11-24T07:00:00.000Z', { env });
      assert.deepEqual(back.calls.slice(1).map((c) => [c.body.kind, c.body.phone]), [['last', NOA], ['last', GAL], ['last', DAN]], 'every one tried');
      assert.equal(t.logs.filter((l) => /^\[accounts\] daily: WhatsApp reminder to …\d{4} \(workspace \d+, last\) not sent: Toran said (held|failed); the email went as always$/.test(l)).length, 2, t.logs.join('\n'));
      assert.ok(t.logs.some((l) => l.includes('WhatsApp reminders {"sent":1,"notSent":2,"notTried":0}')));
      // And never again: the days after ask nothing.
      await days(t, '2026-11-25', '2026-11-28', { env });
      assert.equal(back.calls.length, 4);
    } finally {
      await back.close();
    }
    noFullNumber(t);
  } finally {
    await t.done();
  }
});

test('Toran slow: no answer in the time allowed is a line, the run goes on to its end', async () => {
  const { remindClient } = await import('../src/web/remind.js');
  const t = await setup();
  try {
    t.shop('noa-shop', { owner: 'noa@example.com', phone: NOA });
    t.shop('gal-shop', { owner: 'gal@example.com', phone: GAL });
    t.toran.state.hang = true;
    const reminder = remindClient({ env: { ...ENV, OF_TORAN_INTERNAL: t.toran.url }, timeoutMs: 300 });
    const r = await t.run('2026-11-21T07:00:00.000Z', { reminder });
    assert.equal(r.ran, true);
    assert.equal(t.toran.calls.length, 1, 'one try, then none');
    assert.ok(t.logs.some((l) => /Toran did not take it \(no answer in 0\.3 seconds\); the email went as always, and the 1 other WhatsApp reminder of today is not tried/.test(l)), t.logs.join('\n'));
    assert.deepEqual(subjects(t, 'gal@example.com'), ['התשלום הבא על תדר: 22.11.2026']);
    assert.ok(t.db.get('SELECT finished_at FROM daily_runs WHERE day = ?', '2026-11-21').finished_at, 'the run finished');
  } finally {
    await t.done();
  }
});

test("the older terms: the dates are accounts' own rule, 14 days from the day it fell due, and both products in one message", async () => {
  const t = await setup();
  try {
    // On the terms from before 2026-11-03, never told of the change (the stand-in mailer cannot say an email went), so
    // the 14 days: paid until 21.11, due from 22.11, working until the end of 6.12.
    t.shop('old-shop', { name: 'Old Shop', terms: null, owner: 'old@example.com', phone: NOA, products: ['teder', 'toran'] });
    await days(t, '2026-11-20', '2026-12-08');
    assert.deepEqual(handed(t), [
      ['2026-11-21', 'soon1', NOA, 'teder+toran', '2026-12-06'],
      ['2026-11-22', 'due', NOA, 'teder+toran', '2026-12-06'],
      ['2026-12-06', 'last', NOA, 'teder+toran', '2026-12-06'],
    ]);
    // The email of the same day names the same last day.
    const due = t.mails.find((m) => m.to === 'old@example.com' && m.subject === 'התשלום על החודש החדש של תדר עוד לא הגיע');
    assert.match(due.text, /תדר ממשיך לעבוד עד סוף יום ראשון, 6\.12\.2026\./);
    assert.equal(subjects(t, 'old@example.com').filter((s) => s.startsWith('תורן ייעצר')).length, 1, 'each product still has its own email');
  } finally {
    await t.done();
  }
});

test('the number a workspace last paid from gets them too: its latest receipt marked paid, never a waiting or refused one, never after an opt-out, one message with a linked number; Toran\'s "stopped" a line', async () => {
  const t = await setup();
  const [ONE, TWO, THREE, FOUR, FIVE] = ['972500000127', '972500000128', '972500000129', '972500000130', '972500000131'];
  try {
    /** A receipt from `phone`, decided `decision` ('paid', 'not_paid', or null: still waiting) at `at`. */
    const receipt = (ws, phone, decision, at) =>
      t.db.insert('pay_receipts', { workspace_id: ws.id, code: 'PAY-AB2CD3', phone, created_at: at, name: 'shot.png', type: 'image/png', size: 8, file: null, items_json: '{}', decided_at: decision ? at : null, decision });
    // Paid from a number nobody linked: it gets them.
    const only = t.shop('only-paid', { owner: 'only@example.com' });
    receipt(only, GAL, 'paid', '2026-10-22T08:00:00.000Z');
    // The owner's linked number is the one it paid from: one message, not two.
    const both = t.shop('both-shop', { owner: 'both@example.com', phone: NOA });
    receipt(both, NOA, 'paid', '2026-10-22T08:00:00.000Z');
    // Paid from DAN; since then, a picture from RON marked "לא הגיע" and one from ONE still waiting: DAN alone.
    const later = t.shop('later-shop', { owner: 'later@example.com' });
    receipt(later, DAN, 'paid', '2026-10-22T08:00:00.000Z');
    receipt(later, RON, 'not_paid', '2026-10-23T08:00:00.000Z');
    receipt(later, ONE, null, '2026-10-24T08:00:00.000Z');
    // Paid twice, from THREE and then from FOUR: the latest, FOUR.
    const twice = t.shop('twice-shop', { owner: 'twice@example.com' });
    receipt(twice, THREE, 'paid', '2026-10-01T08:00:00.000Z');
    receipt(twice, FOUR, 'paid', '2026-10-22T08:00:00.000Z');
    // Paid from the owner's linked number, which then said "הפסק": nothing to it, as linked or as paid from.
    const stopped = t.shop('stopped-shop', { owner: 'stopped@example.com', phone: TWO });
    receipt(stopped, TWO, 'paid', '2026-10-22T08:00:00.000Z');
    setNow('2026-11-01T07:00:00.000Z');
    setConsent(t.db, TWO, { optIn: false, source: 'whatsapp' });
    // Only waiting and refused receipts, nothing linked: email alone.
    const none = t.shop('none-shop', { owner: 'none@example.com' });
    receipt(none, FIVE, 'not_paid', '2026-10-22T08:00:00.000Z');
    receipt(none, FIVE, null, '2026-10-23T08:00:00.000Z');

    await days(t, '2026-11-21', '2026-11-25');
    const by = (ws) => t.toran.calls.filter((c) => c.body.workspace === ws.id).map((c) => [c.day, c.body.kind, c.body.phone]);
    assert.deepEqual(by(only), [['2026-11-21', 'soon1', GAL], ['2026-11-22', 'due', GAL], ['2026-11-24', 'last', GAL]]);
    assert.deepEqual(by(both), [['2026-11-21', 'soon1', NOA], ['2026-11-22', 'due', NOA], ['2026-11-24', 'last', NOA]], 'one message a kind');
    assert.deepEqual(by(later), [['2026-11-21', 'soon1', DAN], ['2026-11-22', 'due', DAN], ['2026-11-24', 'last', DAN]]);
    assert.deepEqual(by(twice).map((c) => c[2]), [FOUR, FOUR, FOUR]);
    assert.deepEqual(by(stopped), []);
    assert.deepEqual(by(none), []);
    for (const email of ['stopped@example.com', 'none@example.com']) assert.equal(subjects(t, email).length, 4, `${email}: soon1, due, last, stopped by email`);
    // Why each number was on the list, in the audit log.
    const via = t.db.all("SELECT workspace_id, detail_json FROM audit WHERE action = 'billing_whatsapp' AND detail_json LIKE '%\"kind\":\"due\"%' ORDER BY id").map((r) => [r.workspace_id, JSON.parse(r.detail_json).via]);
    assert.deepEqual(via, [[only.id, ['paid']], [both.id, ['linked', 'paid']], [later.id, ['paid']], [twice.id, ['paid']]]);

    // "הפסק" from a number accounts knows only by its receipt is Toran's to keep: it answers stopped, a line here.
    t.toran.state.queue = [{ ok: true, sent: false, why: 'stopped' }];
    t.logs.length = 0;
    t.db.run("UPDATE subscriptions SET paid_until = '2026-12-21' WHERE workspace_id = ?", only.id);
    await t.run('2026-12-21T07:00:00.000Z');
    assert.deepEqual(t.toran.calls.at(-1).body.phone, GAL);
    assert.ok(t.logs.some((l) => new RegExp(`^\\[accounts\\] daily: WhatsApp reminder to …0126 \\(workspace ${only.id}, soon1\\) not sent: Toran said stopped; the email went as always$`).test(l)), t.logs.join('\n'));
    const all = t.logs.join('\n') + JSON.stringify(t.db.all("SELECT detail_json FROM audit WHERE action = 'billing_whatsapp'"));
    for (const n of [GAL, NOA, DAN, RON, ONE, TWO, THREE, FOUR, FIVE]) assert.ok(!all.includes(n), `${n} in full`);
  } finally {
    await t.done();
  }
});

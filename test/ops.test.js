import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { listen } from '../src/web/server.js';
import { advance, setNow, HOUR } from '../src/core/clock.js';
import { createSession } from '../src/auth/sessions.js';
import { acceptInvite, createInvite } from '../src/accounts/links.js';
import { setDisabled } from '../src/accounts/workspaces.js';
import { opsCustomers, opsSubscription } from '../src/accounts/ops.js';

// GET /internal/ops/customers over real HTTP, as Toran's operator dashboard calls it (docs/internal-ops.md).

const TOKEN = 'internal-token-for-tests-only-0123456789';
const PATH = '/internal/ops/customers';

async function setup(env = { OF_INTERNAL_TOKEN: TOKEN }) {
  const h = tempHome();
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true });
  const s = await listen(h.db, { env, port: 0, internalPort: 0 });
  const ask = ({ token = TOKEN, headers = {}, method = 'GET', port = s.internalPort, path = PATH } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
      });
      req.on('error', reject);
      req.end();
    });
  return { ...h, admin, s, ask, done: async () => (await s.close(), h.cleanup()) };
}

const sub = (db, workspaceId, product, row) =>
  db.insert('subscriptions', { workspace_id: workspaceId, product, monthly: 449, vat: 'excluded', setup: 990, started_on: '2026-10-01', updated_at: '2026-10-01T09:00:00.000Z', ...row });

const invoice = (db, workspaceId, issued_on) =>
  db.insert('invoices', { workspace_id: workspaceId, product: 'toran', number: `INV-${issued_on}`, issued_on, amount: 449, vat: 80.82, pdf: Buffer.from('%PDF-1.4'), created_at: `${issued_on}T09:00:00.000Z` });

test('the operator gets every workspace, newest first, in the documented shape, never cached', async () => {
  const t = await setup();
  try {
    setNow('2026-10-24T10:00:00.000Z');
    const old = makeWorkspace(t.db, 'old-shop', { products: ['teder'] });
    t.db.update('workspaces', old.id, { created_at: '2026-09-01T09:00:00.000Z' });
    const dana = makeWorkspace(t.db, 'dana-shop', { name: 'Dana Shop', products: ['toran', 'teder'], members: { 'dana@example.com': 'client_owner' } });
    t.db.update('workspaces', dana.id, { created_at: '2026-10-01T09:00:00.000Z' });
    sub(t.db, dana.id, 'toran', { paid_until: '2026-10-31' });
    invoice(t.db, dana.id, '2026-09-15');
    invoice(t.db, dana.id, '2026-10-01');

    const r = await t.ask();
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.deepEqual(Object.keys(r.body).sort(), ['today', 'workspaces']);
    assert.equal(r.body.today, '2026-10-24');
    assert.deepEqual(r.body.workspaces.map((w) => w.slug), ['dana-shop', 'old-shop']);
    assert.deepEqual(r.body.workspaces[0], {
      id: dana.id,
      slug: 'dana-shop',
      name: 'Dana Shop',
      disabled: false,
      createdAt: '2026-10-01T09:00:00.000Z',
      products: ['teder', 'toran'],
      people: 1,
      invitesWaiting: 0,
      lastLoginAt: null,
      subscriptions: [
        { product: 'toran', monthly: 449, vat: 'excluded', setup: 990, startedOn: '2026-10-01', paidUntil: '2026-10-31', endsOn: null, state: 'paid', nextChargeOn: '2026-11-01' },
      ],
      invoices: { count: 2, lastIssuedOn: '2026-10-01' },
    });
    assert.deepEqual(r.body.workspaces[1].invoices, { count: 0, lastIssuedOn: null });
    assert.deepEqual(r.body.workspaces[1].subscriptions, []);
  } finally {
    await t.done();
  }
});

test('today is the Israel date, not the UTC one', async () => {
  const t = await setup();
  try {
    setNow('2026-10-24T22:30:00.000Z'); // 01:30 on the 25th in Israel
    assert.equal(opsCustomers(t.db).today, '2026-10-25');
  } finally {
    await t.done();
  }
});

test('each state, as the home page works it out', () => {
  const today = '2026-10-24';
  const row = (r) => ({ product: 'toran', monthly: 449, vat: 'excluded', setup: 990, started_on: '2026-10-01', paid_until: null, ends_on: null, ...r });
  const cases = [
    [{ paid_until: '2026-10-31' }, 'paid', '2026-11-01'],
    [{ paid_until: '2026-10-24' }, 'paid', '2026-10-25'],
    [{}, 'waiting', null],
    [{ paid_until: '2026-10-23' }, 'late', '2026-10-24'],
    [{ paid_until: '2026-10-31', ends_on: '2026-10-31' }, 'ending', null],
    [{ paid_until: '2026-10-31', ends_on: '2026-10-24' }, 'ending', null],
    [{ paid_until: '2026-10-31', ends_on: '2026-10-23' }, 'ended', null],
  ];
  for (const [r, state, nextChargeOn] of cases) {
    const s = opsSubscription(row(r), today);
    assert.deepEqual([s.state, s.nextChargeOn], [state, nextChargeOn], JSON.stringify(r));
  }
});

test('people are the members not disabled; invites are the ones still open', async () => {
  const t = await setup();
  try {
    setNow('2026-10-24T10:00:00.000Z');
    const w = makeWorkspace(t.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner', 'avi@example.com': 'client_member', 'gone@example.com': 'client_member' } });
    t.db.run("UPDATE users SET disabled_at = ? WHERE email = 'gone@example.com'", '2026-10-20T10:00:00.000Z');
    createInvite(t.db, { workspaceId: w.id, email: 'expired@example.com', role: 'client_member', by: t.admin });
    advance(73 * HOUR);
    const used = createInvite(t.db, { workspaceId: w.id, email: 'used@example.com', role: 'client_member', by: t.admin });
    acceptInvite(t.db, used.token);
    createInvite(t.db, { workspaceId: w.id, email: 'open1@example.com', role: 'client_member', by: t.admin });
    createInvite(t.db, { workspaceId: w.id, email: 'open2@example.com', role: 'client_owner', by: t.admin });

    const [got] = (await t.ask()).body.workspaces;
    // dana and avi, then used@ who joined by the invite; gone@ is disabled.
    assert.equal(got.people, 3);
    assert.equal(got.invitesWaiting, 2);
  } finally {
    await t.done();
  }
});

test('lastLoginAt is the latest sign-in of any member', async () => {
  const t = await setup();
  try {
    const w = makeWorkspace(t.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner', 'avi@example.com': 'client_member' } });
    makeWorkspace(t.db, 'other', { members: { 'eli@example.com': 'client_owner' } });
    const user = (email) => t.db.get('SELECT * FROM users WHERE email = ?', email);
    setNow('2026-10-23T18:00:00.000Z');
    createSession(t.db, user('avi@example.com'));
    setNow('2026-10-22T08:00:00.000Z');
    createSession(t.db, user('dana@example.com'));
    setNow('2026-10-24T09:00:00.000Z');
    createSession(t.db, user('eli@example.com'));
    createSession(t.db, t.admin, { workspaceId: null });

    const byId = Object.fromEntries((await t.ask()).body.workspaces.map((x) => [x.slug, x]));
    assert.equal(byId['dana-shop'].id, w.id);
    assert.equal(byId['dana-shop'].lastLoginAt, '2026-10-23T18:00:00.000Z');
    assert.equal(byId.other.lastLoginAt, '2026-10-24T09:00:00.000Z');
  } finally {
    await t.done();
  }
});

test('a disabled workspace is listed, with disabled true', async () => {
  const t = await setup();
  try {
    const w = makeWorkspace(t.db, 'closed-shop', { members: { 'dana@example.com': 'client_owner' } });
    setDisabled(t.db, w.id, true, { by: t.admin, reason: 'test' });
    const r = await t.ask();
    assert.equal(r.body.workspaces.length, 1);
    assert.equal(r.body.workspaces[0].slug, 'closed-shop');
    assert.equal(r.body.workspaces[0].disabled, true);
  } finally {
    await t.done();
  }
});

test('with only the superadmin, the list is empty', async () => {
  const t = await setup();
  try {
    setNow('2026-10-24T10:00:00.000Z');
    createSession(t.db, t.admin);
    const r = await t.ask();
    assert.deepEqual([r.status, r.body], [200, { today: '2026-10-24', workspaces: [] }]);
  } finally {
    await t.done();
  }
});

test('refused without the right token, from a wrong Host, by another method, and on the public listener', async () => {
  const t = await setup();
  try {
    makeWorkspace(t.db, 'dana-shop');
    for (const token of [null, '', 'wrong', `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      assert.deepEqual(await t.ask({ token }).then((r) => [r.status, r.body]), [401, { error: 'bad_token' }], String(token));
    }
    assert.equal((await t.ask({ token: null, headers: { authorization: `Basic ${TOKEN}` } })).status, 401);
    for (const host of ['accounts.openfrequency.co.il', `127.0.0.1:${t.s.internalPort + 1}`]) {
      assert.deepEqual(await t.ask({ headers: { host } }).then((r) => [r.status, r.body]), [403, { error: 'bad_host' }], host);
    }
    assert.equal((await t.ask({ method: 'POST' })).status, 405);
    assert.equal((await t.ask({ path: '/internal/ops/customer' })).status, 404);
    const pub = await new Promise((resolve) =>
      request({ host: '127.0.0.1', port: t.s.port, path: PATH, headers: { authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).end()
    );
    assert.equal(pub, 404);
  } finally {
    await t.done();
  }
  for (const env of [{}, { OF_INTERNAL_TOKEN: 'short' }]) {
    const t2 = await setup(env);
    try {
      assert.deepEqual((await t2.ask({ token: 'short' })).body, { error: 'not_configured' });
    } finally {
      await t2.done();
    }
  }
});

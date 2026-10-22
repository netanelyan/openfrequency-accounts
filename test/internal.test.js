import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { listen } from '../src/web/server.js';
import { createSession, revokeAllSessions, revokeSession } from '../src/auth/sessions.js';

// /internal/session over real HTTP, as Teder and Toran will call it.

const TOKEN = 'internal-token-for-tests-only-0123456789';

async function setup(env = { OF_INTERNAL_TOKEN: TOKEN }) {
  const h = tempHome();
  makeWorkspace(h.db, 'dana-shop', { products: ['teder'], members: { 'dana@example.com': 'client_owner' } });
  const dana = h.db.get("SELECT * FROM users WHERE email = 'dana@example.com'");
  const s = await listen(h.db, { env, port: 0, internalPort: 0 });
  const ask = (sid, { token = TOKEN, product, headers = {}, method = 'GET', port = s.internalPort, path } = {}) =>
    new Promise((resolve, reject) => {
      const q = product ? `?product=${product}` : '';
      const req = request(
        { host: '127.0.0.1', port, method, path: path || `/internal/session${q}`, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(sid ? { 'x-of-session': sid } : {}), ...headers } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  return { ...h, dana, s, ask, done: async () => (await s.close(), h.cleanup()) };
}

test('a live session is answered with the documented shape, never cached', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    const r = await t.ask(id, { product: 'teder' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.deepEqual(Object.keys(r.body).sort(), ['expiresAt', 'products', 'readOnly', 'role', 'user', 'viewAs', 'workspace']);
    assert.equal(r.body.user.email, 'dana@example.com');
    assert.equal(r.body.workspace.slug, 'dana-shop');
    assert.equal(r.body.role, 'client_owner');
  } finally {
    await t.done();
  }
});

test('signing out is seen by the very next call, on one device or all of them', async () => {
  const t = await setup();
  try {
    const a = createSession(t.db, t.dana).id;
    const b = createSession(t.db, t.dana).id;
    const c = createSession(t.db, t.dana).id;
    assert.equal((await t.ask(a)).status, 200);
    revokeSession(t.db, a);
    assert.deepEqual((await t.ask(a)).body, { error: 'no_session' });
    assert.equal((await t.ask(b)).status, 200);
    revokeAllSessions(t.db, t.dana.id);
    assert.equal((await t.ask(b)).status, 401);
    assert.equal((await t.ask(c)).status, 401);
  } finally {
    await t.done();
  }
});

test('?product= refuses a workspace without that product, and an unknown product', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    assert.equal((await t.ask(id, { product: 'teder' })).status, 200);
    assert.deepEqual(await t.ask(id, { product: 'toran' }).then((r) => [r.status, r.body]), [403, { error: 'product_disabled' }]);
    assert.deepEqual(await t.ask(id, { product: 'other' }).then((r) => [r.status, r.body]), [400, { error: 'bad_product' }]);
  } finally {
    await t.done();
  }
});

test('the bearer token is required and compared exactly', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    for (const token of [null, '', 'wrong', `${TOKEN}x`, TOKEN.slice(0, -1), TOKEN.toUpperCase()]) {
      const r = await t.ask(id, { token });
      assert.deepEqual([r.status, r.body], [401, { error: 'bad_token' }], String(token));
    }
    const basic = await t.ask(id, { token: null, headers: { authorization: `Basic ${TOKEN}` } });
    assert.equal(basic.status, 401);
  } finally {
    await t.done();
  }
});

test('with OF_INTERNAL_TOKEN unset or short, every request is refused', async () => {
  for (const env of [{}, { OF_INTERNAL_TOKEN: 'short' }]) {
    const t = await setup(env);
    try {
      const { id } = createSession(t.db, t.dana);
      // Not even the right-looking empty token gets through.
      for (const token of [null, '', 'short']) assert.deepEqual((await t.ask(id, { token })).body, { error: 'not_configured' });
    } finally {
      await t.done();
    }
  }
});

test('a Host that is not loopback is refused (DNS rebinding)', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    for (const host of ['accounts.openfrequency.co.il', 'evil.example', `127.0.0.1:${t.s.internalPort + 1}`, `localhost.evil.example:${t.s.internalPort}`]) {
      const r = await t.ask(id, { headers: { host } });
      assert.deepEqual([r.status, r.body], [403, { error: 'bad_host' }], host);
    }
    assert.equal((await t.ask(id, { headers: { host: `localhost:${t.s.internalPort}` } })).status, 200);
  } finally {
    await t.done();
  }
});

test('only GET, and only /internal/session', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    assert.equal((await t.ask(id, { method: 'POST' })).status, 405);
    assert.equal((await t.ask(id, { path: '/internal/sessions' })).status, 404);
    assert.equal((await t.ask(id, { path: '/' })).status, 404);
  } finally {
    await t.done();
  }
});

test('the session id is read from the header only, never the query string', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    const r = await t.ask(null, { path: `/internal/session?session=${id}&x-of-session=${id}` });
    assert.deepEqual([r.status, r.body], [401, { error: 'no_session' }]);
  } finally {
    await t.done();
  }
});

test('the public listener knows nothing of /internal/session', async () => {
  const t = await setup();
  try {
    const { id } = createSession(t.db, t.dana);
    const r = await new Promise((resolve) =>
      request({ host: '127.0.0.1', port: t.s.port, path: '/internal/session', headers: { authorization: `Bearer ${TOKEN}`, 'x-of-session': id } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).end()
    );
    assert.equal(r, 404);
  } finally {
    await t.done();
  }
});

test('the superadmin is answered as the operator', async () => {
  const t = await setup();
  try {
    const me = makeUser(t.db, 'admin@example.com', { superadmin: true });
    const r = await t.ask(createSession(t.db, me).id, { product: 'toran' });
    assert.equal(r.status, 200);
    assert.equal(r.body.role, 'superadmin');
    assert.equal(r.body.workspace, null);
  } finally {
    await t.done();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { tempHome } from './helpers.js';
import { listen } from '../src/web/server.js';

// GET /internal/signup over real HTTP, as Teder asks it once at start to check its own sign-up switch (OF_SIGNUP_OPEN)
// against ours (docs/setup.md, "GET /internal/signup"). Read only: what /signup goes by, nothing more.

const TOKEN = 'internal-token-for-tests-only-0123456789';
const PATH = '/internal/signup';

async function setup(env = {}) {
  const h = tempHome();
  const s = await listen(h.db, { env: { OF_INTERNAL_TOKEN: TOKEN, ...env }, port: 0, internalPort: 0, log: () => {} });
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
  return { ...h, s, ask, done: async () => (await s.close(), h.cleanup()) };
}

test('the answer is what /signup goes by: open only with OF_SIGNUP=1, and then the products OF_SIGNUP_PRODUCTS names', async () => {
  const cases = [
    [{}, { open: false, products: [] }],
    [{ OF_SIGNUP: '0', OF_SIGNUP_PRODUCTS: 'teder' }, { open: false, products: [] }],
    // Exactly "1", as signupOpen() reads it: "true" keeps /signup closed, so it is closed here too.
    [{ OF_SIGNUP: 'true' }, { open: false, products: [] }],
    [{ OF_SIGNUP: '1' }, { open: true, products: ['teder', 'toran'] }],
    // As on the server since 2026-10-30.
    [{ OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder' }, { open: true, products: ['teder'] }],
    [{ OF_SIGNUP: ' 1 ', OF_SIGNUP_PRODUCTS: ' Teder , nope ' }, { open: true, products: ['teder'] }],
    // Open with no product it knows: the form is up and takes nobody, which Teder must hear as closed for it.
    [{ OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'nope' }, { open: true, products: [] }],
  ];
  for (const [env, want] of cases) {
    const t = await setup(env);
    try {
      const r = await t.ask();
      assert.equal(r.status, 200, JSON.stringify(env));
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.match(r.headers['content-type'], /^application\/json/);
      assert.deepEqual(r.body, want, JSON.stringify(env));
    } finally {
      await t.done();
    }
  }
});

test('read only: asking writes nothing, and the answer is the same every time', async () => {
  const t = await setup({ OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder' });
  try {
    const rows = () => t.db.get('SELECT (SELECT COUNT(*) FROM audit) + (SELECT COUNT(*) FROM signups) + (SELECT COUNT(*) FROM workspaces) AS n').n;
    const before = rows();
    const answers = [];
    for (let i = 0; i < 3; i++) answers.push((await t.ask()).body);
    assert.deepEqual(answers, Array(3).fill({ open: true, products: ['teder'] }));
    assert.equal(rows(), before);
  } finally {
    await t.done();
  }
});

test('refused without the right token, from a wrong Host, by another method, and on the public listener', async () => {
  const t = await setup({ OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder' });
  try {
    for (const token of [null, '', 'wrong', `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      assert.deepEqual(await t.ask({ token }).then((r) => [r.status, r.body]), [401, { error: 'bad_token' }], String(token));
    }
    assert.equal((await t.ask({ token: null, headers: { authorization: `Basic ${TOKEN}` } })).status, 401);
    for (const host of ['accounts.openfrequency.co.il', `127.0.0.1:${t.s.internalPort + 1}`]) {
      assert.deepEqual(await t.ask({ headers: { host } }).then((r) => [r.status, r.body]), [403, { error: 'bad_host' }], host);
    }
    assert.equal((await t.ask({ method: 'POST' })).status, 405);
    assert.equal((await t.ask({ path: '/internal/signups' })).status, 404);
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
  for (const env of [{ OF_INTERNAL_TOKEN: '' }, { OF_INTERNAL_TOKEN: 'short' }]) {
    const t2 = await setup({ OF_SIGNUP: '1', ...env });
    try {
      assert.deepEqual((await t2.ask({ token: 'short' })).body, { error: 'not_configured' });
    } finally {
      await t2.done();
    }
  }
});

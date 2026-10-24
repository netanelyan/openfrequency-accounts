import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { PUBLIC, signedIn, startSite } from './site.js';
import { now, setNow } from '../src/core/clock.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';

// /admin/toran: Toran's operator pages on our /admin, handed to Toran as they came (src/web/admin-toran.js). The
// pretend Toran here echoes what reached it (the method, the path, the headers, the body), and answers a redirect
// with its cookies, a gzipped page with its own CSP, or nothing at all.

const HTML = '<!doctype html><title>לידים</title><a href="/admin/toran/lead/12">נעלי הגליל</a>';

async function startEcho() {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    try {
      for await (const c of req) chunks.push(c);
    } catch {
      return; // cut off on the way (the 2 MB test)
    }
    const call = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    calls.push(call);
    if (req.url === '/admin/toran/lead/12/mark') {
      res.writeHead(303, { location: '/admin/toran/lead/12?saved=1', 'set-cookie': ['tn_flash=saved; Path=/admin/toran; HttpOnly', 'tn_seen=1; Path=/'], 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.url === '/admin/toran/leads') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-encoding': 'gzip',
        'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-abc'",
        'cache-control': 'private, max-age=5',
        'x-toran': 'yes',
      });
      return res.end(gzipSync(HTML));
    }
    if (req.url === '/admin/toran/slow') return; // never answers
    if (req.url === '/admin/toran/missing') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('toran: not found');
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ method: call.method, path: call.path }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    host: `127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))),
  };
}

async function setup({ env = {}, toran = true, ...opts } = {}) {
  const h = tempHome();
  setNow('2026-10-24T09:00:00.000Z');
  const fake = toran ? await startEcho() : null;
  const site = await startSite(h.db, { env: { ...(fake ? { OF_TORAN_INTERNAL: fake.url } : {}), ...env }, ...opts });
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'נתנאל' });
  const op = signedIn(site, h.db, admin, { secure: env.PUBLIC_HOST !== '' });
  return { ...h, ...site, fake, admin, op, done: async () => (await site.close(), await fake?.close(), h.cleanup()) };
}

/** A request as it came, the body kept as bytes (a gzipped answer is not text), and sent in `chunks` if given. */
function raw(port, method, path, headers, chunks = []) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    for (const c of chunks) req.write(c);
    req.end();
  });
}

// What the browser sends besides what Toran may see: none of these may reach it.
const SPOOFED = {
  authorization: 'Bearer stolen',
  'x-forwarded-for': '198.51.100.7',
  forwarded: 'for=198.51.100.7;proto=https',
  'x-real-ip': '198.51.100.7',
  'x-of-admin-prefix': '/',
  'x-of-admin-origin': 'https://evil.example',
  'x-of-session': 'nope',
  'x-something-else': 'no',
};
const PASSED = {
  accept: 'text/html',
  'accept-language': 'he-IL,he;q=0.9',
  'accept-encoding': 'gzip, br',
  referer: `https://${PUBLIC}/admin/toran/leads`,
  'user-agent': 'Test/1.0',
  'x-tn-ajax': '1',
};

test('the superadmin\'s GET and POST reach Toran with the prefix, our proto and origin, Toran\'s host, and only the allowed headers', async () => {
  const t = await setup();
  try {
    const r = await t.op.get('/admin/toran/settings?tab=hours&x=%D7%90', { ...SPOOFED, ...PASSED });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { method: 'GET', path: '/admin/toran/settings?tab=hours&x=%D7%90' });
    const get = t.fake.calls.at(-1);
    assert.deepEqual(get.headers, {
      host: t.fake.host,
      cookie: `__Secure-of_session=${t.op.cookie('__Secure-of_session')}`,
      ...PASSED,
      'x-of-admin-prefix': '/admin/toran',
      'x-forwarded-proto': 'https',
      'x-of-admin-origin': `https://${PUBLIC}`,
      connection: get.headers.connection,
    });

    // A form from one of Toran's pages, with Toran's own fields, its body as it was sent.
    const p = await t.op.post('/admin/toran/lead/12/note', { text: 'דיברנו, לחזור ביום ראשון' }, { ...SPOOFED, ...PASSED });
    assert.equal(p.status, 200);
    const post = t.fake.calls.at(-1);
    assert.equal(post.method, 'POST');
    assert.equal(post.path, '/admin/toran/lead/12/note');
    assert.equal(new URLSearchParams(post.body).get('text'), 'דיברנו, לחזור ביום ראשון');
    assert.deepEqual(Object.keys(post.headers).sort(), ['accept', 'accept-encoding', 'accept-language', 'connection', 'content-length', 'content-type', 'cookie', 'host', 'origin', 'referer', 'user-agent', 'x-forwarded-proto', 'x-of-admin-origin', 'x-of-admin-prefix', 'x-tn-ajax']);
    assert.equal(post.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(post.headers['content-length'], String(Buffer.byteLength(post.body)));
    assert.equal(post.headers.origin, `https://${PUBLIC}`);
    assert.equal(post.headers['x-of-admin-prefix'], '/admin/toran');
    assert.equal(post.headers['x-of-admin-origin'], `https://${PUBLIC}`);
    for (const c of [get, post]) for (const k of Object.keys(SPOOFED)) if (!k.startsWith('x-of-admin')) assert.equal(c.headers[k], undefined, k);

    // /admin/toran itself, and any other method.
    await t.op.get('/admin/toran');
    assert.equal(t.fake.calls.at(-1).path, '/admin/toran');
    await t.op.go('DELETE', '/admin/toran/lead/12/tag/vip');
    assert.deepEqual([t.fake.calls.at(-1).method, t.fake.calls.at(-1).path], ['DELETE', '/admin/toran/lead/12/tag/vip']);
    // Nothing of ours on Toran's answer.
    assert.equal(r.headers['x-frame-options'], undefined);
    assert.equal(r.headers['content-security-policy'], undefined);
  } finally {
    await t.done();
  }
});

test('Toran\'s answer comes back as it is: the status, the location, every cookie, the compressed body and its CSP', async () => {
  const t = await setup();
  try {
    const r = await t.op.post('/admin/toran/lead/12/mark', { status: 'replied' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/admin/toran/lead/12?saved=1');
    assert.deepEqual(r.headers['set-cookie'], ['tn_flash=saved; Path=/admin/toran; HttpOnly', 'tn_seen=1; Path=/']);
    assert.equal(r.headers['cache-control'], 'no-store');

    const cookie = `__Secure-of_session=${t.op.cookie('__Secure-of_session')}`;
    const g = await raw(t.s.port, 'GET', '/admin/toran/leads', { host: PUBLIC, 'x-forwarded-proto': 'https', cookie, 'accept-encoding': 'gzip' });
    assert.equal(g.status, 200);
    assert.equal(g.headers['content-encoding'], 'gzip');
    assert.equal(gunzipSync(g.body).toString('utf8'), HTML);
    assert.equal(g.headers['content-security-policy'], "default-src 'self'; script-src 'self' 'nonce-abc'");
    assert.equal(g.headers['cache-control'], 'private, max-age=5');
    assert.equal(g.headers['x-toran'], 'yes');
    assert.equal(g.headers['x-frame-options'], undefined);
    assert.equal(g.headers['referrer-policy'], undefined);
    assert.equal(g.headers['set-cookie'], undefined, 'no cookie of ours either');

    // Toran's own errors are Toran's.
    const m = await t.op.get('/admin/toran/missing');
    assert.equal(m.status, 404);
    assert.equal(m.body, 'toran: not found');
  } finally {
    await t.done();
  }
});

test('outside HTTPS (in development) Toran is told http and our own origin', async () => {
  const t = await setup({ env: { PUBLIC_HOST: '' } });
  try {
    await t.op.get('/admin/toran/');
    const c = t.fake.calls.at(-1);
    assert.equal(c.headers['x-forwarded-proto'], 'http');
    assert.equal(c.headers['x-of-admin-origin'], `http://127.0.0.1:${t.s.port}`);
    assert.equal(c.headers.host, t.fake.host);
  } finally {
    await t.done();
  }
});

test('a customer, a signed-out browser and the superadmin in view-as are refused, and nothing reaches Toran', async () => {
  const t = await setup();
  try {
    const ws = makeWorkspace(t.db, 'dana-shop', { name: 'החנות של דנה', products: ['toran'], members: { 'dana@example.com': 'client_owner' } });
    const dana = signedIn(t, t.db, t.db.get("SELECT * FROM users WHERE email = 'dana@example.com'"));
    const viewing = signedIn(t, t.db, t.admin);
    await viewing.get('/admin/accounts');
    await viewing.post(`/admin/workspaces/${ws.id}/view-as`, { product: 'toran' });
    for (const b of [dana, t.browser(), viewing]) {
      const r = await b.get('/admin/toran/lead/12?tab=chat');
      assert.equal(r.status, 303);
      assert.equal(r.headers.location, `/admin/login?next=${encodeURIComponent('/admin/toran/lead/12?tab=chat')}`);
      const p = await b.post('/admin/toran/lead/12/note', { text: 'x' });
      assert.equal(p.status, 403);
      assert.equal((await b.go('DELETE', '/admin/toran/lead/12')).status, 403);
    }
    assert.equal(t.fake.calls.length, 0);
  } finally {
    await t.done();
  }
});

test('the admin login takes the superadmin back to the Toran page that sent them, and only to an /admin page', async () => {
  const h = tempHome();
  setNow('2026-10-24T09:00:15.000Z');
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: 'admin@example.com', password: 'a long enough password', totpSecret: secret });
  const site = await startSite(h.db);
  try {
    const b = site.browser();
    const to = (await b.get('/admin/toran/lead/12?tab=chat')).headers.location;
    const login = await b.get(to);
    assert.match(login.body, /<input type="hidden" name="next" value="\/admin\/toran\/lead\/12\?tab=chat">/);
    const r = await b.post('/admin/login', { email: 'admin@example.com', password: 'a long enough password', code: totpCode(secret, stepAt(now())), next: '/admin/toran/lead/12?tab=chat' });
    assert.equal(r.headers.location, '/admin/toran/lead/12?tab=chat');
    for (const bad of ['https://evil.example/', '//evil.example/admin', '/login', '/admin/login?next=/admin']) {
      const c = site.browser();
      assert.doesNotMatch((await c.get(`/admin/login?next=${encodeURIComponent(bad)}`)).body, /name="next"/, bad);
    }
  } finally {
    await site.close();
    h.cleanup();
  }
});

test('/internal under the prefix is not found, and never asked of Toran', async () => {
  const t = await setup();
  try {
    for (const p of ['/admin/toran/internal/ops', '/admin/toran/internal', '/admin/toran/x/internal/session', '/admin/toran/INTERNAL/ops', '/admin/toran/internal%2Fops', '/admin/toran/a/../internal/ops']) {
      const r = await t.op.get(p);
      assert.equal(r.status, 404, p);
      assert.match(r.body, /<a href="\/admin">/);
      assert.equal((await t.op.post(p, {})).status, 404, p);
    }
    assert.equal(t.fake.calls.length, 0);
    // A lead whose name only starts with the word is Toran's.
    await t.op.get('/admin/toran/internals-guide');
    assert.equal(t.fake.calls.length, 1);
  } finally {
    await t.done();
  }
});

test('Toran down or slow: 502 with our page and a way back to /admin; a body over 2 MB is 413', async () => {
  const down = await setup({ toran: false });
  try {
    const r = await down.op.get('/admin/toran/');
    assert.equal(r.status, 502);
    assert.match(r.body, /<h1>תורן לא ענה כרגע<\/h1>/);
    assert.match(r.body, /<a href="\/admin">חזרה ללוח<\/a>/);
    assert.match(r.body, /<link rel="stylesheet" href="\/static\/site\.css/);
    assert.equal((await down.op.post('/admin/toran/lead/1/note', { text: 'x' })).status, 502);
  } finally {
    await down.done();
  }
  const slow = await setup({ toranProxyMs: 200 });
  try {
    const r = await slow.op.get('/admin/toran/slow');
    assert.equal(r.status, 502);
    assert.match(r.body, /תורן לא ענה כרגע/);
    const big = await slow.op.post('/admin/toran/lead/1/note', { text: 'א'.repeat(1_100_000) });
    assert.equal(big.status, 413);
    // Without a Content-Length, counted on the way, and cut at 2 MB.
    const cookie = `__Secure-of_session=${slow.op.cookie('__Secure-of_session')}`;
    const chunked = await raw(slow.s.port, 'POST', '/admin/toran/lead/1/upload', { host: PUBLIC, 'x-forwarded-proto': 'https', cookie, 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' }, Array.from({ length: 6 }, () => Buffer.alloc(512 * 1024, 1))).catch((e) => ({ status: e.code }));
    assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(chunked.status), String(chunked.status));
    assert.equal(slow.fake.calls.filter((c) => c.path.startsWith('/admin/toran/lead/1/')).length, 0);
  } finally {
    await slow.done();
  }
});

test('the admin pages have a third tab, תורן, to /admin/toran/', async () => {
  const t = await setup();
  try {
    for (const [p, re] of [
      ['/admin', /<a href="\/admin" aria-current="page">היום<\/a><a href="\/admin\/accounts">חשבונות<\/a><a href="\/admin\/toran\/">תורן<\/a><\/nav>/],
      ['/admin/accounts', /<a href="\/admin">היום<\/a><a href="\/admin\/accounts" aria-current="page">חשבונות<\/a><a href="\/admin\/toran\/">תורן<\/a><\/nav>/],
    ]) {
      assert.match((await t.op.get(p)).body, re, p);
    }
  } finally {
    await t.done();
  }
});

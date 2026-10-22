import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';
import { createServer } from 'node:net';
import { listen } from '../src/web/server.js';

test('both listeners start on 127.0.0.1 and answer /healthz', async () => {
  const h = tempHome();
  const s = await listen(h.db, { env: {}, port: 0, internalPort: 0 });
  try {
    assert.notEqual(s.port, s.internalPort);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/healthz`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${s.internalPort}/healthz`)).status, 200);
  } finally {
    await s.close();
    h.cleanup();
  }
});

test('every page links the icon, and the icon is served', async () => {
  const h = tempHome();
  const s = await listen(h.db, { env: {}, port: 0, internalPort: 0 });
  try {
    const page = await (await fetch(`http://127.0.0.1:${s.port}/login`)).text();
    assert.match(page, /<link rel="icon" href="\/static\/icon\.svg\?v=[^"]+" type="image\/svg\+xml">/);
    assert.match(page, /<link rel="apple-touch-icon" href="\/static\/icon-180\.png\?v=[^"]+">/);
    for (const [p, type] of [['/static/icon.svg', 'image/svg+xml'], ['/static/icon-180.png', 'image/png']]) {
      const r = await fetch(`http://127.0.0.1:${s.port}${p}`);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get('content-type'), type);
      assert.ok((await r.arrayBuffer()).byteLength > 0);
    }
    // Only these files: the internal port serves none of them.
    assert.equal((await fetch(`http://127.0.0.1:${s.internalPort}/static/icon.svg`)).status, 404);
  } finally {
    await s.close();
    h.cleanup();
  }
});

test('if the internal port is taken, the public one is released too', async () => {
  const h = tempHome();
  const first = await listen(h.db, { env: {}, port: 0, internalPort: 0 });
  // A port known to be free a moment ago.
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const free = probe.address().port;
  await new Promise((r) => probe.close(r));
  try {
    await assert.rejects(listen(h.db, { env: {}, port: free, internalPort: first.internalPort }), /EADDRINUSE/);
    // The public port was let go: it can be listened on again.
    const again = await listen(h.db, { env: {}, port: free, internalPort: 0 });
    assert.equal(again.port, free);
    await again.close();
  } finally {
    await first.close();
    h.cleanup();
  }
});

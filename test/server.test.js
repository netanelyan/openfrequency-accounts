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

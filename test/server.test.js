import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/web/server.js';

test('both listeners start on 127.0.0.1 and answer /healthz', async () => {
  const s = await listen({ env: {}, port: 0, internalPort: 0 });
  try {
    assert.notEqual(s.port, s.internalPort);
    for (const port of [s.port, s.internalPort]) {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      assert.equal(r.status, 200);
      assert.equal(await r.text(), 'ok');
    }
    // The internal route is not on the public listener.
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/internal/session`)).status, 404);
  } finally {
    await s.close();
  }
});

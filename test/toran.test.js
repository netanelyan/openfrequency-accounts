import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOps, toranClient } from '../src/web/toran.js';

// The client /admin reaches Toran with (src/web/toran.js), without a network: what it sends, and what it keeps.

test("Toran's client: the token and the address, a link that is not a web or mail address dropped, and a Toran that hangs", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, opts });
    if (opts.method === 'POST') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return new Response(JSON.stringify({ items: [{ product: 'toran', id: '1', name: 'x', target: { href: 'javascript:alert(1)', label: 'l' }, leadUrl: 'data:text/html,x', page: 'https://ok.example/' }, { product: 'other', id: '2' }] }), { status: 200 });
  };
  const c = toranClient({ env: { OF_INTERNAL_TOKEN: 'x'.repeat(32), OF_TORAN_INTERNAL: 'http://127.0.0.1:4799/' }, fetchImpl, log: () => {} });
  assert.equal(c.base, 'http://127.0.0.1:4799');
  const r = await c.ops();
  assert.equal(seen[0].url, 'http://127.0.0.1:4799/internal/ops');
  assert.equal(seen[0].opts.headers.authorization, `Bearer ${'x'.repeat(32)}`);
  assert.equal(r.data.items.length, 1);
  assert.deepEqual([r.data.items[0].target.href, r.data.items[0].leadUrl, r.data.items[0].page], [null, null, 'https://ok.example/']);
  assert.deepEqual(await c.act('toran', '1', 'sent', { by: 'x' }), { ok: false, status: 0 });
  assert.equal(seen[1].url, 'http://127.0.0.1:4799/internal/ops/toran/1/sent');
  assert.equal(seen[1].opts.body, '{"by":"x"}');
  assert.equal(toranClient({ env: {} }).base, 'http://127.0.0.1:4710');
  assert.deepEqual(await toranClient({ env: { OF_INTERNAL_TOKEN: 'short' }, fetchImpl: () => assert.fail('no call') }).ops(), { ok: false, why: 'not_configured' });
  assert.deepEqual(readOps({}).funnels, { toran: [], teder: [] });
});

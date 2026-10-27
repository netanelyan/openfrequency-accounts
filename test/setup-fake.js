import { createServer } from 'node:http';
import { TOKEN } from './site.js';

// A pretend product (Toran or Teder) on 127.0.0.1 with the one internal route the setup page reads (docs/setup.md):
// GET /internal/setup?workspace=<id>. It answers `state.answer(workspaceId)`: a body (an object, sent as JSON), or
// { status, raw } to send something else as it is, or 'hang' to never answer. Every request is kept in `calls`.

/** A checklist in the contract's shape: one required step done, one required to do, one optional. Fictional. */
export function sampleSetup(product, { ready = false, done = false } = {}) {
  const base = `https://${product}.openfrequency.co.il`;
  return {
    product,
    ready: ready || done,
    steps: [
      { key: 'connect', title: product === 'toran' ? 'לחבר את האתר של החנות' : 'לחבר את חשבון האינסטגרם', status: 'done', detail: '', href: `${base}/connect`, required: true },
      { key: 'first', title: 'לבדוק את התשובה הראשונה', status: done ? 'done' : 'todo', detail: 'זה לוקח בערך חמש דקות.', href: `${base}/first`, required: true },
      { key: 'team', title: 'להוסיף עוד מישהו מהצוות', status: 'todo', detail: '', href: null, required: false },
    ],
  };
}

export async function startProduct(product, { token = TOKEN, answer = () => sampleSetup(product) } = {}) {
  const calls = [];
  const state = { answer };
  const hanging = new Set();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: req.url, auth: req.headers.authorization || null, workspace: url.searchParams.get('workspace') });
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end('{"error":"bad_token"}');
    }
    if (req.method !== 'GET' || url.pathname !== '/internal/setup') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not_found"}');
    }
    const a = state.answer(url.searchParams.get('workspace'));
    if (a === 'hang') {
      hanging.add(res);
      return;
    }
    if (a && typeof a === 'object' && 'raw' in a) {
      res.writeHead(a.status ?? 200, { 'content-type': 'application/json' });
      return res.end(a.raw);
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(a));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    state,
    close: () =>
      new Promise((r) => {
        for (const res of hanging) res.destroy();
        server.closeAllConnections?.();
        server.close(r);
      }),
  };
}

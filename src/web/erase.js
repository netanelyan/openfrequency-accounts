import { setupBases } from './setup.js';

// Asking Teder and Toran to delete a workspace's data, before accounts deletes its own (src/accounts/erase.js):
//
//   POST <OF_TEDER_INTERNAL or OF_TORAN_INTERNAL>/internal/workspaces/<id>/delete
//   Authorization: Bearer OF_INTERNAL_TOKEN       body {}
//
//   2xx        deleted, or there was nothing of this workspace there (a product answers 200 for a workspace it never
//              saw, and again for one it already deleted: docs/contracts/workspaces-delete.json)
//   anything   else (404 included, another status, no answer in 10 seconds, no token configured): failed, and accounts
//              deletes nothing, so the customer can try again. A 404 is a product without the route (or a wrong
//              address): taking it for "nothing there" would leave that product's data behind while ours is gone
//              (ACC-06, PRA-BE-004).

export const ERASE_MS = 10_000;
const MIN_TOKEN = 32;

export function eraseClient({ env = process.env, fetchImpl = globalThis.fetch, log = console.error, timeoutMs = ERASE_MS } = {}) {
  const bases = setupBases(env);
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();

  async function one(product, workspaceId) {
    const path = `/internal/workspaces/${encodeURIComponent(workspaceId)}/delete`;
    if (token.length < MIN_TOKEN) {
      log(`[accounts] ${product} POST ${path}: OF_INTERNAL_TOKEN is not set, so it was not asked`);
      return 'failed';
    }
    try {
      const r = await fetchImpl(`${bases[product]}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await r.text().catch(() => '');
      if (r.status >= 200 && r.status < 300) return 'deleted';
      log(`[accounts] ${product} POST ${path}: ${r.status}${r.status === 404 ? ' (no such route there: nothing was deleted anywhere)' : ''}`);
      return 'failed';
    } catch (e) {
      log(`[accounts] ${product} POST ${path}: ${e?.name === 'TimeoutError' ? 'timed out' : e?.cause?.code || e?.message}`);
      return 'failed';
    }
  }

  return {
    /** Ask each product, in parallel: { results: { [product]: 'deleted' | 'failed' }, ok, failed: [...] }. */
    async erase(workspaceId, products) {
      const answers = await Promise.all(products.map((p) => (bases[p] ? one(p, workspaceId) : 'failed')));
      const results = Object.fromEntries(products.map((p, i) => [p, answers[i]]));
      const failed = products.filter((p) => results[p] === 'failed');
      return { results, ok: failed.length === 0, failed };
    },
  };
}

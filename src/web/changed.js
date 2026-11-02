import { setupBases } from './setup.js';

// Telling Teder and Toran that a workspace's access changed, so each drops the answer it keeps from GET
// /internal/entitlement (5 minutes) and asks afresh on its next page or check (the owner's audit, 2026-11-02, item 3:
// "When a payment is recorded, tell Teder and Toran right away ... The customer should see access open on the next
// refresh, not after 5 minutes."). docs/setup.md, "When access changes"; docs/contracts/entitlement-changed.json.
//
//   POST <OF_TEDER_INTERNAL or OF_TORAN_INTERNAL>/internal/entitlement/changed
//   Authorization: Bearer OF_INTERNAL_TOKEN       { "workspace": <id>, "reason": "paid" | ... }
//
//   2xx        told: the product dropped what it kept (or had nothing kept for that workspace)
//   anything   else (another status, no answer in CHANGED_MS, no token configured): a line in the log, nothing more.
//              That product asks accounts again within its 5 minutes, as it always did.
//
// Called once the change is committed, never inside its transaction, and never awaited by the request that made it:
// the payment, its emails, its invoice and its redirect go on whatever the products answer, and a product that is down
// or slow costs the request nothing. Only the products named are told (app.js names the ones the workspace has).

export const CHANGED_MS = 2000;
export const CHANGED_PATH = '/internal/entitlement/changed';
/** Why accounts says it changed, for the products' logs: they act the same way on every one. */
export const REASONS = ['paid', 'subscription', 'comp', 'cancelled', 'resumed', 'product', 'workspace'];
const MIN_TOKEN = 32;

export function changedClient({ env = process.env, fetchImpl = globalThis.fetch, log = console.error, timeoutMs = CHANGED_MS } = {}) {
  const bases = setupBases(env);
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  // What is still on its way, so a test (and a shutdown) can wait for it; nothing in a request ever does.
  const pending = new Set();

  async function one(product, workspaceId, reason) {
    const what = `${product} POST ${CHANGED_PATH} (workspace ${workspaceId}, ${reason})`;
    if (token.length < MIN_TOKEN) {
      log(`[accounts] ${what}: OF_INTERNAL_TOKEN is not set, so it was not told; it asks again within its 5 minutes`);
      return 'failed';
    }
    try {
      const r = await fetchImpl(`${bases[product]}${CHANGED_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ workspace: workspaceId, reason }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await r.text().catch(() => '');
      if (r.status >= 200 && r.status < 300) return 'told';
      log(`[accounts] ${what}: ${r.status}; it asks again within its 5 minutes`);
      return 'failed';
    } catch (e) {
      log(`[accounts] ${what}: ${e?.name === 'TimeoutError' ? 'timed out' : e?.cause?.code || e?.message}; it asks again within its 5 minutes`);
      return 'failed';
    }
  }

  return {
    /**
     * Tell each of `products` that the workspace's access changed: all at once, each for at most `timeoutMs`. Returns the
     * promise of { [product]: 'told' | 'failed' }, which never rejects. The callers do not wait for it.
     */
    tell(workspaceId, products, reason) {
      const list = [...new Set(products)].filter((p) => bases[p]);
      const p = Promise.all(list.map((pr) => one(pr, Number(workspaceId), reason).catch(() => 'failed'))).then((out) => Object.fromEntries(list.map((pr, i) => [pr, out[i]])));
      pending.add(p);
      p.finally(() => pending.delete(p));
      return p;
    },
    /** Every notification still on its way, settled. */
    settled: () => Promise.all([...pending]),
  };
}

import { TORAN_INTERNAL } from './toran.js';

// The setup page's checklist (/setup, docs/setup.md): what each product a workspace has turned on still needs before
// it works, asked of that product at each load:
//
//   GET <product's internal address>/internal/setup?workspace=<id>     Authorization: Bearer OF_INTERNAL_TOKEN
//   { "product": "toran" | "teder", "ready": boolean,
//     "steps": [ { "key", "title", "status": "todo" | "working" | "done" | "attention" | "soon",
//                  "detail", "href": string | null, "required": boolean } ] }
//
// Toran is at OF_TORAN_INTERNAL (default http://127.0.0.1:4710), Teder at OF_TEDER_INTERNAL (default
// http://127.0.0.1:4700). Only the products turned on are asked, all at once, each for at most 3 seconds. An answer
// that does not fit the shape above is not used at all; a product that does not answer, or answers that way, shows
// a line saying we could not check. Nothing from a product reaches the page unescaped, and a link only when it is
// http(s) on openfrequency.co.il, one of its subdomains, or the address a product is configured at.

export const TEDER_INTERNAL = 'http://127.0.0.1:4700';
export const SETUP_MS = 3000;
export const STATUSES = ['todo', 'working', 'done', 'attention', 'soon'];
const MIN_TOKEN = 32;
const MAX_BYTES = 64_000;
const MAX_STEPS = 30;
const KEY = /^[A-Za-z0-9_.:-]{1,60}$/;

/** Each product's internal address on this machine. */
export function setupBases(env = process.env) {
  const at = (v, fallback) => (String(v || '').trim() || fallback).replace(/\/+$/, '');
  return { toran: at(env.OF_TORAN_INTERNAL, TORAN_INTERNAL), teder: at(env.OF_TEDER_INTERNAL, TEDER_INTERNAL) };
}

/**
 * A step's link, or null. Absolute http(s) on openfrequency.co.il or a subdomain, or on the origin of a configured
 * product URL (TEDER_URL, TORAN_URL: localhost in development); a path ("/x", not "//x") is resolved against the
 * product's own URL. No user name or password in it. Anything else (javascript:, data:, another site) is dropped.
 */
export function setupHref(v, product, productUrls = {}) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 2000 || /[\s\u0000-\u001f]/.test(s)) return null;
  let u;
  try {
    if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) u = new URL(s, productUrls[product]);
    else u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const ours = (host === 'openfrequency.co.il' || host.endsWith('.openfrequency.co.il')) && u.protocol === 'https:';
  const configured = Object.values(productUrls).some((p) => {
    try {
      return new URL(p).origin === u.origin;
    } catch {
      return false;
    }
  });
  return ours || configured ? u.href : null;
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);

/**
 * A product's answer, checked against the contract: { ready, steps } or null. Strict about the shape (the product
 * named, a boolean ready, at most 30 steps, each with a key, a title, a known status and a boolean required, no two
 * with the same key): one step that does not fit and the whole answer is refused, so a broken answer never passes
 * for a finished checklist. A link that is not allowed is dropped from its step.
 */
export function readSetup(body, product, productUrls = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.product !== product || typeof body.ready !== 'boolean' || !Array.isArray(body.steps) || body.steps.length > MAX_STEPS) return null;
  const keys = new Set();
  const steps = [];
  for (const s of body.steps) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    if (typeof s.key !== 'string' || !KEY.test(s.key) || keys.has(s.key)) return null;
    const title = text(s.title, 200);
    if (!title) return null;
    if (!STATUSES.includes(s.status) || typeof s.required !== 'boolean') return null;
    if (s.detail != null && typeof s.detail !== 'string') return null;
    if (s.href != null && typeof s.href !== 'string') return null;
    keys.add(s.key);
    steps.push({ key: s.key, title, status: s.status, detail: text(s.detail, 500) || '', href: setupHref(s.href, product, productUrls), required: s.required });
  }
  return { ready: body.ready, steps };
}

/** Is a product's checklist finished: it says it is ready, and every required step is done? */
export const productDone = (r) => Boolean(r?.ok && r.ready && r.steps.every((s) => !s.required || s.status === 'done'));

export function setupClient({ env = process.env, fetchImpl = globalThis.fetch, log = console.error, timeoutMs = SETUP_MS, productUrls = {} } = {}) {
  const bases = setupBases(env);
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  const configured = token.length >= MIN_TOKEN;
  const why = (e) => (e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timed out' : e?.cause?.code || e?.message);

  async function one(product, workspaceId) {
    if (!configured) return { ok: false, why: 'not_configured' };
    const path = `/internal/setup?workspace=${encodeURIComponent(workspaceId)}`;
    try {
      const r = await fetchImpl(`${bases[product]}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await r.text();
      if (r.status !== 200 || raw.length > MAX_BYTES) {
        log(`[accounts] ${product} GET /internal/setup: ${r.status}${raw.length > MAX_BYTES ? ', too large' : ''}`);
        return { ok: false, why: 'down' };
      }
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        /* refused below */
      }
      const read = readSetup(json, product, productUrls);
      if (!read) {
        log(`[accounts] ${product} GET /internal/setup: an answer that does not fit the contract`);
        return { ok: false, why: 'bad_answer' };
      }
      return { ok: true, ...read };
    } catch (e) {
      log(`[accounts] ${product} GET /internal/setup: ${why(e)}`);
      return { ok: false, why: 'down' };
    }
  }

  return {
    bases,
    /** Each product's checklist, asked in parallel: { [product]: { ok: true, ready, steps } | { ok: false, why } }. */
    async check(workspaceId, products) {
      const answers = await Promise.all(products.map((p) => (bases[p] ? one(p, workspaceId) : { ok: false, why: 'unknown_product' })));
      return Object.fromEntries(products.map((p, i) => [p, answers[i]]));
    },
  };
}

/**
 * The page's model, from the products' answers (in the order of `products`), each product's access (the paywall,
 * src/accounts/entitlement.js accessFor()) and the payment hook. Pure.
 *   billing     the payment step, first and required, or null with no product on. "done" once every product is
 *               allowed (paid for, or complimentary); until then "todo", leading to the provider's checkout once one
 *               is connected (billingReady) and, before that, to us (`contact`: our WhatsApp or the contact page)
 *   sections    one per product: { product, ok, locked, ready, done, required: [...], optional: [...] }. A product
 *               that is not allowed yet is locked: its steps are shown, closed, until the payment is in
 *   done/total  the steps done, out of every step there is now (a "soon" step is not counted)
 *   incomplete  payment is not in, or a product that answered is not finished
 *   unknown     a product did not answer
 *   complete    neither
 */
export function setupState(results, products, { billingReady = false, access = {}, checkout = null, contact = null } = {}) {
  const allowed = (p) => Boolean(access[p]?.allowed);
  const paidAll = products.length > 0 && products.every(allowed);
  const billing = products.length
    ? {
        key: 'billing',
        status: paidAll ? 'done' : 'todo',
        mode: billingReady ? 'provider' : 'contact',
        comp: products.every((p) => access[p]?.access === 'comp'),
        // A connected provider with no checkout page to send them to yet still leaves a way to reach us.
        href: paidAll ? null : (billingReady && checkout) || contact,
        checkout: Boolean(!paidAll && billingReady && checkout),
        required: true,
      }
    : null;
  const sections = products.map((p) => {
    const r = results[p];
    const locked = !allowed(p);
    if (!r?.ok) return { product: p, ok: false, locked };
    return { product: p, ok: true, locked, ready: r.ready, done: !locked && productDone(r), required: r.steps.filter((s) => s.required), optional: r.steps.filter((s) => !s.required) };
  });
  const counted = [...(billing ? [billing] : []), ...sections.flatMap((s) => (s.ok ? [...s.required, ...s.optional] : []))].filter((s) => s.status !== 'soon');
  // With no product turned on there is nothing to set up, and nothing to pay for.
  const incomplete = products.length > 0 && (!paidAll || sections.some((s) => s.ok && !s.done));
  const unknown = sections.some((s) => !s.ok);
  return { billing, sections, paid: paidAll, done: counted.filter((s) => s.status === 'done').length, total: counted.length, incomplete, unknown, complete: !incomplete && !unknown };
}

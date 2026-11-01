import { now, nowIso, MINUTE } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { j } from '../db/index.js';
import { MORNING, PLAN_NAMES, PRODUCT_NAMES, SIGNUP, dayHe } from '../web/copy.js';
import { addInvoice, PDF_MAX } from './invoices.js';
import { israelToday, VAT } from './subscriptions.js';

// The invoice-receipt in Morning (Green Invoice, developers.morning.co/api, read 2026-11-01), issued when the operator
// presses "התשלום הגיע" on a transfer's receipt (src/accounts/pay.js). The payment is recorded first and always: an
// invoice that cannot be issued never holds it up, and the receipt's page then says why and offers to try again.
//
//   1. A token: POST {grant_type: "client_credentials", client_id, client_secret} to Morning's identity service; the
//      answer { accessToken, tokenType: "Bearer", expiresAt (unix seconds) } lasts an hour and is kept in memory until
//      a minute before it ends. The secret and the token are never logged, stored, put in an error or on a page.
//   2. GET /documents/info?type=320: the business as Morning has it. An exempt business (exemption) while we added VAT,
//      or a VAT rate that is not ours (subscriptions.js VAT), and nothing is issued: the operator is told, and the
//      audit log has morning_blocked. A wrong document is worse than none.
//   3. POST /documents: a חשבונית מס/קבלה (type 320), in Hebrew and shekels, for the business's owners' addresses (Morning
//      emails it with its PDF): a row for each month recorded, naming the product, its plan and its days, a row for a
//      setup fee, each price as the customer was asked (vatType 0, VAT added, or 1, VAT in it), and one payment, a bank
//      transfer (type 4), of the total the customer was asked to pay.
//   4. Its PDF, from the links in the answer (with the token only to Morning's own hosts), kept in invoices
//      (invoices.js addInvoice) so it is on the customer's page; when neither link gives a PDF, only its link is kept.
//
// One receipt, one document, ever: the receipt row is claimed ('issuing') before anything is asked, by one UPDATE that
// only a receipt with no document and no request out can pass, and the document's id is written the moment it comes
// back. A double press, a retry while one is out, or a retry after it was issued asks Morning nothing. A request
// still out after 10 minutes (the process stopped mid-way) may be retried, and the page says to look in Morning first.
//
// OF_MORNING_CLIENT_ID and OF_MORNING_CLIENT_SECRET (the business's API keys in Morning, on a plan that includes the
// API) turn it on; OF_MORNING_ENV=sandbox points it at Morning's sandbox. Unset, nothing here runs and the receipt's
// page says the invoice was not issued automatically.

export const MORNING_URLS = {
  production: { token: 'https://api.morning.co/idp/v1/oauth/token', api: 'https://api.greeninvoice.co.il/api/v1' },
  sandbox: { token: 'https://api.sandbox.morning.dev/idp/v1/oauth/token', api: 'https://sandbox.d.greeninvoice.co.il/api/v1' },
};
// The hosts the token may go to when a PDF is fetched: Morning's own, never one named only in an answer.
const MORNING_HOST = /(^|\.)(greeninvoice\.co\.il|morning\.co|morning\.dev)$/i;
/** A request out longer than this is taken to have died with its process, and may be retried. */
export const ISSUING_STALE_MS = 10 * MINUTE;
/** Each request to Morning. */
export const MORNING_TIMEOUT_MS = 15_000;

/** The settings: { clientId, clientSecret, mode, token, api }, or null while Morning is off (or OF_MORNING_ENV is not one we know). */
export function morningConfig(env = process.env) {
  const clientId = String(env.OF_MORNING_CLIENT_ID || '').trim();
  const clientSecret = String(env.OF_MORNING_CLIENT_SECRET || '').trim();
  const mode = String(env.OF_MORNING_ENV || '').trim() || 'production';
  if (!clientId || !clientSecret || !Object.hasOwn(MORNING_URLS, mode)) return null;
  return { clientId, clientSecret, mode, ...MORNING_URLS[mode] };
}

/** What is wrong with the Morning settings, in one line for the log (never a value), or null. */
export function morningProblem(env = process.env) {
  const id = Boolean(String(env.OF_MORNING_CLIENT_ID || '').trim());
  const secret = Boolean(String(env.OF_MORNING_CLIENT_SECRET || '').trim());
  const mode = String(env.OF_MORNING_ENV || '').trim();
  if (mode && !Object.hasOwn(MORNING_URLS, mode)) return 'OF_MORNING_ENV is not production or sandbox: Morning stays off';
  if (id !== secret) return `${id ? 'OF_MORNING_CLIENT_SECRET' : 'OF_MORNING_CLIENT_ID'} is unset: Morning stays off`;
  return null;
}

export class MorningError extends Error {
  /** `code`: Morning's error code or ours (timeout, unreachable, bad_answer); `detail`: Morning's own words, cut. */
  constructor(code, { status = null, detail = '', step = '' } = {}) {
    super(String(code));
    this.code = String(code);
    this.status = status;
    this.detail = String(detail || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    this.step = step;
  }
}

/**
 * The client: { mode, token(), info(), issue(body), pdf(urls) }. `fetchImpl` is the network (the tests' fake Morning),
 * `clock` the time in ms for the token's life.
 */
export function morningClient(config, { fetchImpl = globalThis.fetch, timeoutMs = MORNING_TIMEOUT_MS, clock = now } = {}) {
  let kept = null;
  const call = async (url, init, step) => {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new MorningError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'unreachable', { step });
    }
  };
  const body = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };
  const refuse = async (res, step) => {
    const b = await body(res);
    const code = b?.errorCode ?? b?.code ?? b?.error ?? `http_${res.status}`;
    throw new MorningError(typeof code === 'object' ? `http_${res.status}` : code, { status: res.status, detail: b?.errorMessage ?? b?.message ?? b?.error_description ?? '', step });
  };
  async function token() {
    if (kept && clock() < kept.until) return kept.value;
    const res = await call(config.token, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }) }, 'token');
    if (!res.ok) await refuse(res, 'token');
    const b = await body(res);
    if (typeof b?.accessToken !== 'string' || !b.accessToken) throw new MorningError('bad_answer', { status: res.status, step: 'token' });
    const until = Number(b.expiresAt) * 1000 - 60_000;
    kept = Number.isFinite(until) && until > clock() ? { value: b.accessToken, until } : null;
    return b.accessToken;
  }
  async function api(method, path, payload, step) {
    const t = await token();
    const res = await call(`${config.api}${path}`, { method, headers: { authorization: `Bearer ${t}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) }, step);
    if (res.status === 401) kept = null;
    if (!res.ok) await refuse(res, step);
    const b = await body(res);
    if (!b || typeof b !== 'object') throw new MorningError('bad_answer', { status: res.status, step });
    return b;
  }
  /** The first of `urls` that gives a PDF (5 MB at most), as a Buffer; null when none does. Never throws. */
  async function pdf(urls) {
    for (const raw of urls) {
      let u;
      try {
        u = new URL(String(raw));
      } catch {
        continue;
      }
      if (u.protocol !== 'https:') continue;
      for (const withToken of [false, ...(MORNING_HOST.test(u.hostname) ? [true] : [])]) {
        try {
          const res = await call(u.href, { headers: withToken ? { authorization: `Bearer ${await token()}` } : {} }, 'pdf');
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length <= PDF_MAX && buf.subarray(0, 5).toString('latin1') === '%PDF-') return buf;
        } catch {
          /* the next way */
        }
      }
    }
    return null;
  }
  return { mode: config.mode, token, info: () => api('GET', '/documents/info?type=320', null, 'info'), issue: (doc) => api('POST', '/documents', doc, 'issue'), pdf };
}

const label = (p, plan) => (plan && PLAN_NAMES[plan] ? `${PRODUCT_NAMES[p]}, ${PLAN_NAMES[plan]}` : PRODUCT_NAMES[p]);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Why Morning's business does not fit what was charged (`info`, GET /documents/info; `bill`, the receipt's bill_json),
 * as { reason, rate? }, or null when it fits: exempt while VAT was added, a VAT rate other than ours (Morning's is read
 * as a fraction, 0.18, or as percent, 18), or no rate at all.
 */
export function vatProblem(info, bill) {
  if (info?.exemption === true && bill.items.some((i) => i.vat !== 'included')) return { reason: 'exempt' };
  const raw = Number(info?.vatRate);
  if (info?.vatRate == null || !Number.isFinite(raw)) return { reason: 'vat_unknown' };
  const rate = raw > 1 ? raw / 100 : raw;
  return Math.abs(rate - VAT) > 1e-9 ? { reason: 'vat_rate', rate: `${round2(rate * 100)}%` } : null;
}

/** The document Morning is asked for (step 3 above), from the receipt's bill, for `today`. */
export function documentFor({ business, emails, bill, today = israelToday() }) {
  const vatType = (i) => (i.vat === 'included' ? 1 : 0);
  return {
    type: 320,
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    date: today,
    description: MORNING.description(bill.items.map((i) => PRODUCT_NAMES[i.product]).join(SIGNUP.and)),
    client: { name: business, emails, add: true },
    income: bill.items.flatMap((i) => [
      { description: MORNING.monthRow(label(i.product, i.plan), dayHe(i.from), dayHe(i.until)), quantity: 1, price: i.monthly, currency: 'ILS', vatType: vatType(i) },
      ...(i.setup ? [{ description: MORNING.setupRow(label(i.product, i.plan)), quantity: 1, price: i.setup, currency: 'ILS', vatType: vatType(i) }] : []),
    ]),
    payment: [{ date: today, type: 4, price: bill.total, currency: 'ILS' }],
    attachment: true,
    emailContent: MORNING.emailContent,
  };
}

/** The part of a bill before VAT, and the VAT, as an invoice row keeps them. */
function amounts(bill) {
  const before = round2(bill.items.reduce((a, i) => a + (i.vat === 'included' ? (i.monthly + i.setup) / (1 + VAT) : i.monthly + i.setup), 0));
  return { amount: before, vat: round2(bill.total - before) };
}

const owners = (db, workspaceId) =>
  db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL ORDER BY u.id", workspaceId).map((r) => r.email);

/**
 * Issue the invoice-receipt for a receipt the operator marked paid (above). Returns { state, number?, error? }:
 *   off       Morning is not set up (`client` null)
 *   issued    issued now ({ number, invoiceId: the copy in invoices, or null with its link only })
 *   already   it has one; nothing asked
 *   busy      a request for it is out; nothing asked
 *   blocked   Morning's VAT settings do not fit ({ error: { reason, rate? } }); nothing issued
 *   failed    Morning refused or did not answer ({ error: { code, status, detail, step } })
 *   nothing   the receipt is not one marked paid
 */
export async function invoiceReceipt(db, receiptId, { client, by = null, ip = null, today = israelToday() }) {
  if (!client) return { state: 'off' };
  const id = Number(receiptId);
  const claimed = db.run(
    `UPDATE pay_receipts SET morning_state = 'issuing', morning_at = ?, morning_error_json = NULL
      WHERE id = ? AND decision = 'paid' AND bill_json IS NOT NULL AND morning_doc_id IS NULL
        AND (morning_state IS NULL OR morning_state IN ('failed', 'blocked') OR (morning_state = 'issuing' AND morning_at < ?))`,
    nowIso(),
    id,
    new Date(now() - ISSUING_STALE_MS).toISOString()
  );
  if (Number(claimed.changes) !== 1) {
    const r = db.get('SELECT morning_state, morning_doc_id, decision FROM pay_receipts WHERE id = ?', id);
    return { state: r?.morning_doc_id ? 'already' : r?.morning_state === 'issuing' ? 'busy' : 'nothing' };
  }
  const r = db.get('SELECT r.*, w.name AS business FROM pay_receipts r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?', id);
  const bill = j(r.bill_json);
  const stop = (state, error, action, detail) => {
    db.run('UPDATE pay_receipts SET morning_state = ?, morning_error_json = ? WHERE id = ?', state, JSON.stringify(error), id);
    audit(db, { actor: by, action, workspaceId: r.workspace_id, ip, detail: { receipt: id, ...detail } });
    return { state, error };
  };
  let doc;
  try {
    const problem = vatProblem(await client.info(), bill);
    if (problem) return stop('blocked', problem, 'morning_blocked', problem);
    doc = await client.issue(documentFor({ business: r.business, emails: owners(db, r.workspace_id), bill, today }));
    if (doc?.id == null || doc.number == null) throw new MorningError('bad_answer', { step: 'issue' });
  } catch (e) {
    const err = e instanceof MorningError ? { code: e.code, status: e.status, detail: e.detail, step: e.step } : { code: 'error', status: null, detail: '', step: '' };
    return stop('failed', err, 'morning_failed', { code: err.code, status: err.status, step: err.step });
  }
  // Issued: from here on it is never asked for again, whatever happens to the copy.
  const number = String(doc.number).slice(0, 40);
  const links = [doc.url?.origin, doc.url?.he].filter((u) => typeof u === 'string');
  const link = links.find((u) => /^https:\/\//i.test(u)) || null;
  db.run("UPDATE pay_receipts SET morning_state = 'issued', morning_doc_id = ?, morning_doc_number = ?, morning_url = ? WHERE id = ?", String(doc.id), number, link, id);
  audit(db, { actor: by, action: 'morning_issued', workspaceId: r.workspace_id, ip, detail: { receipt: id, number } });
  let invoiceId = null;
  try {
    const file = await client.pdf(links);
    if (file) {
      const first = bill.items[0];
      invoiceId = addInvoice(db, r.workspace_id, { product: first.product, number, issued_on: today, period_from: first.from, period_to: first.until, ...amounts(bill) }, file, { by, ip });
      db.run('UPDATE pay_receipts SET invoice_id = ? WHERE id = ?', invoiceId, id);
    }
  } catch {
    /* the document stands; its link is on the receipt's page */
  }
  return { state: 'issued', number, invoiceId };
}

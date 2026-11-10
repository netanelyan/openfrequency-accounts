import { randomInt } from 'node:crypto';
import { DAY, now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { j } from '../db/index.js';
import { amountDue, PAY_AHEAD_DAYS } from './billing.js';
import { endOfIsraelDay } from './entitlement.js';
import { CODE_ALPHABET, validPhone } from './phones.js';
import { addDays, addMonths, israelToday, payMonth, payTotal } from './subscriptions.js';

// Paying over WhatsApp (docs/internal-pay.md). In manual mode, with the owner's payment details (OF_PAYMENT_METHOD)
// and the owner line's number (OF_ASSISTANT_WA), "לתשלום אוטומטי בוואטסאפ" on /setup and in the billing and welcome emails
// opens WhatsApp to our number with a message already written, and in it the workspace's payment code, PAY-XXXXXX.
// Toran reads the code and asks us what the workspace owes (GET /internal/pay), answers the customer with the amount
// and the transfer details, and posts the picture of the transfer they send back (POST /internal/pay/receipt). We keep
// it and email the operator a link; the operator checks the bank and presses "התשלום הגיע" on /admin/receipts/<id>,
// which records the months the way the console's button does (subscriptions.js payMonth). Toran never records a
// payment, and nothing here moves money: only that press records one.
//
// A code names a workspace for that conversation, nothing more: it signs nobody in, it is not used up, and anyone who
// has it learns only the business's name and what it owes now. So it is kept as it is and lives 60 days; a page or an
// email that needs one takes the workspace's live code while 14 days or more are left on it, and else makes a new one.

export class PayError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const PAY_CODE = /^PAY-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
/** How long a code lives, and how many days must be left on it for a page or an email to give it out again. */
export const PAY_CODE_DAYS = 60;
export const PAY_CODE_REUSE_DAYS = 14;
/** A receipt's file: up to 5 MB, one of these types, checked by its first bytes as well as by what it says it is. */
export const RECEIPT_MAX = 5 * 1024 * 1024;
export const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
/** Receipts one code may bring in an Israel day. More is someone sending the same picture again and again. */
export const RECEIPTS_PER_DAY = 5;

const newPayCode = () => `PAY-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

/**
 * The workspace's payment code to give out now: its live one while 14 days or more are left on it, else a new one,
 * good for 60 days. Returns { code, expiresAt }.
 */
export function payCodeFor(db, workspaceId) {
  return db.tx(() => {
    const keep = new Date(now() + PAY_CODE_REUSE_DAYS * DAY).toISOString();
    const live = db.get('SELECT code, expires_at FROM pay_codes WHERE workspace_id = ? AND expires_at >= ? ORDER BY expires_at DESC LIMIT 1', workspaceId, keep);
    if (live) return { code: live.code, expiresAt: live.expires_at };
    let code;
    do code = newPayCode();
    while (db.get('SELECT 1 FROM pay_codes WHERE code = ?', code));
    const expiresAt = new Date(now() + PAY_CODE_DAYS * DAY).toISOString();
    db.insert('pay_codes', { code, workspace_id: workspaceId, created_at: nowIso(), expires_at: expiresAt });
    return { code, expiresAt };
  });
}

/** The workspace's live code with any days left, without making one (a read-only page), or null. */
export const livePayCode = (db, workspaceId) => {
  const r = db.get('SELECT code, expires_at FROM pay_codes WHERE workspace_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1', workspaceId, nowIso());
  return r ? { code: r.code, expiresAt: r.expires_at } : null;
};

/**
 * A code as Toran passes it on, in any letter case: { code, expiresAt, workspace: { id, name } }. Throws PayError:
 * unknown_code (no such code, or its workspace is disabled or deleted), expired.
 */
export function openPayCode(db, raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  const row = PAY_CODE.test(code) ? db.get('SELECT * FROM pay_codes WHERE code = ?', code) : null;
  const w = row && db.get('SELECT id, name, disabled_at, deleted_at FROM workspaces WHERE id = ?', row.workspace_id);
  if (!w || w.disabled_at || w.deleted_at) throw new PayError('unknown_code');
  if (row.expires_at <= nowIso()) throw new PayError('expired');
  return { code: row.code, expiresAt: row.expires_at, workspace: { id: w.id, name: w.name } };
}

/** What is owed for a code's workspace, the way Toran is told it: now, or a month ahead within the week (billing.js). */
export const dueForPay = (db, workspaceId, today = israelToday()) => amountDue(db, workspaceId, today, { ahead: PAY_AHEAD_DAYS });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A file's type by its first bytes: one of RECEIPT_TYPES, or null. */
export function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const BASE64 = /^[A-Za-z0-9+/_-]*={0,2}$/;

/**
 * The file of a receipt, as Toran sends it ({ name, type, data }, data in base64), checked: { name, type, data }
 * (data a Buffer). Throws PayError: bad (not that shape, or not base64), too_large (over 5 MB), bad_type (not a JPEG,
 * PNG, WebP or PDF, or its bytes are not the type it says).
 */
export function checkFile(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.data !== 'string') throw new PayError('bad');
  const data = file.data.replace(/\s+/g, '');
  if (!BASE64.test(data) || data.length % 4 === 1) throw new PayError('bad');
  // The size before decoding: four characters are three bytes.
  if (Math.floor((data.replace(/=+$/, '').length * 3) / 4) > RECEIPT_MAX) throw new PayError('too_large');
  const type = String(file.type ?? '').toLowerCase().split(';')[0].trim().replace(/^image\/jpg$/, 'image/jpeg');
  if (!Object.hasOwn(RECEIPT_TYPES, type)) throw new PayError('bad_type');
  const buf = Buffer.from(data, 'base64');
  if (buf.length > RECEIPT_MAX) throw new PayError('too_large');
  if (sniff(buf) !== type) throw new PayError('bad_type');
  const name =
    String(file.name ?? '')
      .replace(/[\u0000-\u001f\u007f"\\/<>‎‏‪-‮⁦-⁩]/g, '')
      .trim()
      .slice(0, 120) || `receipt.${RECEIPT_TYPES[type]}`;
  return { name, type, data: buf };
}

// What Toran read on the picture (POST /internal/pay/receipt's optional `check`). It comes from a model reading a
// screenshot, so it is held as text for the operator to weigh and decides nothing: only these keys, each of its type
// or dropped, every string without control or bidi characters and at most 80 characters, every verdict one of its
// words. payeeName and reference are whatever was on the picture: the pages and the email escape them, and nothing
// puts them in a link.
const VERDICTS = { amount: ['ok', 'mismatch', 'unknown'], date: ['ok', 'too_old', 'future', 'unknown'], account: ['ok', 'mismatch', 'unknown'] };
const BIDI = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g;
const text80 = (v) => (typeof v === 'string' ? v.replace(BIDI, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined : undefined);
const sum = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000_000 ? Math.round(v * 100) / 100 : undefined);
const pick = (o) => {
  const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return Object.keys(kept).length ? kept : undefined;
};
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Toran's reading of the picture, checked (above): { readable, isTransfer, amount, date, account, payeeName, reference }, or null. */
export function checkOf(raw) {
  if (!isObj(raw)) return null;
  const verdict = (part, v) => (VERDICTS[part].includes(v) ? v : undefined);
  return (
    pick({
      readable: typeof raw.readable === 'boolean' ? raw.readable : undefined,
      isTransfer: typeof raw.isTransfer === 'boolean' ? raw.isTransfer : undefined,
      amount: isObj(raw.amount) ? pick({ seen: sum(raw.amount.seen), expected: sum(raw.amount.expected), verdict: verdict('amount', raw.amount.verdict) }) : undefined,
      date: isObj(raw.date) ? pick({ seen: text80(raw.date.seen), verdict: verdict('date', raw.date.verdict) }) : undefined,
      account: isObj(raw.account) ? pick({ seen: text80(raw.account.seen), verdict: verdict('account', raw.account.verdict) }) : undefined,
      payeeName: text80(raw.payeeName),
      reference: text80(raw.reference),
    }) || null
  );
}

/**
 * The workspace's earlier receipt with these very bytes that waits or was marked paid, or null (the owner, 2026-11-02:
 * the same picture sent twice made two receipts, and "התשלום הגיע" on each would record two months). One marked "לא
 * הגיע" is not counted: the same picture sent again after that is the customer saying it did go through, so it is kept
 * and the operator hears of it again.
 */
export function sameReceipt(db, workspaceId, bytes) {
  const r = db.get("SELECT id, created_at, items_json, check_json FROM pay_receipts WHERE workspace_id = ? AND size = ? AND file = ? AND (decided_at IS NULL OR decision = 'paid') ORDER BY id LIMIT 1", workspaceId, bytes.length, bytes);
  return r ? { id: r.id, created_at: r.created_at, due: j(r.items_json), check: j(r.check_json) } : null;
}

/** How many receipts a code brought today (an Israel day). */
export const receiptsToday = (db, code, today = israelToday()) => db.get('SELECT COUNT(*) AS n FROM pay_receipts WHERE code = ? AND created_at > ?', code, endOfIsraelDay(addDays(today, -1))).n;

/**
 * A receipt from Toran: kept with what the workspace owed at that moment, and in the audit log (never the code).
 * `check`, what Toran read on the picture, is kept as checkOf() leaves it. Returns { id, workspace: { id, name }, due,
 * check, createdAt }, and `again: true` when it is the same file as one of the workspace's receipts that waits or was
 * marked paid (sameReceipt()): that one is returned and nothing is kept or logged again. Throws PayError: bad_phone,
 * unknown_code, expired, bad, too_large, bad_type, rate_limited (5 from one code in an Israel day).
 */
export function addReceipt(db, { code, phone, file, check = null }) {
  if (!validPhone(phone)) throw new PayError('bad_phone');
  const c = openPayCode(db, code);
  const f = checkFile(file);
  const read = checkOf(check);
  return db.tx(() => {
    const same = sameReceipt(db, c.workspace.id, f.data);
    if (same) return { id: same.id, workspace: c.workspace, due: same.due, check: same.check, createdAt: same.created_at, again: true };
    if (receiptsToday(db, c.code) >= RECEIPTS_PER_DAY) throw new PayError('rate_limited');
    const due = dueForPay(db, c.workspace.id);
    const createdAt = nowIso();
    const id = db.insert('pay_receipts', { workspace_id: c.workspace.id, code: c.code, phone, created_at: createdAt, name: f.name, type: f.type, size: f.data.length, file: f.data, items_json: due, check_json: read });
    audit(db, { action: 'pay_receipt_received', workspaceId: c.workspace.id, detail: { receipt: id, phone, type: f.type, size: f.data.length, total: due.total } });
    return { id, workspace: c.workspace, due, check: read, createdAt };
  });
}

const RECEIPT = `SELECT r.*, w.name AS business, u.email AS decided_by_email FROM pay_receipts r
  JOIN workspaces w ON w.id = r.workspace_id
  LEFT JOIN users u ON u.id = r.decided_by`;
const out = (r) => (r ? { ...r, due: j(r.items_json, { items: [], lines: [], total: 0, net: 0, vat: 0 }), check: j(r.check_json), bill: j(r.bill_json), morningError: j(r.morning_error_json) } : null);

/** One receipt, with its business and what was owed when it came (`due`), or null. */
export const receiptById = (db, id) => out(db.get(`${RECEIPT} WHERE r.id = ?`, Number(id)));

/**
 * The number a workspace last paid from: the phone of its latest receipt the operator marked paid ("התשלום הגיע"), or
 * null. That number wrote to us about this very payment, and the money was found; one waiting, or marked "לא הגיע", may
 * be a mistake or someone else's, so it counts for nothing. The payment reminders on WhatsApp go to it (src/web/daily.js).
 */
export const paidFrom = (db, workspaceId) => db.get("SELECT phone FROM pay_receipts WHERE workspace_id = ? AND decision = 'paid' AND code != ? ORDER BY decided_at DESC, id DESC LIMIT 1", workspaceId, MANUAL)?.phone ?? null;

// ---- a payment the operator recorded by hand
//
// "התקבל תשלום לחודש" on /admin records a month with no picture of a transfer (a payment that came some other way).
// It is kept as a receipt already marked paid, code MANUAL and no file, so its invoice-receipt is issued in Morning
// exactly as one from "התשלום הגיע" is, with the same guard against a second document (the owner, 2026-11-10: "I did
// not get an invoice, for my 1.18NIS payment. Not as a customer, nor as the seller": that button issued none). Its
// phone is empty, and paidFrom() never takes it.

export const MANUAL = 'MANUAL';

/** The bill of one product's month, as the invoice says it: its price as recorded, the setup fee on its first month. */
export function monthBill(sub, product, until, { first = false } = {}) {
  const vat = sub.vat === 'included' ? 'included' : 'excluded';
  const monthly = Number(sub.monthly || 0);
  const setup = first ? Number(sub.setup || 0) : 0;
  const parts = [{ sum: monthly, vat }, ...(setup ? [{ sum: setup, vat }] : [])];
  const item = { product, plan: sub.plan ?? null, monthly, setup, vat, total: payTotal(parts).total, from: addMonths(addDays(until, 1), -1), until };
  return { items: [item], ...payTotal(parts) };
}

/** The month recorded by hand, kept as a receipt marked paid (above). Returns its id. */
export function manualReceipt(db, workspaceId, bill, { by = null, ip = null } = {}) {
  const at = nowIso();
  const id = db.insert('pay_receipts', { workspace_id: workspaceId, code: MANUAL, phone: '', created_at: at, name: 'נרשם ידנית', type: 'application/pdf', size: 0, file: null, items_json: JSON.stringify({ items: [], lines: [], total: bill.total, net: bill.net, vat: bill.vat }), decided_at: at, decided_by: by?.id ?? null, decision: 'paid', bill_json: JSON.stringify(bill) });
  audit(db, { actor: by, action: 'pay_manual', workspaceId, ip, detail: { receipt: id, product: bill.items[0]?.product, until: bill.items[0]?.until, total: bill.total } });
  return id;
}

/** Whether a month paid until `until` already has a receipt marked paid (by hand or from a transfer's picture). */
export const monthReceipted = (db, workspaceId, product, until) =>
  db.all("SELECT bill_json FROM pay_receipts WHERE workspace_id = ? AND decision = 'paid' AND bill_json IS NOT NULL", workspaceId).some((r) => (j(r.bill_json)?.items || []).some((i) => i.product === product && i.until === until));

/** The receipts nobody has decided on yet, newest first, without their files: the list on /admin. */
export const receiptsWaiting = (db) =>
  db.all(`SELECT r.id, r.workspace_id, r.phone, r.created_at, r.type, r.items_json, w.name AS business FROM pay_receipts r JOIN workspaces w ON w.id = r.workspace_id WHERE r.decided_at IS NULL AND w.deleted_at IS NULL ORDER BY r.created_at DESC, r.id DESC`).map(out);

/**
 * The products "התשלום הגיע" records a month for: those owed when the receipt came; when nothing was, those owed now
 * (as Toran would quote them). { products, from: 'then' | 'now', now } with `now` what is owed today.
 */
export function receiptProducts(db, receipt, today = israelToday()) {
  const nowDue = dueForPay(db, receipt.workspace_id, today);
  const then = (receipt.due?.items || []).map((i) => i.product);
  return then.length ? { products: then, from: 'then', now: nowDue } : { products: nowDue.items.map((i) => i.product), from: 'now', now: nowDue };
}

/**
 * The operator's answer to a receipt. 'paid' records a month for each of receiptProducts() with payMonth(), `expects`
 * ({ product: the paid-until day the page showed, '' for none }) guarding each the way the console's button is
 * guarded, all in one transaction: an already_paid (WorkspaceError) records nothing at all. 'not_paid' records
 * nothing. Returns { recorded: [{ product, until }] }. Throws PayError: no_receipt, already_paid ('paid' on a receipt
 * already marked paid: its form sent again, at once or later; nothing recorded, emailed or invoiced again), decided
 * (answered already, otherwise), nothing_due ('paid' with nothing to record). A receipt is decided once, so it is its
 * own one-time token. 'paid' also keeps what it recorded, as the invoice says it (bill_json, src/accounts/morning.js):
 * each product's month (from, until), its price as the customer was asked, the total with VAT.
 */
export function decideReceipt(db, id, decision, { by, ip = null, expects = {} }, today = israelToday()) {
  return db.tx(() => {
    const r = receiptById(db, id);
    if (!r) throw new PayError('no_receipt');
    const claimed = db.run('UPDATE pay_receipts SET decided_at = ?, decided_by = ?, decision = ? WHERE id = ? AND decided_at IS NULL', nowIso(), by?.id ?? null, decision, r.id);
    if (Number(claimed.changes) !== 1) throw new PayError(decision === 'paid' && r.decision === 'paid' ? 'already_paid' : 'decided');
    const recorded = [];
    if (decision === 'paid') {
      const { products, from, now: owedNow } = receiptProducts(db, r, today);
      if (!products.length) throw new PayError('nothing_due');
      for (const p of products) recorded.push({ product: p, until: payMonth(db, r.workspace_id, p, { by, ip, expect: String(expects[p] ?? '') }, today) });
      const lines = (from === 'then' ? r.due : owedNow).lines || [];
      const items = recorded.map(({ product, until }) => {
        const l = lines.find((x) => x.product === product && x.item);
        return { product, plan: l.plan ?? null, monthly: l.item.monthly, setup: l.item.setup, vat: l.vat === 'included' ? 'included' : 'excluded', total: l.item.total, from: addMonths(addDays(until, 1), -1), until };
      });
      const parts = items.flatMap((i) => [{ sum: i.monthly, vat: i.vat }, ...(i.setup ? [{ sum: i.setup, vat: i.vat }] : [])]);
      db.run('UPDATE pay_receipts SET bill_json = ? WHERE id = ?', JSON.stringify({ items, ...payTotal(parts) }), r.id);
    }
    audit(db, { actor: by, action: decision === 'paid' ? 'pay_receipt_paid' : 'pay_receipt_not_paid', workspaceId: r.workspace_id, ip, detail: { receipt: r.id, recorded } });
    return { recorded, receipt: r };
  });
}

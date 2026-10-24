import { nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { WorkspaceError, getWorkspace } from './workspaces.js';
import { day, money } from './subscriptions.js';

// A workspace's invoices. They are issued by the accountant's invoicing service, never here: Accounts keeps a copy
// of each (the number as issued, the date, the days it pays for, the amount and its VAT, and the PDF) so the customer
// finds every one of them on their home page. The operator records them on /admin, next to a month's payment.

/** The largest PDF kept. An invoice is a page or two; this is far above that. */
export const PDF_MAX = 5 * 1024 * 1024;

const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString('latin1') === '%PDF-';

/** Record an invoice from the admin form, with its PDF (a Buffer). Throws WorkspaceError. Returns its id. */
export function addInvoice(db, workspaceId, form, pdf, { by, ip = null }) {
  const w = getWorkspace(db, workspaceId);
  if (!PRODUCTS.includes(form.product)) throw new WorkspaceError('bad_product');
  const number = String(form.number ?? '').trim();
  if (!number || number.length > 40) throw new WorkspaceError('bad_number');
  const issued_on = day(form.issued_on);
  if (!issued_on) throw new WorkspaceError('bad_date');
  const period_from = day(form.period_from);
  const period_to = day(form.period_to);
  if (Boolean(period_from) !== Boolean(period_to) || (period_from && period_to < period_from)) throw new WorkspaceError('bad_period');
  const amount = money(form.amount);
  const vat = money(form.vat);
  if (amount == null || vat == null) throw new WorkspaceError('bad_amount');
  if (!pdf?.length || !isPdf(pdf)) throw new WorkspaceError('bad_pdf');
  if (pdf.length > PDF_MAX) throw new WorkspaceError('pdf_too_large');
  const id = db.insert('invoices', { workspace_id: w.id, product: form.product, number, issued_on, period_from, period_to, amount, vat, pdf, created_by: by?.id ?? null, created_at: nowIso() });
  audit(db, { actor: by, action: 'invoice_added', workspaceId: w.id, ip, detail: { product: form.product, number, issued_on, amount, vat } });
  return id;
}

/** A workspace's invoices, newest first, without their PDFs. */
export const invoicesOf = (db, workspaceId) =>
  db.all(
    'SELECT id, workspace_id, product, number, issued_on, period_from, period_to, amount, vat, length(pdf) AS size FROM invoices WHERE workspace_id = ? ORDER BY issued_on DESC, id DESC',
    workspaceId
  );

/** One invoice with its PDF, only when it belongs to `workspaceId`; null otherwise. */
export const invoiceIn = (db, id, workspaceId) => db.get('SELECT * FROM invoices WHERE id = ? AND workspace_id = ?', Number(id), Number(workspaceId));

/** Take back an invoice recorded by mistake (the invoicing service keeps the real one). */
export function removeInvoice(db, id, { by, ip = null }) {
  const row = db.get('SELECT id, workspace_id, product, number FROM invoices WHERE id = ?', Number(id));
  if (!row) return null;
  db.run('DELETE FROM invoices WHERE id = ?', row.id);
  audit(db, { actor: by, action: 'invoice_removed', workspaceId: row.workspace_id, ip, detail: { product: row.product, number: row.number } });
  return row;
}

/** The total with VAT, to the agora. */
export const total = (inv) => Math.round((inv.amount + inv.vat) * 100) / 100;

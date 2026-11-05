import { israelToday } from '../accounts/subscriptions.js';
import { assistantWa, payHow } from '../accounts/billing.js';
import { dueForPay, livePayCode, payCodeFor } from '../accounts/pay.js';
import { PAY } from './copy.js';
import { paySummary } from './html.js';

// The web's side of paying over WhatsApp (src/accounts/pay.js, docs/internal-pay.md): the button's link, for /setup
// and the emails, and the answer Toran gets from GET /internal/pay.

/**
 * Where "לתשלום אוטומטי בוואטסאפ" leads for a workspace: our owner line's WhatsApp (OF_ASSISTANT_WA) with PAY.waText() written,
 * the workspace's code at its end. Only in manual mode with the owner's payment details (OF_PAYMENT_METHOD) and the
 * number both set, and only while something is owed (now, or a month ahead within the week: dueForPay()); else null,
 * and every page and email says what it said before. `mint` false (a read-only view) uses a live code and makes
 * none: { href: null } when there is none. Returns { href } or null.
 */
export function payOverWa(db, { env = process.env, workspaceId, business, today = israelToday(), mint = true }) {
  const to = assistantWa(env);
  if (!payHow(env) || !to) return null;
  if (!dueForPay(db, workspaceId, today).items.length) return null;
  const code = mint ? payCodeFor(db, workspaceId) : livePayCode(db, workspaceId);
  return { href: code ? `https://wa.me/${to}?text=${encodeURIComponent(PAY.waText(business, code.code))}` : null };
}

/**
 * The answer of GET /internal/pay, exactly as docs/internal-pay.md has it: the code, its workspace, what is owed now
 * (amountDue()'s items and totals), the summary lines, how to pay (OF_PAYMENT_METHOD, or null) and, with nothing owed,
 * the earliest day a product is paid until (YYYY-MM-DD), else null.
 */
export function payAnswer(open, due, env = process.env) {
  const paid = due.lines.filter((l) => l.kind === 'paid' && l.paidUntil).map((l) => l.paidUntil).sort();
  return {
    code: open.code,
    expiresAt: open.expiresAt,
    workspace: open.workspace,
    items: due.items,
    net: due.net,
    vat: due.vat,
    total: due.total,
    vatIncluded: due.vatIncluded,
    summary: paySummary(due),
    payHow: payHow(env) || null,
    paidThrough: due.items.length ? null : (paid[0] ?? null),
  };
}

import { DAY, HOUR, now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { j } from '../db/index.js';
import { PRODUCTS } from '../db/schema.js';
import { addDays, addMonths, graceChange, graceLast, israelToday, NOTICE_DAYS, TERMS_72H, withVat } from '../accounts/subscriptions.js';
import { eraseWorkspace, productsEver } from '../accounts/erase.js';
import { checkoutUrl, payHow, paymentMode, supportWa } from '../accounts/billing.js';
import { payCodeFor } from '../accounts/pay.js';
import { ownersOf as linkedNumbers } from '../accounts/phones.js';
import { signupNotify, TERMS_URL } from '../accounts/signup.js';
import { billingMail, billingNoticeMail, idleMail, idleNoticeMail, termsNoticeMail } from '../mail/messages.js';
import { MAIL, PAY, ils } from './copy.js';
import { eraseClient } from './erase.js';
import { accountsBase } from './internal.js';
import { payOverWa } from './pay.js';
import { remindClient, REMIND_KINDS } from './remind.js';

// The daily jobs, once an Israel day from 09:00 (startDaily(), which scripts/web.js runs; `npm run daily` runs them by
// hand). Each run is kept in daily_runs, and what it did is logged with its counts.
//
// 1. Billing (ACC-01). For each subscription that has been paid and is not cancelled, comp or off, in a workspace that
//    is open, each owner gets one email of each kind for each end of a paid period (billing_notices). The terms give
//    72 hours after the paid month ends (subscriptions.js GRACE_HOURS): the 3 days after paid_until, to graceLast()
//    (4 days when the clocks go forward in them, so never less than 72 hours).
//      soon7    a week before the next payment falls due (the day after paid_until), on the first run in that week
//      soon1    the day before: paid_until itself, the paid month's last day
//      due      the first day after it: the month is over, the product goes on working to the end of graceLast(),
//               and then it stops until paid (entitlement.js 'due'). Sent on a later day of it if that day's run
//               was missed
//      last     graceLast() itself: today is the last day to pay before it stops
//      stopped  the grace is over (sent within the 7 days after)
//    Each day owes one kind at most and the kinds follow each other day by day, at a month's end too (the days are
//    counted on the calendar, addDays()), so none is skipped and none goes with another. The operator
//    (OF_SIGNUP_NOTIFY) hears of each due and stopped. A recorded payment moves paid_until on, and the
//    next period's emails follow it. How to pay follows the payment mode (OF_PAYMENT, src/accounts/billing.js): with a
//    provider, soon, due and last lead to its payment page ("לתשלום"); in manual mode, they say to pay by the details
//    we emailed (and how, OF_PAYMENT_METHOD, when set) and whom to ask, and lead to the account. In manual mode with
//    OF_PAYMENT_METHOD and OF_ASSISTANT_WA both set, they lead instead to "לתשלום בוואטסאפ" (src/web/pay.js):
//    our owner line, with the message and the workspace's payment code written, where Toran gives the amount.
//    A workspace on the terms from before 2026-11-03 keeps their 14 days for a payment that falls due before its
//    change date (subscriptions.js graceChange()), and its emails say so: due on the first of them, last on the 14th.
//
//    On WhatsApp too (whatsappReminders, src/web/remind.js; the owner, 2026-11-03: "add a reminder to pay for the new
//    month, whatsapp, email and dashboard"): soon1, due and last, never soon7 or stopped, so three a paid month at
//    most. Each goes once, when its email does (the same billing_notices row), to each number in user_phones of the
//    workspace's owners whose latest word is not an opt-out ("הפסק"), after the emails and whatever happens to it. A
//    workspace's products that owe the same kind on the same dates are one message. Only in manual mode with
//    OF_PAYMENT_METHOD set: the message's one button, "לתשלום", carries the workspace's payment code (never shown), and
//    Toran answers it with the amount and the transfer's details, as it answers "לתשלום בוואטסאפ". Each is handed to
//    Toran on this machine (POST /internal/pay/remind, docs/contracts/pay-remind.json), which sends the approved
//    template payment_reminder from our number. Toran not taking one (down, slow, refusing the request) is a line in
//    the log and stops that run's other reminders; nothing is sent again later. A workspace with no linked number gets
//    the email alone.
//
//    Before the billing, the change to the 72 hours (termsNotices): each workspace on the old terms that can be billed
//    (open, with a product on that is not complimentary) is emailed it, to each owner, on the first run after
//    2026-11-03 or the first once it can be billed: from <change date> a new month's payment that has not come within
//    72 hours of the end of the paid month stops the service until paid; until then nothing changes; a reminder comes
//    before each month ends; a button to the terms. Each email is sent with the mailer's deliver(), which waits for
//    Resend: terms_notices is written only once Resend has accepted the first one, with that day and the change date,
//    the day after the 30 whole days that follow it (the terms' 30 days' notice), and never moves after. An email
//    Resend refused, or one only written to the outbox (no RESEND_API_KEY), counts as not sent: it is logged loudly and
//    tried again on the next run, and with none sent nothing is kept, so the 30 days start from the day one is. An
//    owner not reached while others were is tried again each day until the change date, under the same date. With no
//    owner to email, nothing is kept and the workspace keeps the 14 days. A complimentary workspace is not emailed
//    until it can be billed.
//
// 2. Retention (ACC-07, PRA-DB-005), the periods the privacy policy states:
//      sign-ups never confirmed                       deleted 30 days after the form was sent
//      links and codes (magic, invites, WhatsApp,     deleted 30 days after they ended
//      payment codes)
//      sessions                                       deleted 90 days after they ended (expired or signed out)
//      the notification log                           90 days
//      a transfer's picture sent to Toran             the file deleted 90 days after it came (src/accounts/pay.js);
//                                                     the row (who sent it, when, what was owed, the operator's
//                                                     answer) is kept, as the record of the payment
//      a workspace never paid for, not complimentary, with no invoice, that nobody has used for 6 months (no sign-in,
//      no page seen): its owners are emailed, and 14 days later it is deleted the normal way, every product asked
//      first (src/web/erase.js, src/accounts/erase.js). Someone signing in, a payment or comp takes it off the list.
//    Kept on purpose: invoices (7 years, the tax law), the audit log (the security record), and the opt-in and
//    opt-out records of WhatsApp numbers while the number is linked.

export const RETENTION = { signupDays: 30, linkDays: 30, sessionDays: 90, notifyLogDays: 90, billingNoticeDays: 400, receiptFileDays: 90, idleMonths: 6, idleWarnDays: 14 };
/** The Israel hour the run starts at, or after: emails go out in the morning, not at midnight. */
export const RUN_HOUR = 9;

const israelHour = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
const isoBefore = (days, t) => new Date(t - days * DAY).toISOString();
/** An address in a log line: its first letter and its domain ("n***@example.com"). */
const masked = (email) => String(email).replace(/^(.).*?(@|$)/, (_, a, at) => `${a}***${at}`);
const ownersOf = (db, workspaceId) =>
  db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL", workspaceId).map((r) => r.email);

/** Which billing email a subscription paid until `paidUntil` is owed on `today`, or null. `change`: graceChange(). */
export function billingKind(paidUntil, today, change = null) {
  const dueOn = addDays(paidUntil, 1);
  const last = graceLast(paidUntil, change);
  if (today > last) return today <= addDays(last, 7) ? 'stopped' : null;
  if (today === last) return 'last';
  if (today >= dueOn) return 'due';
  if (today === paidUntil) return 'soon1';
  if (today >= addDays(dueOn, -7)) return 'soon7';
  return null;
}

function billing(db, { mailer, env, base, notifyTo, today }) {
  const rows = db.all(
    `SELECT s.*, w.name AS business, w.terms_version, n.change_on AS terms_change_on FROM subscriptions s
       JOIN workspaces w ON w.id = s.workspace_id
       LEFT JOIN terms_notices n ON n.workspace_id = s.workspace_id
       JOIN workspace_products wp ON wp.workspace_id = s.workspace_id AND wp.product = s.product
      WHERE wp.enabled = 1 AND wp.comp = 0 AND w.disabled_at IS NULL AND w.deleted_at IS NULL
        AND s.paid_until IS NOT NULL AND s.cancelled_at IS NULL AND s.ends_on IS NULL`
  );
  const provider = paymentMode(env) === 'provider';
  // With the owner's details (OF_PAYMENT_METHOD) the email gives them; without, it points to the ones we emailed.
  const pay = provider ? MAIL.payByProvider : [...(payHow(env) ? [MAIL.welcomePayHow(payHow(env)), MAIL.receipt(supportWa(env))] : [MAIL.payByUs]), MAIL.payAsk(supportWa(env))];
  // Paying over WhatsApp (src/web/pay.js): the same details, the line that says to send the message as it is in place
  // of the receipt's, and the button to our owner line with the message written.
  const payWa = [MAIL.welcomePayHow(payHow(env)), PAY.explain, MAIL.payAsk(supportWa(env))];
  const sent = { soon7: 0, soon1: 0, due: 0, last: 0, stopped: 0 };
  // What goes on WhatsApp too, once its emails went (whatsappReminders).
  const owed = [];
  for (const s of rows) {
    const change = graceChange(s.terms_version, s.terms_change_on);
    const kind = billingKind(s.paid_until, today, change);
    if (!kind) continue;
    const dueOn = addDays(s.paid_until, 1);
    const fresh = db.run('INSERT INTO billing_notices (workspace_id, product, kind, due_on, sent_at, recipients) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT DO NOTHING', s.workspace_id, s.product, kind, dueOn, nowIso());
    if (Number(fresh.changes) !== 1) continue;
    const to = ownersOf(db, s.workspace_id);
    const wa = !provider && kind !== 'stopped' ? payOverWa(db, { env, workspaceId: s.workspace_id, business: s.business, today }) : null;
    const fields = { kind, business: s.business, product: s.product, paidUntil: s.paid_until, dueOn, graceUntil: graceLast(s.paid_until, change), amount: MAIL.amount(ils(s.monthly ?? 0), s.vat !== 'included', ils(withVat(s.monthly ?? 0, s.vat))), pay: wa?.href ? payWa : pay, link: `${base}/setup` };
    const online = provider ? { payLink: checkoutUrl(s.workspace_id, env), payButton: MAIL.payOnlineButton } : wa?.href ? { payLink: wa.href, payButton: PAY.button } : {};
    for (const email of to) mailer.send(billingMail(email, { ...fields, ...online }));
    db.run('UPDATE billing_notices SET recipients = ? WHERE workspace_id = ? AND product = ? AND kind = ? AND due_on = ?', to.length, s.workspace_id, s.product, kind, dueOn);
    if (kind === 'due' || kind === 'stopped') for (const op of notifyTo) mailer.send(billingNoticeMail(op, { ...fields, link: `${base}/admin/accounts#ws-${s.workspace_id}` }));
    audit(db, { action: `billing_${kind}`, workspaceId: s.workspace_id, detail: { product: s.product, due_on: dueOn, recipients: to.length } });
    sent[kind]++;
    if (REMIND_KINDS.includes(kind)) owed.push({ workspace: s.workspace_id, business: s.business, product: s.product, kind, paidUntil: s.paid_until, graceUntil: fields.graceUntil });
  }
  return { sent, owed };
}

/** A number in a log line or the audit log: its last four digits. */
const lastFour = (phone) => `…${String(phone).slice(-4)}`;

/**
 * Today's billing emails that also go on WhatsApp (above, 1), handed to Toran one by one (`reminder`, src/web/remind.js).
 * Returns { sent, notSent, notTried }: sent by Toran; answered and not sent (already, held, failed); not taken by Toran,
 * with the run's others after it, which are not tried.
 */
async function whatsappReminders(db, { env, owed, reminder, log }) {
  const out = { sent: 0, notSent: 0, notTried: 0 };
  if (!owed.length) return out;
  if (!payHow(env)) {
    const why = paymentMode(env) === 'provider' ? 'with a payment provider on, the reminder has no transfer details to give' : 'OF_PAYMENT_METHOD is unset, so the reminder would have no transfer details to give';
    log(`[accounts] daily: ${owed.length} of today's billing emails would also go on WhatsApp, and none does: ${why}`);
    return out;
  }
  const groups = new Map();
  for (const o of owed) {
    const key = `${o.workspace}:${o.kind}:${o.paidUntil}:${o.graceUntil}`;
    if (!groups.has(key)) groups.set(key, { ...o, products: [] });
    groups.get(key).products.push(o.product);
  }
  const list = [];
  for (const g of groups.values()) {
    const phones = linkedNumbers(db, g.workspace).filter((p) => p.role === 'client_owner' && !p.optOut && !p.workspace.disabled);
    if (!phones.length) continue;
    const code = payCodeFor(db, g.workspace).code;
    const products = PRODUCTS.filter((p) => g.products.includes(p));
    for (const p of phones) list.push({ workspace: g.workspace, phone: p.phone, kind: g.kind, business: g.business, products, paidUntil: g.paidUntil, graceUntil: g.graceUntil, code });
  }
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const who = `WhatsApp reminder to ${lastFour(r.phone)} (workspace ${r.workspace}, ${r.kind})`;
    const a = await reminder.remind(r);
    audit(db, { action: 'billing_whatsapp', workspaceId: r.workspace, detail: { kind: r.kind, products: r.products, paid_until: r.paidUntil, phone: lastFour(r.phone), outcome: a.taken ? (a.sent ? 'sent' : a.why) : 'not_taken' } });
    if (a.taken && a.sent) {
      out.sent++;
      continue;
    }
    if (a.taken) {
      out.notSent++;
      log(`[accounts] daily: ${who} not sent: Toran said ${a.why}; the email went as always`);
      continue;
    }
    // Toran down, slow, or refusing the request itself: the rest would fare the same, so they are not tried.
    const rest = list.length - i - 1;
    out.notTried += rest + 1;
    log(`[accounts] daily: ${who}: Toran did not take it (${a.why}); the email went as always${rest ? `, and the ${rest} other WhatsApp reminder${rest === 1 ? '' : 's'} of today ${rest === 1 ? 'is' : 'are'} not tried` : ''}. None is sent again later`);
    break;
  }
  return out;
}

/**
 * The change to the 72 hours, emailed to each owner of each workspace on the old terms that can be billed (above, 1),
 * each email awaited (mailer.deliver()). Returns how many workspaces it reached someone in on this run.
 */
async function termsNotices(db, { mailer, today, log }) {
  const rows = db.all(
    `SELECT w.id, w.name, n.change_on, n.told_json FROM workspaces w
       LEFT JOIN terms_notices n ON n.workspace_id = w.id
      WHERE w.deleted_at IS NULL AND w.disabled_at IS NULL
        AND (w.terms_version IS NULL OR w.terms_version < ?)
        AND (n.workspace_id IS NULL OR n.change_on > ?)
        AND EXISTS (SELECT 1 FROM workspace_products wp WHERE wp.workspace_id = w.id AND wp.enabled = 1 AND wp.comp = 0)`,
    TERMS_72H,
    today
  );
  // A mailer that cannot say whether an email went (a stand-in without deliver()) never counts as sent.
  const deliver = (msg) => (typeof mailer.deliver === 'function' ? mailer.deliver(msg) : Promise.resolve({ sent: false, error: 'this mailer cannot confirm a send' }));
  let reached = 0;
  for (const w of rows) {
    const told = new Set(j(w.told_json, []));
    const owners = db
      .all("SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL ORDER BY u.id", w.id)
      .filter((o) => !told.has(o.id));
    if (!owners.length) continue;
    // Not kept yet: the date if the first email goes today. Kept: its own date, which never moves.
    const changeOn = w.change_on || addDays(today, NOTICE_DAYS + 1);
    let now_ = 0;
    for (const o of owners) {
      const r = await deliver(termsNoticeMail(o.email, { business: w.name, changeOn, link: `${TERMS_URL}#t-price` }));
      if (!r.sent) {
        log(`[terms] notice to ${masked(o.email)} (workspace ${w.id}) FAILED: ${r.outbox ? 'no RESEND_API_KEY, written to the outbox and not sent' : r.error}; tried again tomorrow`);
        continue;
      }
      told.add(o.id);
      now_++;
      // Kept at once after each email that went, so a run cut short loses none of them.
      db.run(
        'INSERT INTO terms_notices (workspace_id, sent_at, sent_on, change_on, told_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET told_json = excluded.told_json',
        w.id,
        nowIso(),
        today,
        changeOn,
        JSON.stringify([...told])
      );
    }
    if (!now_) continue;
    audit(db, { action: 'terms_notice_sent', workspaceId: w.id, detail: { change_on: changeOn, now: now_, reached: told.size } });
    reached++;
  }
  return reached;
}

/**
 * The workspaces the idle rule applies to on `today`, with when each was last used: never paid, not comp, no invoice,
 * not deleted, and nobody in it signed in or saw a page since `before` (an ISO instant), counting its creation.
 */
export function idleWorkspaces(db, before) {
  return db.all(
    `SELECT w.id, w.name, max(w.created_at, coalesce(max(u.last_login_at), ''), coalesce((SELECT max(last_seen_at) FROM sessions WHERE workspace_id = w.id), '')) AS used_at
       FROM workspaces w
       LEFT JOIN memberships m ON m.workspace_id = w.id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE w.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM workspace_products wp WHERE wp.workspace_id = w.id AND wp.comp = 1)
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.workspace_id = w.id AND s.paid_until IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.workspace_id = w.id)
      GROUP BY w.id
     HAVING used_at < ?`,
    before
  );
}

async function retention(db, { mailer, base, notifyTo, eraser, log, today, t }) {
  const n = (r) => Number(r.changes);
  const out = {
    signups: n(db.run('DELETE FROM signups WHERE used_at IS NULL AND created_at < ?', isoBefore(RETENTION.signupDays, t))),
    links: n(db.run('DELETE FROM tokens WHERE expires_at < ?', isoBefore(RETENTION.linkDays, t))) + n(db.run('DELETE FROM phone_links WHERE expires_at < ?', isoBefore(RETENTION.linkDays, t))),
    sessions: n(db.run('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', isoBefore(RETENTION.sessionDays, t), isoBefore(RETENTION.sessionDays, t))),
    notifyLog: n(db.run('DELETE FROM notify_log WHERE at < ?', isoBefore(RETENTION.notifyLogDays, t))),
    billingNotices: n(db.run('DELETE FROM billing_notices WHERE sent_at < ?', isoBefore(RETENTION.billingNoticeDays, t))),
    payCodes: n(db.run('DELETE FROM pay_codes WHERE expires_at < ?', isoBefore(RETENTION.linkDays, t))),
    receiptFiles: n(db.run('UPDATE pay_receipts SET file = NULL WHERE file IS NOT NULL AND created_at < ?', isoBefore(RETENTION.receiptFileDays, t))),
    idleWarned: 0,
    idleDeleted: 0,
    idleFailed: 0,
  };

  // Used for six months less the warning: warned. Used for six months, and warned at least 14 days ago: deleted.
  const sixMonths = `${addMonths(today, -RETENTION.idleMonths)}T00:00:00.000Z`;
  const warnFrom = `${addDays(addMonths(today, -RETENTION.idleMonths), RETENTION.idleWarnDays)}T00:00:00.000Z`;
  const warnable = idleWorkspaces(db, warnFrom);
  const still = new Set(warnable.map((w) => w.id));
  // Off the list: someone came back, it was paid or made comp, or it is gone.
  for (const r of db.all('SELECT workspace_id FROM retention_notices')) if (!still.has(r.workspace_id)) db.run('DELETE FROM retention_notices WHERE workspace_id = ?', r.workspace_id);
  for (const w of warnable) {
    if (db.get('SELECT 1 FROM retention_notices WHERE workspace_id = ?', w.id)) continue;
    const deleteOn = addDays(today, RETENTION.idleWarnDays);
    db.insert('retention_notices', { workspace_id: w.id, notified_at: nowIso(), delete_on: deleteOn });
    for (const email of ownersOf(db, w.id)) mailer.send(idleMail(email, { business: w.name, deleteOn, link: `${base}/login` }));
    audit(db, { action: 'idle_warned', workspaceId: w.id, detail: { delete_on: deleteOn } });
    out.idleWarned++;
  }
  const gone = [];
  const old = new Set(idleWorkspaces(db, sixMonths).map((w) => w.id));
  for (const r of db.all('SELECT * FROM retention_notices WHERE delete_on <= ?', today)) {
    if (!old.has(r.workspace_id)) continue;
    const w = db.get('SELECT id, name FROM workspaces WHERE id = ?', r.workspace_id);
    const { results, ok } = await eraser.erase(w.id, productsEver(db, w.id));
    if (!ok) {
      audit(db, { action: 'workspace_delete_failed', workspaceId: w.id, detail: { source: 'retention', results } });
      log(`[accounts] daily: workspace ${w.id} was due to be deleted as unused, and a product did not delete its part (${JSON.stringify(results)}); tried again tomorrow`);
      out.idleFailed++;
      continue;
    }
    eraseWorkspace(db, w.id, { source: 'retention', products: results });
    db.run('DELETE FROM retention_notices WHERE workspace_id = ?', w.id);
    gone.push(w.name);
    out.idleDeleted++;
  }
  if (gone.length) for (const op of notifyTo) mailer.send(idleNoticeMail(op, { names: gone }));
  return out;
}

/**
 * Run today's jobs, once: { ran: false } when today's run is done (or another started within the hour), else
 * { ran: true, day, notices, billing, whatsapp, retention }. `eraser` and `reminder` stand in for the products in the
 * tests.
 */
export async function runDaily(db, { env = process.env, mailer, log = console.log, t = now(), eraser = eraseClient({ env, log }), base = accountsBase(env), reminder = remindClient({ env }) } = {}) {
  const today = israelToday(t);
  const at = new Date(t).toISOString();
  const row = db.get('SELECT * FROM daily_runs WHERE day = ?', today);
  if (row && (row.finished_at || Date.parse(row.started_at) > t - HOUR)) return { ran: false, day: today };
  db.run('INSERT INTO daily_runs (day, started_at) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET started_at = excluded.started_at', today, at);
  const notifyTo = signupNotify(env);
  const notices = await termsNotices(db, { mailer, today, log });
  const billed = billing(db, { mailer, env, base, notifyTo, today });
  const detail = {
    notices,
    billing: billed.sent,
    // A bug here costs the day's WhatsApp reminders, never the emails before them or the retention after.
    whatsapp: await whatsappReminders(db, { env, owed: billed.owed, reminder, log }).catch((e) => (log(`[accounts] daily: the WhatsApp reminders stopped: ${e?.stack || e?.message || e}; the emails went as always`), { failed: true })),
    retention: await retention(db, { mailer, base, notifyTo, eraser, log, today, t }),
  };
  db.run('UPDATE daily_runs SET finished_at = ?, detail_json = ? WHERE day = ?', nowIso(), detail, today);
  log(`[accounts] daily ${today}: terms notices ${detail.notices}; billing emails ${JSON.stringify(detail.billing)}; WhatsApp reminders ${JSON.stringify(detail.whatsapp)}; deleted ${JSON.stringify(detail.retention)}`);
  return { ran: true, day: today, ...detail };
}

/** The last runs, newest first, for a look by hand: [{ day, started_at, finished_at, detail }]. */
export const lastRuns = (db, n = 7) => db.all('SELECT * FROM daily_runs ORDER BY day DESC LIMIT ?', n).map((r) => ({ ...r, detail: j(r.detail_json) }));

/** Check every quarter hour, and run once a day from RUN_HOUR. Returns stop(). A failed run is logged and tried again. */
export function startDaily(db, { env = process.env, mailer, log = console.log, everyMs = 15 * 60_000 } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy || israelHour(now()) < RUN_HOUR) return;
    busy = true;
    try {
      await runDaily(db, { env, mailer, log });
    } catch (e) {
      log(`[accounts] daily: ${e.stack || e.message}`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

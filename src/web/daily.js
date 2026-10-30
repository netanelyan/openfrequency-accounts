import { DAY, HOUR, now, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { j } from '../db/index.js';
import { addDays, addMonths, graceLast, israelToday } from '../accounts/subscriptions.js';
import { eraseWorkspace, productsEver } from '../accounts/erase.js';
import { checkoutUrl, payHow, paymentMode, supportWa } from '../accounts/billing.js';
import { signupNotify } from '../accounts/signup.js';
import { billingMail, billingNoticeMail, idleMail, idleNoticeMail } from '../mail/messages.js';
import { MAIL, ils } from './copy.js';
import { eraseClient } from './erase.js';
import { accountsBase } from './internal.js';

// The daily jobs, once an Israel day from 09:00 (startDaily(), which scripts/web.js runs; `npm run daily` runs them by
// hand). Each run is kept in daily_runs, and what it did is logged with its counts.
//
// 1. Billing (ACC-01). For each subscription that has been paid and is not cancelled, comp or off, in a workspace that
//    is open, each owner gets one email of each kind for each end of a paid period (billing_notices):
//      soon7    a week before the next payment falls due (the day after paid_until)
//      soon1    the day before
//      due      on the day: it has not come, and the product goes on working until graceLast() (14 days on), when
//               it stops until paid (entitlement.js 'due'). This email is the notice the terms speak of
//      stopped  the grace is over
//    The operator (OF_SIGNUP_NOTIFY) hears of each due and stopped. A recorded payment moves paid_until on, and the
//    next period's emails follow it. How to pay follows the payment mode (OF_PAYMENT, src/accounts/billing.js): with a
//    provider, soon and due lead to its payment page ("לתשלום"); in manual mode, they say to pay by the details we
//    emailed (and how, OF_PAYMENT_METHOD, when set) and whom to ask, and lead to the account.
//
// 2. Retention (ACC-07, PRA-DB-005), the periods the privacy policy states:
//      sign-ups never confirmed                       deleted 30 days after the form was sent
//      links and codes (magic, invites, WhatsApp)     deleted 30 days after they ended
//      sessions                                       deleted 90 days after they ended (expired or signed out)
//      the notification log                           90 days
//      a workspace never paid for, not complimentary, with no invoice, that nobody has used for 6 months (no sign-in,
//      no page seen): its owners are emailed, and 14 days later it is deleted the normal way, every product asked
//      first (src/web/erase.js, src/accounts/erase.js). Someone signing in, a payment or comp takes it off the list.
//    Kept on purpose: invoices (7 years, the tax law), the audit log (the security record), and the opt-in and
//    opt-out records of WhatsApp numbers while the number is linked.

export const RETENTION = { signupDays: 30, linkDays: 30, sessionDays: 90, notifyLogDays: 90, billingNoticeDays: 400, idleMonths: 6, idleWarnDays: 14 };
/** The Israel hour the run starts at, or after: emails go out in the morning, not at midnight. */
export const RUN_HOUR = 9;

const israelHour = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
const isoBefore = (days, t) => new Date(t - days * DAY).toISOString();
const ownersOf = (db, workspaceId) =>
  db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL", workspaceId).map((r) => r.email);

/** Which billing email a subscription paid until `paidUntil` is owed on `today`, or null. */
export function billingKind(paidUntil, today) {
  const dueOn = addDays(paidUntil, 1);
  const last = graceLast(paidUntil);
  if (today > last) return today <= addDays(last, 7) ? 'stopped' : null;
  if (today >= dueOn) return 'due';
  if (today === addDays(dueOn, -1)) return 'soon1';
  if (today >= addDays(dueOn, -7)) return 'soon7';
  return null;
}

function billing(db, { mailer, env, base, notifyTo, today }) {
  const rows = db.all(
    `SELECT s.*, w.name AS business FROM subscriptions s
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN workspace_products wp ON wp.workspace_id = s.workspace_id AND wp.product = s.product
      WHERE wp.enabled = 1 AND wp.comp = 0 AND w.disabled_at IS NULL AND w.deleted_at IS NULL
        AND s.paid_until IS NOT NULL AND s.cancelled_at IS NULL AND s.ends_on IS NULL`
  );
  const provider = paymentMode(env) === 'provider';
  // With the owner's details (OF_PAYMENT_METHOD) the email gives them; without, it points to the ones we emailed.
  const pay = provider ? MAIL.payByProvider : [...(payHow(env) ? [MAIL.welcomePayHow(payHow(env))] : [MAIL.payByUs]), MAIL.payAsk(supportWa(env))];
  const sent = { soon7: 0, soon1: 0, due: 0, stopped: 0 };
  for (const s of rows) {
    const kind = billingKind(s.paid_until, today);
    if (!kind) continue;
    const dueOn = addDays(s.paid_until, 1);
    const fresh = db.run('INSERT INTO billing_notices (workspace_id, product, kind, due_on, sent_at, recipients) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT DO NOTHING', s.workspace_id, s.product, kind, dueOn, nowIso());
    if (Number(fresh.changes) !== 1) continue;
    const to = ownersOf(db, s.workspace_id);
    const fields = { kind, business: s.business, product: s.product, dueOn, graceUntil: graceLast(s.paid_until), amount: MAIL.amount(ils(s.monthly ?? 0), s.vat !== 'included'), pay, link: `${base}/setup` };
    const online = provider ? { payLink: checkoutUrl(s.workspace_id, env), payButton: MAIL.payOnlineButton } : {};
    for (const email of to) mailer.send(billingMail(email, { ...fields, ...online }));
    db.run('UPDATE billing_notices SET recipients = ? WHERE workspace_id = ? AND product = ? AND kind = ? AND due_on = ?', to.length, s.workspace_id, s.product, kind, dueOn);
    if (kind === 'due' || kind === 'stopped') for (const op of notifyTo) mailer.send(billingNoticeMail(op, { ...fields, link: `${base}/admin/accounts#ws-${s.workspace_id}` }));
    audit(db, { action: `billing_${kind}`, workspaceId: s.workspace_id, detail: { product: s.product, due_on: dueOn, recipients: to.length } });
    sent[kind]++;
  }
  return sent;
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
 * { ran: true, day, billing, retention }. `eraser` stands in for the products in the tests.
 */
export async function runDaily(db, { env = process.env, mailer, log = console.log, t = now(), eraser = eraseClient({ env, log }), base = accountsBase(env) } = {}) {
  const today = israelToday(t);
  const at = new Date(t).toISOString();
  const row = db.get('SELECT * FROM daily_runs WHERE day = ?', today);
  if (row && (row.finished_at || Date.parse(row.started_at) > t - HOUR)) return { ran: false, day: today };
  db.run('INSERT INTO daily_runs (day, started_at) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET started_at = excluded.started_at', today, at);
  const notifyTo = signupNotify(env);
  const detail = {
    billing: billing(db, { mailer, env, base, notifyTo, today }),
    retention: await retention(db, { mailer, base, notifyTo, eraser, log, today, t }),
  };
  db.run('UPDATE daily_runs SET finished_at = ?, detail_json = ? WHERE day = ?', nowIso(), detail, today);
  log(`[accounts] daily ${today}: billing emails ${JSON.stringify(detail.billing)}; deleted ${JSON.stringify(detail.retention)}`);
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

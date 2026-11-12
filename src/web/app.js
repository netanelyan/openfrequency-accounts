import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../core/audit.js';
import { ROOT } from '../core/paths.js';
import { PRODUCTS } from '../db/schema.js';
import { productUrls } from './products.js';
import { clientIp, cookies, csrfFor, csrfOk, isHttps, sessionSecret } from '../auth/http.js';
import { createLimiter, ipKey, LIMITS, signupMailDaily } from '../auth/limiter.js';
import { safeNext } from '../auth/next.js';
import { finishGoogle, GOOGLE, GoogleError, googleConfig, openFlow, sameState, sealFlow, startGoogle, FLOW_TTL } from '../auth/google.js';
import { bindGoogle, googleMatch, mailbox, userForGoogle } from '../accounts/google.js';
import { chooseWorkspace, createSession, describeSession, enabledProducts, findSession, LIFETIME, memberships, operatorWorkspace, revokeAllSessions, revokeSession, sessionCookie, sessionFromJar } from '../auth/sessions.js';
import { acceptInvite, consumeMagicLink, createInvite, InviteError, normEmail, peekInvite, peekMagicLink, requestMagicLink, revokeInvite, validEmail } from '../accounts/links.js';
import { verifySuperadmin } from '../accounts/superadmin.js';
import { createWorkspace, getWorkspace, listWorkspaces, recentAudit, setDisabled, setProduct, startViewAs, stopViewAs, WorkspaceError } from '../accounts/workspaces.js';
import { addProduct, checkSignup, completeSignup, CONTACT_URL, dropSignup, hadProduct, peekSignup, requestSignup, SignupError, signupNotify, signupOpen, signupProducts, startProducts } from '../accounts/signup.js';
import { foundersSpots, foundersState, giveBackSpot, isFounder } from '../accounts/founders.js';
import { amountDue, assistantWa, billingReady, checkoutUrl, payHow, paymentMode, supportWa } from '../accounts/billing.js';
import { accessAll, accessFor, BillingError, cancelSubscription, resumeSubscription, setComp } from '../accounts/entitlement.js';
import { eraseWorkspace, productsEver, sameName } from '../accounts/erase.js';
import { prefsOf, savePrefs } from '../accounts/notify.js';
import { cancelMail, cancelNoticeMail, deleteNoticeMail, existingAccountMail, inviteMail, magicLinkMail, paidMail, paidOpening, signupMail, signupNoticeMail, welcomeMail } from '../mail/messages.js';
import { ADD, CANCEL, ERASE, LEADS, MAIL, MORNING, NOTIFY, OPS, PAY, PRODUCT_NAMES, SETUP, SIGNUP, T, WAIT, dayHe, ils, opensAfter, phoneHe } from './copy.js';
import { payOverWa } from './pay.js';
import { setupClient, setupState } from './setup.js';
import { eraseClient } from './erase.js';
import { changedClient } from './changed.js';
import { createLinkCode, openLinkCode, phoneIn, phonesFor, removePhone } from '../accounts/phones.js';
import { PLANS, describe, graceChangeOf, listPrice, payMonth, payTotal, setSubscription, subscriptionsOf } from '../accounts/subscriptions.js';
import { addInvoice, invoiceIn, invoicesOf, PDF_MAX, removeInvoice } from '../accounts/invoices.js';
import { decideReceipt, manualReceipt, monthBill, monthReceipted, PayError, RECEIPT_TYPES, receiptById, receiptProducts, receiptsWaiting } from '../accounts/pay.js';
import { invoiceReceipt, morningClient, morningConfig } from '../accounts/morning.js';
import { cancelTeamInvite, inviteToTeam, removeMember, TEAM_LIMIT, TeamError, teamOf } from '../accounts/team.js';
import { opsCustomers } from '../accounts/ops.js';
import { now } from '../core/clock.js';
import { dashboardPage } from './dashboard.js';
import { leadPage, leadsPage } from './leads.js';
import { ACTIONS, ID, LEAD_ACTIONS, LOST_REASONS, SOURCES, WHERE, toranClient } from './toran.js';
import { siteClient, waitlistPage } from './waitlist.js';
import { isAdminToran, operatorAssertion, proxyToToran, toranBase, touchesInternal } from './admin-toran.js';
import { isAdminTeder, proxyToTeder, tederAt as tederInternal } from './admin-teder.js';
import { readiness } from './ready.js';
import * as P from './html.js';

// The public site, accounts.openfrequency.co.il, behind Caddy.
//
// THE CHECKS, IN ORDER, ON EVERY REQUEST (as in Teder):
//   - the Host header is ours (defeats DNS rebinding)
//   - under the public name, the request came over HTTPS, which only the proxy
//     on this machine can say
//   - every POST has an Origin that is ours (when the browser sends one) and a
//     CSRF token derived from a random per-browser cookie, checked in constant time
//   - /admin needs a superadmin session
//   - /admin/toran/* is Toran's, handed to it as it came (admin-toran.js), after the superadmin's session and
//     before anything here reads the body; its answer goes back with Toran's headers, not ours
// Server-rendered HTML; the only scripts are our own files: static/a11y.js (the accessibility panel and the light or
// dark switch) and static/load.js (the loading state) on every page and static/admin.js on the operator's dashboard
// (/admin), nothing inline. Referrer-Policy is same-origin: a token in a URL (magic links, invites) is never sent to another site as a
// Referer, Teder
// and Toran included. Not no-referrer: with that, browsers send "Origin: null"
// on our own forms and the Origin check above would refuse every one of them.

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const BRAND = path.join(ROOT, 'assets', 'brand');
// The stylesheet and the company's icon (Teder's brand files, unchanged), read once.
const FILES = {
  '/static/site.css': [readFileSync(path.join(STATIC, 'site.css')), 'text/css; charset=utf-8'],
  '/static/admin.js': [readFileSync(path.join(STATIC, 'admin.js')), 'text/javascript; charset=utf-8'],
  '/static/load.js': [readFileSync(path.join(STATIC, 'load.js')), 'text/javascript; charset=utf-8'],
  '/static/a11y.js': [readFileSync(path.join(STATIC, 'a11y.js')), 'text/javascript; charset=utf-8'],
  '/static/icon.svg': [readFileSync(path.join(BRAND, 'svg', 'openfrequency-small.svg')), 'image/svg+xml'],
  '/static/icon-180.png': [readFileSync(path.join(BRAND, 'png', 'openfrequency-180.png')), 'image/png'],
};
const V = Date.now().toString(36);

export function defaultLimiters() {
  return {
    magicEmail: createLimiter(LIMITS.magicPerEmail),
    magicIp: createLimiter(LIMITS.magicPerIp),
    adminLogin: createLimiter(LIMITS.adminLogin),
    signupEmail: createLimiter(LIMITS.signupPerEmail),
    signupIp: createLimiter(LIMITS.signupPerIp),
    signupMail: createLimiter(signupMailDaily()),
    inviteWorkspace: createLimiter(LIMITS.invitePerWorkspace),
    inviteAddress: createLimiter(LIMITS.invitePerAddress),
  };
}

export { productUrls };

/**
 * Where a customer reaches us: our WhatsApp (OF_SUPPORT_WA, international digits), as a wa.me link that opens with
 * `text` already written when there is one. null while it is unset, and the page then says to answer one of our
 * emails.
 */
export function supportUrl(env = process.env, text = '') {
  const digits = supportWa(env);
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/**
 * Where a customer asks about paying in manual mode (OF_PAYMENT, ACC-02): our WhatsApp (OF_SUPPORT_WA), else an email to
 * the address our emails' replies go to (MAIL_REPLY_TO), else the website's contact page.
 */
export function payContact(env = process.env, text = '') {
  const wa = supportUrl(env, text);
  if (wa) return wa;
  const reply = String(env.MAIL_REPLY_TO || '').trim().replace(/^.*<([^>]+)>\s*$/, '$1');
  if (validEmail(reply)) return `mailto:${reply}?subject=${encodeURIComponent(text || SETUP.billingStep)}`;
  return CONTACT_URL;
}

/** The owner line's WhatsApp number (OF_ASSISTANT_WA): src/accounts/billing.js, where the billing emails read it too. */
export { assistantWa };

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Refused(413, 'too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readForm(req, limit = 16_000) {
  return new URLSearchParams((await readBody(req, limit)).toString('utf8'));
}

/**
 * A multipart/form-data body: its text fields (as URLSearchParams, like every other form) and its files by field
 * name, { filename, data }. Only the console's invoice form sends one, for its PDF. Null when it cannot be read.
 */
export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  if (!m) return null;
  const boundary = Buffer.from(`\r\n--${m[1] || m[2]}`);
  const fields = new URLSearchParams();
  const files = {};
  // Read as if the body began with a line break, so the first boundary is found like every other.
  const buf = Buffer.concat([Buffer.from('\r\n'), body]);
  let at = buf.indexOf(boundary);
  if (at === -1) return null;
  for (;;) {
    at += boundary.length;
    if (buf.subarray(at, at + 2).toString('latin1') === '--') return { fields, files };
    const headEnd = buf.indexOf('\r\n\r\n', at);
    const next = headEnd === -1 ? -1 : buf.indexOf(boundary, headEnd + 4);
    if (next === -1) return null;
    const head = buf.subarray(at, headEnd).toString('utf8');
    const name = /;\s*name="([^"]*)"/i.exec(head)?.[1];
    const filename = /;\s*filename="([^"]*)"/i.exec(head)?.[1];
    const data = buf.subarray(headEnd + 4, next);
    if (name != null && filename != null) files[name] = { filename, data: Buffer.from(data) };
    else if (name != null) fields.append(name, data.toString('utf8'));
    at = next;
  }
}

// The one form that sends a file: the console's invoice, with its PDF.
const UPLOAD = /^\/admin\/workspaces\/\d+\/invoices$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The operator's dashboard's buttons: /admin/ops/<toran|teder>/<id>/<action>, forwarded to Toran (src/web/toran.js).
const OPS_ACTION = /^\/admin\/ops\/(toran|teder)\/([^/]{1,300})\/([a-z]{1,20})$/;
// Where each button comes back to on the dashboard, without script.
const OPS_BACK = ['contact', 'talking'];

export function publicHandler({ db, env = process.env, mailer, limiters: given = {}, failDelayMs = 400, log = console.error, toran = toranClient({ env, log }), site = siteClient({ env, log }), toranProxyMs, google = googleConfig(env), googleFetch = globalThis.fetch, setupMs, setupFetch = globalThis.fetch, eraseFetch = setupFetch, eraseMs, changedFetch = setupFetch, changedMs, changed = null, morningFetch = globalThis.fetch, morningMs }) {
  const secret = sessionSecret(env);
  const publicHost = String(env.PUBLIC_HOST || '').trim().toLowerCase() || null;
  const dev = !publicHost;
  const urls = productUrls(env);
  // Any limiter the caller does not pass is the usual one.
  const limiters = { ...defaultLimiters(), ...given };
  const signupOn = signupOpen(env);
  // How customers pay (OF_PAYMENT, src/accounts/billing.js): what /signup, its confirmation page, /setup and the emails say.
  const payment = paymentMode(env);
  // The products sign-up offers now (OF_SIGNUP_PRODUCTS); the others show as coming soon and are refused.
  const openProducts = signupProducts(env);
  // Each product's setup checklist (src/web/setup.js), for /setup, the home page and where a customer lands.
  const setup = setupClient({ env, log, productUrls: urls, fetchImpl: setupFetch, ...(setupMs ? { timeoutMs: setupMs } : {}) });
  /**
   * A workspace's checklist: payment (the paywall: each product's access today), its products' answers, and whether
   * it is finished (setupState()). With a provider, payment leads to its payment page; in manual mode, questions about
   * it lead to us: our WhatsApp with the words written, an email, or the website's contact page.
   */
  const setupFor = async (workspaceId) => {
    const products = enabledProducts(db, workspaceId);
    const ready = billingReady(env);
    const results = await setup.check(workspaceId, products);
    const name = db.get('SELECT name FROM workspaces WHERE id = ?', workspaceId)?.name || '';
    return setupState(results, products, {
      billingReady: ready,
      access: accessAll(db, workspaceId),
      checkout: ready ? checkoutUrl(workspaceId, env) : null,
      // With the owner's payment details, the button sends the receipt of the transfer; else it asks about paying.
      contact: payContact(env, payHow(env) ? SETUP.billingReceiptText(name) : SETUP.billingSupportText(name)),
    });
  };
  // Deleting a workspace: the products' parts first (src/web/erase.js), then ours (src/accounts/erase.js).
  const eraser = eraseClient({ env, log, fetchImpl: eraseFetch, ...(eraseMs ? { timeoutMs: eraseMs } : {}) });
  // Teder and Toran hear at once that a workspace's access changed (src/web/changed.js), so the customer sees it on the
  // next page instead of up to 5 minutes later. Called after the change is committed and never awaited: a product that
  // is down or slow is a line in the log, and the request goes on. Only the products the workspace has on are told;
  // `had` names products it had until this request (a product just turned off), told whatever they are now.
  const changes = changed || changedClient({ env, log, fetchImpl: changedFetch, ...(changedMs ? { timeoutMs: changedMs } : {}) });
  const accessChanged = (workspaceId, products, reason, { had = false } = {}) => {
    try {
      const on = enabledProducts(db, workspaceId);
      const to = [...new Set(products)].filter((pr) => PRODUCTS.includes(pr) && (had || on.includes(pr)));
      if (to.length) changes.tell(workspaceId, to, reason);
    } catch (e) {
      log(`[accounts] telling the products that workspace ${workspaceId} changed failed: ${e.message}`);
    }
  };
  // Each owner of the workspace, once for each month recorded (`recorded`: [{ product, until }]), after the payment has
  // committed: what was paid and until when, and what it did to the product ("תדר פתוח. אפשר להתחיל" when it opened
  // it), with its one button into the product (src/mail/messages.js paidMail). `before` is each product's access read
  // just before the payment, with nothing awaited between that read, the payment and this, so nothing else ran in
  // between. A refused duplicate never gets here.
  const tellPaid = (base, workspaceId, business, recorded, before) => {
    const owners = db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL", workspaceId);
    for (const x of recorded) {
      const opening = paidOpening(before[x.product], accessFor(db, workspaceId, x.product));
      for (const o of owners) mailer.send(paidMail(o.email, { business, product: x.product, until: x.until, link: `${base}/`, productLink: urls[x.product], opening }));
    }
  };
  // The owner hears of each confirmed sign-up (OF_SIGNUP_NOTIFY). Called once its transaction has committed; the
  // mailer queues and never waits, and a failure here is logged and never stands in the customer's way. It has each
  // product's plan and price as its subscription has them, the founders' spot when it took one, and what to do next:
  // in manual mode, email the customer the payment details unless their email has them. `added`: a product a customer
  // added to their account (/subscription/<product>/add), the same notice about that product alone.
  const notifyTo = signupNotify(env);
  const noticeSignup = ({ user, workspace, founder = null }, method, base, { added = null } = {}) => {
    if (!notifyTo.length) return;
    try {
      const products = added ? [added] : enabledProducts(db, workspace.id);
      const subs = subscriptionsOf(db, workspace.id);
      // Sign-up's founder is its spot's number; an added product's, { spot, spots, already } (signup.js addProduct).
      const spot = founder == null ? null : typeof founder === 'object' ? founder : { spot: founder, spots: foundersSpots(env), already: false };
      const fields = {
        name: user.name,
        email: user.email,
        business: workspace.name,
        products: products.map((p) => PRODUCT_NAMES[p]).join(', '),
        prices: products.map((p) => {
          const s = subs[p] || {};
          const list = listPrice(p, s.plan);
          const setupFee = s.setup ?? list.setup;
          return MAIL.noticePrice(P.productLabel(p, s.plan), ils(s.monthly ?? list.monthly), setupFee ? ils(setupFee) : '', (s.vat ?? list.vat) === 'included' ? T.vatIncluded : T.vatExcluded);
        }),
        founders: spot ? MAIL.noticeFounders(spot.spot, spot.spots, spot.already) : '',
        payment,
        // The customer's email carries the payment details when the owner wrote them (OF_PAYMENT_METHOD), under the
        // button to pay over WhatsApp too (with OF_ASSISTANT_WA) since 2026-11-11.
        detailsSent: Boolean(payHow(env)),
        wa: Boolean(payHow(env) && assistantWa(env)),
        added: Boolean(added),
        names: products.map((p) => PRODUCT_NAMES[p]).join(SIGNUP.and),
        many: products.length > 1,
        at: added ? new Date(now()).toISOString() : workspace.created_at,
        method,
        link: `${base}/admin/accounts#ws-${workspace.id}`,
      };
      for (const to of notifyTo) mailer.send(signupNoticeMail(to, fields));
    } catch (e) {
      log(`[accounts] the sign-up notice for workspace ${workspace.id} failed: ${e.message}`);
    }
  };
  // The owner hears the same way of each cancellation, its undo, and each deleted workspace. `make(to)` is the email.
  const tellOwner = (make, what) => {
    if (!notifyTo.length) return;
    try {
      for (const to of notifyTo) mailer.send(make(to));
    } catch (e) {
      log(`[accounts] the ${what} notice failed: ${e.message}`);
    }
  };
  // Right after a sign-up is confirmed: the welcome email, what happens next (pay, then set up), with each product's
  // plan and price (Teder's setup fee not refunded, as its terms say), and how paying works in this mode (OF_PAYMENT):
  // manual, we email the details, with how they pay (OF_PAYMENT_METHOD) when the owner has said, and questions come
  // to us; provider, they pay on the setup page. What is to pay is what /setup and Toran say (billing.js amountDue):
  // after a sign-up, each product's first month and setup fee. `added` (a product added to an open account): the same
  // email about it, and the payment is everything owed now (the other product's month too, when it is owed). A
  // founder's setup fee is 0, so no word of one, and one line says why (the owner, 2026-11-11).
  const welcome = ({ user, workspace, founder = null }, base, { added = null } = {}) => {
    try {
      const due = amountDue(db, workspace.id);
      const owed = due.lines.filter((l) => l.item);
      const prices = owed.map((l) => {
        const label = P.productLabel(l.product, l.plan);
        const plusVat = l.vat !== 'included';
        return l.kind === 'owed' && l.item.firstMonth
          ? MAIL.welcomePrice(label, ils(l.item.monthly), l.item.setup ? ils(l.item.setup) : '', l.product === 'teder' && l.item.setup > 0, plusVat)
          : MAIL.welcomeMonth(label, ils(l.item.monthly), plusVat);
      });
      const total = owed.length ? [MAIL.payNow(ils(due.total), ils(due.net), due.vat ? ils(due.vat) : ''), ...(due.monthsAfter != null ? [MAIL.payThen(ils(due.monthsAfter))] : [])] : [];
      // What opens once paid: the products owed that are closed now (one in its 72 hours still works).
      const closed = owed.filter((l) => l.kind === 'owed').map((l) => PRODUCT_NAMES[l.product]);
      const opens = closed.length ? opensAfter(payment, closed.join(SIGNUP.and), closed.length > 1) : '';
      const founders = Boolean(founder) && owed.some((l) => l.kind === 'owed' && l.item.firstMonth && !l.item.setup);
      // Paying over WhatsApp (src/web/pay.js): with OF_PAYMENT_METHOD and OF_ASSISTANT_WA, the payment's own button.
      const wa = payOverWa(db, { env, workspaceId: workspace.id, business: workspace.name });
      mailer.send(welcomeMail(user.email, { business: workspace.name, link: `${base}/setup`, payment, opens, prices, total, payHow: payHow(env), wa: supportWa(env), payLink: wa?.href || null, payButton: PAY.button, founders, added: added ? PRODUCT_NAMES[added] : '' }));
    } catch (e) {
      log(`[accounts] the welcome email for workspace ${workspace.id} failed: ${e.message}`);
    }
  };
  /**
   * Delete a workspace: each product it has ever had deletes its part first; only when none failed (a 404 is a
   * failure: src/web/erase.js) is ours deleted. Returns { ok: true, name, invoicesKept, results } or { ok: false, error } (nothing here
   * was deleted). The owner hears of it.
   */
  const eraseAll = async (w, { by, ip: from, source }) => {
    const { results, ok, failed } = await eraser.erase(w.id, productsEver(db, w.id));
    if (!ok) {
      audit(db, { actor: by, action: 'workspace_delete_failed', workspaceId: w.id, ip: from, detail: { source, results } });
      return { ok: false, error: ERASE.failed(failed.map((p) => PRODUCT_NAMES[p]).join(ERASE.and), failed.length > 1) };
    }
    const done = eraseWorkspace(db, w.id, { by, ip: from, source, products: results });
    const at = new Date(now()).toISOString();
    tellOwner((to) => deleteNoticeMail(to, { business: done.name, who: by.email, at, byAdmin: source === 'admin', results, invoicesKept: done.invoicesKept }), 'deletion');
    return { ok: true, ...done, results };
  };
  const support = supportUrl(env);
  const waNumber = assistantWa(env);
  // Where a form may go, redirects included: a browser checks each hop. /signup's "continue with Google" is a submit
  // that answers with a redirect to Google, so while Google is set up its sign-in page is one of them; without it the
  // browser stopped there and the button span on (2026-10-31).
  const formAction = `'self' https://*.openfrequency.co.il${google ? ` ${new URL(GOOGLE.auth).origin}` : ''}${dev ? ' http://localhost:* http://127.0.0.1:*' : ''}`;
  // Our own script files only (a11y.js and load.js on every page, admin.js on /admin), from the fixed list in FILES,
  // and nothing inline: no script anyone could put in a page runs.
  const CSP = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction}`;
  const CSP_SCRIPT = CSP;
  const toranAt = toranBase(env);
  const tederHere = tederInternal(env);
  // The invoice-receipt in Morning after "התשלום הגיע" (src/accounts/morning.js), while its keys are set; else none.
  const morningSet = morningConfig(env);
  const morning = morningSet ? morningClient(morningSet, { fetchImpl: morningFetch, ...(morningMs ? { timeoutMs: morningMs } : {}) }) : null;

  return async (req, res) => {
    const out = { cookies: [] };
    // Every page, its errors included, in the theme this browser chose (of-theme, html.js themeOf()): light without one.
    const theme = P.themeOf(cookies(req));
    const layout = (o) => P.layout({ v: V, theme, ...o });
    const headers = (extra = {}) => ({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      'content-security-policy': CSP,
      ...(out.cookies.length ? { 'set-cookie': out.cookies } : {}),
      ...extra,
    });
    const send = (status, html, extra) => {
      res.writeHead(status, headers({ 'content-type': 'text/html; charset=utf-8', ...extra }));
      res.end(html);
    };
    const json = (status, body) => {
      res.writeHead(status, headers({ 'content-type': 'application/json; charset=utf-8' }));
      res.end(JSON.stringify(body));
    };
    const text = (status, body) => {
      res.writeHead(status, headers({ 'content-type': 'text/plain; charset=utf-8' }));
      res.end(body);
    };
    // An invoice's PDF, as the invoicing service made it: never cached, never framed, opened in the browser.
    const pdf = (inv) => {
      const name = `invoice-${String(inv.number).replace(/[^A-Za-z0-9_-]/g, '') || inv.id}.pdf`;
      res.writeHead(200, headers({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }));
      res.end(Buffer.from(inv.pdf));
    };
    const redirect = (to) => {
      res.writeHead(303, headers({ location: to }));
      res.end();
    };
    // A request the pages never send, or one too large, answered with a page in Hebrew, not the code's English ("too
    // large", "method not allowed"; the audit of 2026-11-11). The status stays what it is.
    const refused = (status, title = status === 413 ? T.tooLarge : status === 421 ? T.notFound : T.badRequest) => send(status, layout({ title, body: P.messagePage({ title, lead: '' }) }));

    try {
      const host = String(req.headers.host || '').toLowerCase();
      const port = req.socket.localPort;
      if (![publicHost, `127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return refused(421);
      const secure = isHttps(req);
      if (publicHost && host === publicHost && !secure) return text(403, T.httpsOnly);

      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/healthz') return text(200, 'ok');
      // The founders' offer, as the website's counter reads it (src/accounts/founders.js): the spots and how many are
      // left, counted, for anyone; cached a minute, and readable from openfrequency.co.il's own pages.
      if (req.method === 'GET' && p === '/public/founders.json') {
        const { spots, left } = foundersState(db, env);
        const origin = String(req.headers.origin || '');
        const allowed = /^https:\/\/(www\.)?openfrequency\.co\.il$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
        res.writeHead(200, headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', ...(allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) }));
        return res.end(JSON.stringify({ spots, left }));
      }
      // Ready: the database answers and is at this build's schema (src/web/ready.js). The deploy waits for it, and the
      // uptime monitor watches it. The details only to this machine.
      if (req.method === 'GET' && p === '/readyz') {
        const r = readiness(db);
        const local = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
        return json(r.ok ? 200 : 503, local ? r : { ok: r.ok });
      }
      if (req.method === 'GET' && Object.hasOwn(FILES, p)) {
        const [body, type] = FILES[p];
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }

      const ip = clientIp(req);
      const jar = cookies(req);
      const origin = `${secure ? 'https' : 'http'}://${host}`;
      const base = publicHost ? `https://${publicHost}` : origin;
      const sec = secure ? '; Secure' : '';

      const sid = sessionFromJar(jar, secure);
      const found = sid ? findSession(db, sid) : null;

      // Toran's operator pages, on our /admin: the superadmin's only, outside view-as, as for /admin, and never
      // Toran's /internal routes. Everything else about the request (its CSRF, its forms) is Toran's to check. Teder's,
      // under /admin/teder, on the same terms (admin-teder.js, docs/admin-split.md).
      const teder_ = isAdminTeder(p);
      if (teder_ || isAdminToran(p)) {
        const page_ = (status, title, body) => send(status, layout({ title, body }));
        if (!found?.user.is_superadmin || found.session.view_as_workspace_id) {
          if (req.method === 'GET') return redirect(`/admin/login?next=${encodeURIComponent(p + url.search)}`);
          return page_(403, T.adminLoginTitle, P.messagePage({ title: T.staleForm, lead: '', links: [['/admin/login', T.adminLoginTitle]] }));
        }
        if (touchesInternal(p)) return page_(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }));
        const o = req.headers.origin;
        if (req.method !== 'GET' && req.method !== 'HEAD' && o && o !== origin) return page_(403, T.loginTitle, P.messagePage({ title: T.crossSite, lead: '' }));
        return (teder_ ? proxyToTeder : proxyToToran)(req, res, {
          base: teder_ ? tederHere : toranAt,
          path: p + url.search,
          secure,
          origin: base,
          operator: operatorAssertion(found.user, sid, env.OF_INTERNAL_TOKEN),
          timeoutMs: toranProxyMs,
          log,
          failed: (status) =>
            status === 413
              ? refused(413)
              : teder_
                ? page_(502, OPS.tederNoAnswerTitle, P.messagePage({ title: OPS.tederNoAnswerTitle, lead: OPS.tederNoAnswerLead, links: [['/admin', OPS.toranNoAnswerBack]] }))
                : page_(502, OPS.toranNoAnswerTitle, P.messagePage({ title: OPS.toranNoAnswerTitle, lead: OPS.toranNoAnswerLead, links: [['/admin', OPS.toranNoAnswerBack]] })),
        });
      }

      // The CSRF cookie: random, this host only, made on the first visit.
      const csrfName = secure ? '__Host-of_csrf' : 'of_csrf';
      let nonce = jar[csrfName];
      if (!/^[A-Za-z0-9_-]{22,}$/.test(nonce || '')) {
        if (req.method === 'POST') return send(403, layout({ title: T.loginTitle, body: P.messagePage({ title: T.staleForm, lead: '', links: [['/login', T.notFoundBack]] }) }));
        nonce = randomBytes(18).toString('base64url');
        out.cookies.push(`${csrfName}=${nonce}; Path=/; HttpOnly; SameSite=Lax${sec}`);
      }
      const csrf = csrfFor(nonce, secret);

      // A one-request message after a redirect. __Host- behind HTTPS, so a sibling
      // *.openfrequency.co.il site cannot set one and put its words on our page.
      const flashName = secure ? '__Host-of_flash' : 'of_flash';
      // A line that starts with "!" is an error (the dashboard's, when Toran refuses an action).
      let flash = '';
      let flashBad = false;
      if (jar[flashName] && req.method === 'GET') {
        flash = jar[flashName].slice(0, 300);
        if (flash.startsWith('!')) [flash, flashBad] = [flash.slice(1), true];
        out.cookies.push(`${flashName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${sec}`);
      }
      const setFlash = (msg, bad = false) => out.cookies.push(`${flashName}=${encodeURIComponent(`${bad ? '!' : ''}${msg}`)}; Path=/; Max-Age=30; HttpOnly; SameSite=Lax${sec}`);

      // Sign in with Google: the round trip's state, signed (src/auth/google.js). Lax, so it comes back with the
      // browser when Google sends it to the callback; __Host- behind HTTPS, so no sibling site can plant one.
      const googleName = secure ? '__Host-of_google' : 'of_google';
      const googleCallback = `${base}/auth/google/callback`;

      let form = null;
      let files = {};
      if (req.method === 'POST') {
        const o = req.headers.origin;
        if (o && o !== origin) return send(403, layout({ title: T.loginTitle, body: P.messagePage({ title: T.crossSite, lead: '' }) }));
        if (/^multipart\/form-data/i.test(String(req.headers['content-type'] || ''))) {
          // A file, up to PDF_MAX, only on the invoice form and only from the superadmin; nobody else sends one.
          if (!UPLOAD.test(p) || !found?.user.is_superadmin) throw new Refused(415, 'unsupported');
          const parsed = parseMultipart(await readBody(req, PDF_MAX + 64_000), req.headers['content-type']);
          if (!parsed) throw new Refused(400, 'unreadable form');
          ({ fields: form, files } = parsed);
        } else {
          form = await readForm(req);
        }
        if (!csrfOk(form.get('_csrf'), nonce, secret)) return send(403, layout({ title: T.loginTitle, body: P.messagePage({ title: T.staleForm, lead: '', links: [[p.startsWith('/admin') ? '/admin' : '/login', T.notFoundBack]] }) }));
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        return refused(405);
      }
      const f = (k) => String(form?.get(k) ?? '');
      const page = (status, title, body, opts = {}) => send(status, layout({ title, body, flash, ...opts }));
      const next = (raw) => safeNext(raw, { allowLocal: dev });
      // An invite that does not work any more: a new one comes from whoever sent it, so there is no button (its "לקישור
      // חדש" led to the sign-in, useless to someone without an account; the audit of 2026-11-11), and a quiet way in for
      // someone who joined already.
      const deadInvite = () => P.messagePage({ title: T.inviteDeadTitle, lead: T.inviteDeadLead, links: [['/login', T.inviteDeadLogin]] });
      const setSession = (user, opts = {}) => {
        const s = createSession(db, user, { ip, userAgent: req.headers['user-agent'], ...opts });
        out.cookies.push(sessionCookie(s.id, { secure, maxAgeMs: user.is_superadmin ? LIFETIME.superadmin.maxMs : LIFETIME.client.maxMs }));
        return s.row;
      };
      // The customer's home: each product's subscription, the other products, the invoices, who is in the account.
      const dashboard = async (d, status = 200, extra = {}) => {
        const wsId = d.body.workspace.id;
        // While setup is not finished: the card when a product says so, the link in the header until we know it is.
        const st = await setupFor(wsId);
        const mine = memberships(db, found.user.id).filter((m) => !m.disabled_at);
        const change = graceChangeOf(db, wsId);
        const subscriptions = Object.fromEntries(Object.entries(subscriptionsOf(db, wsId)).map(([prod, row]) => [prod, describe(row, undefined, change)]));
        // Only a product they can buy now (OF_SIGNUP_PRODUCTS): a product not on sale is not shown (the owner,
        // 2026-11-06: "if an option isnt relevant dont show it"). While sign-up is open, its owner adds it here
        // (/subscription/<product>/add; the owner, 2026-11-11); otherwise it leads to its page on the website.
        const others = PRODUCTS.filter((prod) => !d.body.products.includes(prod) && openProducts.includes(prod));
        const access = accessAll(db, wsId);
        const body = P.homePage({
          csrf,
          user: found.user,
          workspace: d.body.workspace,
          products: d.body.products,
          productUrls: urls,
          canSwitch: mine.length > 1,
          subscriptions,
          access,
          providerReady: billingReady(env),
          others,
          addable: signupOn ? others : [],
          // Invoices are the owners' only: a member sees the team and the products, not what the business pays.
          invoices: d.body.role === 'client_owner' ? invoicesOf(db, wsId) : null,
          team: teamOf(db, wsId),
          // A linked number is for Toran's assistant only (Teder is managed on its dashboard): the card's form shows only
          // with Toran (html.js whatsappCard), and only once Toran is open to them (paid, comp, or in its 72 hours):
          // before that, asking it about the store answers nothing (the audit of 2026-11-11). A number linked already
          // keeps the card, to remove it.
          whatsapp: { phones: phonesFor(db, { userId: found.user.id, workspaceId: wsId, role: d.body.role }), code: openLinkCode(db, found.user.id, wsId), waNumber, toran: d.body.products.includes('toran') && Boolean(access.toran?.allowed) },
          role: d.body.role,
          readOnly: d.body.readOnly,
          support,
          supportTeam: supportUrl(env, T.supportTeamText(d.body.workspace.name, TEAM_LIMIT)),
          flash,
          setup: st.complete ? null : { done: st.done, total: st.total, incomplete: st.incomplete, onlyPay: st.onlyPay, renewal: st.renewal },
          ...extra,
        });
        return page(status, T.homeHello(found.user.name || found.user.email), body, { wide: true });
      };
      // A closed workspace (disabled on /admin): its name, and whom to tell when it is a mistake, our WhatsApp with the
      // words written (OF_SUPPORT_WA) when it is set (the audit of 2026-11-11); then another workspace of theirs, and out.
      const closedPage = (name, canSwitch) => {
        const wa = supportUrl(env, T.homeClosedText(name));
        return P.messagePage({ title: T.homeClosed(name), lead: wa ? T.homeClosedWa : T.homeClosedMail, links: [...(wa ? [[wa, T.supportWrite]] : []), ...(canSwitch ? [['/workspace', T.homeSwitch]] : []), ['/logout', T.homeSignOut]] });
      };
      const clearSession = () => out.cookies.push(sessionCookie('', { secure, clear: true }));
      // Where a sign-in lands: ?next= first; then, for a customer whose workspace is not set up yet (a product that
      // answered says a required step is left, or payment is ready and not made), the setup page; else home. A
      // product that does not answer is not a reason to send anyone to /setup.
      const landing = async (user, session, to) => {
        if (user.is_superadmin) return to || '/admin';
        if (!session.workspace_id) return `/workspace${to ? `?next=${encodeURIComponent(to)}` : ''}`;
        if (to) return to;
        const w = db.get('SELECT disabled_at FROM workspaces WHERE id = ?', session.workspace_id);
        if (!w || w.disabled_at) return '/';
        return (await setupFor(session.workspace_id)).incomplete ? '/setup' : '/';
      };

      // ---------------------------------------------------------------- customers

      if (p === '/') {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return redirect('/admin');
        const d = describeSession(db, sid);
        if (d.status === 409) return redirect('/workspace');
        if (d.status === 403 && d.body.error === 'no_membership') {
          db.update('sessions', found.session.id, { workspace_id: null });
          return redirect('/workspace');
        }
        const mine = memberships(db, found.user.id).filter((m) => !m.disabled_at);
        if (d.status === 403) {
          const ws = db.get('SELECT name FROM workspaces WHERE id = ?', found.session.workspace_id);
          return page(403, T.loginTitle, closedPage(ws?.name || '', mine.length > 0));
        }
        return await dashboard(d);
      }

      // The setup page: one checklist, for the products this workspace has turned on and no other (src/web/setup.js).
      // The superadmin sees it in view-as, read-only; outside view-as, their place is /admin.
      if (p === '/setup' && req.method !== 'POST') {
        if (!found) return redirect('/login');
        const d = describeSession(db, sid);
        let banner = '';
        if (found.user.is_superadmin) {
          if (!d.body.viewAs || !d.body.workspace) return redirect('/admin');
          banner = P.viewAsBanner(d.body.workspace.name, csrf);
        } else if (d.status === 409) return redirect(`/workspace?next=${encodeURIComponent('/setup')}`);
        else if (d.status !== 200) return redirect('/');
        const wsId = d.body.workspace.id;
        const state = await setupFor(wsId);
        // Paying over WhatsApp: the button's link with the workspace's code, while something is owed, now or the month
        // ahead within the week (payOverWa() asks dueForPay()); read-only (view-as) makes no code.
        const payWa = payOverWa(db, { env, workspaceId: wsId, business: d.body.workspace.name, mint: !d.body.readOnly });
        return page(200, SETUP.title, P.setupPage({ state, productUrls: urls, readOnly: d.body.readOnly, flash, access: accessAll(db, wsId), prices: subscriptionsOf(db, wsId), payHow: payHow(env), payWa, founder: isFounder(db, wsId) }), { wide: true, banner });
      }

      // The account, for a customer in their own workspace: cancelling a product's subscription (a confirmation page,
      // then the POST) and taking it back, deleting the workspace and its data, and which product emails they get.
      // Cancelling and deleting are its owners'; the superadmin (whose view-as is read-only) does neither from here.
      const customerIn = (to) => {
        const d = describeSession(db, sid);
        if (d.status === 409) return { go: `/workspace?next=${encodeURIComponent(to)}` };
        if (d.status !== 200 || d.body.readOnly) return { go: '/' };
        return { d };
      };

      // A product added to the account (the owner, 2026-11-11: a customer of one product adds the other from their
      // account, where before only the operator could): its owner chooses its plan and accepts its terms as at sign-up
      // (src/accounts/signup.js addProduct), and it is turned on unpaid at its list price, the founders' offer by the
      // sign-up's rule. The email about it and the operator's notice go as on a sign-up, and they land on /setup, where
      // they pay and set it up. Only while sign-up sells it (OF_SIGNUP, OF_SIGNUP_PRODUCTS). A product the account had
      // before is the operator's to bring back. The superadmin (whose view-as is read-only) adds nothing here.
      const addMatch = /^\/subscription\/(teder|toran)\/add$/.exec(p);
      if (addMatch) {
        if (!found) return redirect(`/login?next=${encodeURIComponent(p + url.search)}`);
        if (found.user.is_superadmin) return page(403, SIGNUP.title, P.messagePage({ title: ADD.readOnly, lead: '', links: [['/admin', T.adminTitle]] }));
        const { d, go } = customerIn(p + url.search);
        if (go) return redirect(go);
        const product = addMatch[1];
        const name = PRODUCT_NAMES[product];
        const ws = d.body.workspace;
        const title = ADD.title(name);
        const say = (status, heading, lead, more = []) => page(status, title, P.messagePage({ title: heading, lead, links: [...more, ['/', T.logoutBack]] }));
        const closed = () => say(403, ADD.closed(name), ADD.closedLead);
        const owners = () => say(403, ADD.ownersOnly(name), ADD.ownersOnlyLead);
        const had = () => {
          const wa = supportUrl(env, ADD.hadText(ws.name, name));
          return say(409, ADD.hadTitle(name), ADD.hadLead(Boolean(wa)), wa ? [[wa, T.supportWrite]] : []);
        };
        if (d.body.products.includes(product)) return redirect('/');
        if (!signupOn || !openProducts.includes(product)) return closed();
        if (d.body.role !== 'client_owner') return owners();
        if (hadProduct(db, ws.id, product)) return had();
        const field = P.PLAN_FIELD[product];
        const founder = isFounder(db, ws.id);
        const view = (status, form_ = {}, error = '', errorAt = '') =>
          page(status, title, P.addProductPage({ csrf, product, workspace: ws, form: form_, error, errorAt, payment, founder, founders: founder ? null : foundersState(db, env) }));
        if (req.method !== 'POST') {
          // ?plan= (the website's button under a plan card, kept through /signup) starts that plan chosen.
          const asked = url.searchParams.get('plan') || '';
          return view(200, { [field]: Object.hasOwn(PLANS[product], asked) ? asked : '' });
        }
        const form_ = { [field]: f(field).slice(0, 20), terms: f('terms') === '1' };
        let added;
        try {
          added = addProduct(db, { workspaceId: ws.id, product, plan: form_[field], terms: form_.terms, by: found.user, ip, env, open: signupOn ? openProducts : [] });
        } catch (e) {
          if (!(e instanceof SignupError)) throw e;
          // Sent twice (a double click): it is on, and home says so.
          if (e.code === 'already') return redirect('/');
          if (e.code === 'product_closed') return closed();
          if (e.code === 'not_owner') return owners();
          if (e.code === 'had_before') return had();
          return view(400, form_, ADD.errors[e.code] || SIGNUP.errors[e.code] || e.code, e.code === 'no_terms' ? 'terms' : 'plan');
        }
        // Committed: the product hears at once, then the emails, which never stand in the way.
        accessChanged(ws.id, [product], 'product');
        const done = { user: found.user, workspace: getWorkspace(db, ws.id), founder: added.founder };
        welcome(done, base, { added: product });
        noticeSignup(done, 'account', base, { added: product });
        setFlash(ADD.flashAdded(name));
        return redirect('/setup');
      }

      const subMatch = /^\/subscription\/(teder|toran)\/(cancel|resume)$/.exec(p);
      if (subMatch) {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return page(403, CANCEL.title, P.messagePage({ title: CANCEL.readOnly, lead: '', links: [['/admin', T.adminTitle]] }));
        const { d, go } = customerIn(p);
        if (go) return redirect(go);
        const [, product, action] = subMatch;
        const ws = d.body.workspace;
        const name = PRODUCT_NAMES[product];
        // A refusal has nothing to say no to: its link is "חזרה לדף הראשי", not the confirmation page's "לא, ..." (the
        // audit of 2026-11-11).
        const refuse = (code, status = 400) => page(status, CANCEL.title, P.messagePage({ title: CANCEL.errors[code] || code, lead: '', links: [['/', T.logoutBack]] }));
        if (d.body.role !== 'client_owner') return refuse('not_owner', 403);
        if (action === 'cancel' && req.method !== 'POST') {
          const a = accessFor(db, ws.id, product);
          if (a.access === 'off') return refuse('product_off', 404);
          if (a.access === 'comp') return refuse('comp');
          if (a.access === 'cancelled') return refuse('already');
          return page(200, CANCEL.title, P.cancelPage({ csrf, product, access: a }));
        }
        if (req.method !== 'POST') return redirect('/');
        try {
          if (action === 'cancel') {
            const r = cancelSubscription(db, ws.id, product, { by: found.user, ip });
            accessChanged(ws.id, [product], 'cancelled');
            const owners = db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL", ws.id);
            for (const o of owners) mailer.send(cancelMail(o.email, { business: ws.name, product, lastDay: r.lastDay, paid: r.paid, link: `${base}/` }));
            tellOwner((to) => cancelNoticeMail(to, { business: ws.name, product, who: found.user.email, lastDay: r.lastDay, paid: r.paid, link: `${base}/admin/accounts#ws-${ws.id}` }), 'cancellation');
            setFlash(r.paid ? CANCEL.flashCancelled(name, dayHe(r.lastDay)) : CANCEL.flashCancelledNow(name));
          } else {
            resumeSubscription(db, ws.id, product, { by: found.user, ip });
            accessChanged(ws.id, [product], 'resumed');
            tellOwner((to) => cancelNoticeMail(to, { business: ws.name, product, who: found.user.email, resumed: true, link: `${base}/admin/accounts#ws-${ws.id}` }), 'resumption');
            setFlash(CANCEL.flashResumed(name));
          }
          return redirect('/');
        } catch (e) {
          if (!(e instanceof BillingError)) throw e;
          return refuse(e.code);
        }
      }

      if (p === '/account/delete') {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return page(403, ERASE.title, P.messagePage({ title: ERASE.readOnly, lead: '', links: [['/admin/accounts', T.adminTitle]] }));
        const { d, go } = customerIn(p);
        if (go) return redirect(go);
        if (d.body.role !== 'client_owner') return page(403, ERASE.title, P.messagePage({ title: ERASE.ownersOnly, lead: '', links: [['/', T.logoutBack]] }));
        const ws = getWorkspace(db, d.body.workspace.id);
        const canCancel = enabledProducts(db, ws.id).some((pr) => ['paid', 'due', 'unpaid'].includes(accessFor(db, ws.id, pr).access));
        const again = (status, error = '', typed = '') => page(status, ERASE.title, P.deletePage({ csrf, workspace: ws, error, typed, canCancel }));
        if (req.method !== 'POST') return again(200);
        const typed = f('name').slice(0, 200);
        if (!sameName(typed, ws.name)) return again(400, ERASE.mismatch, typed);
        const r = await eraseAll(ws, { by: found.user, ip, source: 'owner' });
        if (!r.ok) return again(502, r.error, typed);
        // Signed out everywhere: their account may be gone with the workspace, and if not, it has left it.
        if (db.get('SELECT 1 FROM users WHERE id = ?', found.user.id)) revokeAllSessions(db, found.user.id, { reason: 'workspace_deleted', ip });
        clearSession();
        return page(200, ERASE.doneTitle, P.messagePage({ title: ERASE.doneTitle, lead: ERASE.doneLead(r.name), links: [['https://openfrequency.co.il/', ERASE.doneLink]] }));
      }

      // Which product emails this person gets (POST /internal/notify reads it). ?workspace= (the emails' footer link)
      // opens it in that workspace, when they are in it.
      if (p === '/notifications') {
        if (!found) return redirect(`/login?next=${encodeURIComponent(p + url.search)}`);
        if (found.user.is_superadmin) return redirect('/admin');
        const want = Number((req.method === 'POST' ? f('workspace') : url.searchParams.get('workspace')) || 0);
        if (want && want !== found.session.workspace_id && memberships(db, found.user.id).some((m) => m.id === want && !m.disabled_at)) chooseWorkspace(db, found.session, want);
        const { d, go } = customerIn(p);
        if (go) return redirect(go);
        const ws = d.body.workspace;
        if (req.method === 'POST') {
          savePrefs(db, { userId: found.user.id, workspaceId: ws.id, on: new Set(form.getAll('on')) }, { by: found.user, ip });
          setFlash(NOTIFY.flashSaved);
          return redirect('/notifications');
        }
        const prefs = prefsOf(db, { userId: found.user.id, workspaceId: ws.id, role: d.body.role });
        return page(200, NOTIFY.title, P.notificationsPage({ csrf, workspace: ws, prefs, flash }), { wide: true });
      }

      // Public sign-up (src/accounts/signup.js), only while OF_SIGNUP=1. Closed, the page says it opens soon and
      // every POST is refused.
      if (p === '/signup' || p === '/signup/confirm') {
        if (!signupOn) {
          const body = P.messagePage({ title: SIGNUP.closedTitle, lead: SIGNUP.closedLead, links: [[CONTACT_URL, SIGNUP.closedLink], ['/login', T.loginTitle]] });
          return page(req.method === 'POST' ? 403 : 200, SIGNUP.title, body);
        }
        const dead = () => page(410, SIGNUP.deadTitle, P.deadPage({ title: SIGNUP.deadTitle, lead: SIGNUP.deadLead, href: '/signup', label: SIGNUP.again }));

        if (p === '/signup/confirm') {
          if (req.method !== 'POST') {
            const t = url.searchParams.get('t') || '';
            const row = peekSignup(db, t, 'email');
            return row ? page(200, SIGNUP.confirmTitle, P.signupConfirmPage({ csrf, token: t, row, payment })) : dead();
          }
          const done = completeSignup(db, f('t'), { kind: 'email', ip, env });
          if (!done) return dead();
          if (done.exists) return page(409, SIGNUP.existsTitle, P.messagePage({ title: SIGNUP.existsTitle, lead: SIGNUP.existsLead, links: [['/login', SIGNUP.toLogin]] }));
          noticeSignup(done, 'email', base);
          welcome(done, base);
          if (found) revokeSession(db, sid, { reason: 'replaced', ip });
          setSession(done.user, { workspaceId: done.workspace.id });
          return redirect('/setup');
        }

        // Someone already signed in: their account is open. A second workspace is the superadmin's to open. A product
        // their workspace does not have is added to it (/subscription/<product>/add; the owner, 2026-11-11): the one
        // ?p= names (the website's buttons), or the only one there is to add; ?plan= goes with it. Otherwise, the page
        // says what is so: the product is there already, its owners add it, or who they are signed in as.
        if (found) {
          if (found.user.is_superadmin) return page(200, SIGNUP.title, P.messagePage({ title: SIGNUP.signedInTitle(found.user.email), lead: '', links: [['/admin', T.adminTitle]] }));
          const d = describeSession(db, sid);
          if (d.status === 409) return redirect(`/workspace?next=${encodeURIComponent(p + url.search)}`);
          const ws = d.status === 200 && !d.body.readOnly ? d.body.workspace : null;
          const want = startProducts(url.searchParams.get('p'), PRODUCTS)[0] || null;
          const can = ws && req.method !== 'POST' ? PRODUCTS.filter((x) => openProducts.includes(x) && !d.body.products.includes(x)) : [];
          const pick = can.includes(want) ? want : !want && can.length === 1 ? can[0] : null;
          const plan = url.searchParams.get('plan') || '';
          if (pick && d.body.role === 'client_owner') return redirect(`/subscription/${pick}/add${Object.hasOwn(PLANS[pick], plan) ? `?plan=${plan}` : ''}`);
          const links = [['/', SIGNUP.home], ['/logout', SIGNUP.signOut]];
          if (ws && want && d.body.products.includes(want)) return page(200, SIGNUP.title, P.messagePage({ title: SIGNUP.hasTitle(PRODUCT_NAMES[want], ws.name), lead: '', links }));
          return page(200, SIGNUP.title, P.messagePage({ title: SIGNUP.signedInTitle(found.user.email), lead: pick ? SIGNUP.ownerAdds(PRODUCT_NAMES[pick]) : SIGNUP.signedInLead, links }));
        }
        // The product the visitor came from (?p=) starts ticked when it is open, and the only one open always, without
        // asking (startProducts; the owner, 2026-11-02, in place of 2026-10-31's "nothing starts ticked"). The POST
        // below checks what comes back against the open ones as before.
        if (req.method !== 'POST') {
          // ?plan= (the website's button under each plan card) starts that plan chosen, for when its product is ticked:
          // a Teder name (full, small) is Teder's, a Toran name (store, big) Toran's.
          const asked = url.searchParams.get('plan') || '';
          const start = { products: startProducts(url.searchParams.get('p'), openProducts), plan: Object.hasOwn(PLANS.teder, asked) ? asked : '', plan_toran: Object.hasOwn(PLANS.toran, asked) ? asked : '' };
          return page(200, SIGNUP.title, P.signupPage({ csrf, google: Boolean(google), open: openProducts, payment, form: start, founders: foundersState(db, env) }));
        }

        const via = f('via') === 'google' && google ? 'google' : 'email';
        const raw = { name: f('name').slice(0, 200), business: f('business').slice(0, 200), email: f('email').slice(0, 254), products: form.getAll('products'), plan: f('plan').slice(0, 20), plan_toran: f('plan_toran').slice(0, 20), terms: f('terms') === '1' };
        // `errorAt`: the field an error is about, where the page says it (html.js signupPage); none for the whole form.
        const again = (status, error, extra, errorAt = '') => send(status, layout({ title: SIGNUP.title, body: P.signupPage({ csrf, form: raw, error, errorAt, google: Boolean(google), open: openProducts, payment, founders: foundersState(db, env) }) }), extra);
        const FIELD_OF = { bad_name: 'name', bad_business: 'business', bad_email: 'email', no_products: 'products', product_closed: 'products', bad_plan: 'products', bad_plan_toran: 'products', no_terms: 'terms' };
        const sent = (email) => page(200, SIGNUP.sentTitle, P.signupSentPage({ email }));
        // The honeypot: a field people never see. Filled, it was not a person: the same page as a real sign-up, and
        // nothing kept or sent.
        if (f('website')) {
          limiters.signupIp.hit(ipKey(ip));
          return sent(normEmail(raw.email));
        }
        let ok;
        try {
          ok = checkSignup(raw, { needEmail: via === 'email', open: openProducts });
        } catch (e) {
          if (!(e instanceof SignupError)) throw e;
          return again(400, SIGNUP.errors[e.code], undefined, FIELD_OF[e.code] || '');
        }
        const wait = Math.max(limiters.signupIp.check(ipKey(ip)) || 0, via === 'email' ? limiters.signupEmail.check(ok.email) || 0 : 0);
        if (wait) return again(429, SIGNUP.tooMany(wait), { 'retry-after': String(wait) });
        limiters.signupIp.hit(ipKey(ip));

        if (via === 'google') {
          // The choices wait here, under a token that rides in the signed Google flow cookie, not in any URL.
          const { token } = requestSignup(db, ok, { kind: 'google', ip });
          const { url: to, flow } = startGoogle({ clientId: google.clientId, redirectUri: googleCallback, signup: token });
          out.cookies.push(`${googleName}=${sealFlow(flow, secret)}; Path=/; Max-Age=${FLOW_TTL / 1000}; HttpOnly; SameSite=Lax${sec}`);
          return redirect(to);
        }

        // Every email the form sends, from every address together, has a daily ceiling (PRA-SEC-005).
        const full = limiters.signupMail.check('all');
        if (full) {
          log(`[accounts] sign-up: the daily ceiling of sign-up emails is reached (OF_SIGNUP_DAILY_EMAILS); a form was refused`);
          return again(429, SIGNUP.busy, { 'retry-after': String(full) });
        }
        limiters.signupMail.hit('all');
        limiters.signupEmail.hit(ok.email);
        const r = requestSignup(db, ok, { kind: 'email', ip });
        if (r.exists) {
          // The address has an account: a sign-in link to it, never a second one. The page says the same either way.
          const link = requestMagicLink(db, ok.email, { ip });
          if (link) mailer.send(existingAccountMail(link.user.email, `${base}/auth/link?t=${link.token}`));
        } else {
          mailer.send(signupMail(ok.email, `${base}/signup/confirm?t=${r.token}`));
        }
        return sent(ok.email);
      }

      // The team on the home page: an owner invites someone, cancels an invite, removes someone. Only a customer in
      // their own workspace, and only its owner; the superadmin (whose view-as is read-only) changes nothing here.
      if (p.startsWith('/team/') && req.method === 'POST') {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return page(403, T.loginTitle, P.messagePage({ title: T.teamReadOnly, lead: '', links: [['/admin', T.adminTitle]] }));
        const d = describeSession(db, sid);
        if (d.status !== 200 || d.body.readOnly) return redirect('/');
        const wsId = d.body.workspace.id;
        const by = { by: found.user, ip };
        let m;
        try {
          if (d.body.role !== 'client_owner') throw new TeamError('not_owner');
          if (p === '/team/invite') {
            // Each email counted (src/auth/limiter.js LIMITS.invitePerWorkspace, invitePerAddress), a re-send too:
            // sign-up is open, so an account must not be a way to send our emails to anyone, again and again (the
            // audit of 2026-11-11). Refused, nothing is stored or sent, and the form says when it can go.
            const to = normEmail(f('email'));
            const waitWs = limiters.inviteWorkspace.check(String(wsId));
            const waitTo = validEmail(to) ? limiters.inviteAddress.check(to) : null;
            if (waitWs || waitTo) {
              return await dashboard(d, 429, { teamError: waitWs ? T.inviteTooMany(waitWs) : T.inviteTooSoon(to, waitTo), teamForm: { email: f('email'), role: f('role') } });
            }
            const inv = inviteToTeam(db, { workspaceId: wsId, email: f('email'), role: f('role'), ...by });
            limiters.inviteWorkspace.hit(String(wsId));
            limiters.inviteAddress.hit(inv.email);
            // Who sent it is named in it: the owner's name, else their address (the audit of 2026-11-11).
            mailer.send(inviteMail(inv.email, inv.workspace.name, `${base}/invite?t=${inv.token}`, inv.expiresAt, found.user.name || found.user.email));
            setFlash(T.flashTeamInvited(inv.email));
          } else if ((m = /^\/team\/invites\/(\d+)\/cancel$/.exec(p))) {
            const email = cancelTeamInvite(db, { workspaceId: wsId, tokenId: m[1], ...by });
            if (email) setFlash(T.flashInviteRevoked(email));
          } else if ((m = /^\/team\/members\/(\d+)\/remove$/.exec(p))) {
            const gone = removeMember(db, { workspaceId: wsId, userId: m[1], ...by });
            if (gone) setFlash(T.flashTeamRemoved(gone.name || gone.email));
          } else {
            return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/', T.logoutBack]] }));
          }
          return redirect('/#team');
        } catch (e) {
          if (!(e instanceof TeamError || e instanceof InviteError)) throw e;
          return await dashboard(d, e.code === 'not_owner' ? 403 : 400, { teamError: T.teamErrors[e.code] || T.errors[e.code] || e.code, teamForm: { email: f('email'), role: f('role') } });
        }
      }

      // An invoice's PDF, for a customer in its own workspace only. Another workspace's invoice is not found, the
      // same as one that does not exist, so an id says nothing about another business.
      const invoiceMatch = /^\/invoices\/(\d+)$/.exec(p);
      if (invoiceMatch && req.method === 'GET') {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return redirect('/admin');
        const d = describeSession(db, sid);
        const inv = d.status === 200 && d.body.role === 'client_owner' ? invoiceIn(db, invoiceMatch[1], d.body.workspace.id) : null;
        if (!inv) return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/', T.logoutBack]] }));
        return pdf(inv);
      }

      // WhatsApp on the home page: a link code, a number removed. Only a customer in their own workspace; the
      // superadmin (in view-as, read-only) changes nothing here. A link code only for a workspace with Toran, and with
      // no updates: Teder is managed on its dashboard only (the owner, 2026-11-02), and the updates were Teder's
      // messages, which are not sent any more. /whatsapp/updates, which turned them on or off, is gone.
      if (p.startsWith('/whatsapp/') && req.method === 'POST') {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return page(403, T.loginTitle, P.messagePage({ title: T.waReadOnly, lead: '', links: [['/admin', T.adminTitle]] }));
        const d = describeSession(db, sid);
        if (d.status !== 200 || d.body.readOnly) return redirect('/');
        const me = found.user;
        const wsId = d.body.workspace.id;
        if (p === '/whatsapp/link') {
          if (!d.body.products.includes('toran')) return redirect('/');
          createLinkCode(db, { user: me, workspaceId: wsId, optIn: false, ip });
          return redirect('/#whatsapp');
        }
        // A number of this workspace only: its own person, or the owner to remove it. Anything else changes nothing.
        const row = phoneIn(db, f('phone'), wsId);
        if (p === '/whatsapp/remove' && row && (row.user_id === me.id || d.body.role === 'client_owner')) {
          removePhone(db, row.phone, { by: me, ip });
          setFlash(T.flashWaRemoved(phoneHe(row.phone)));
        }
        return redirect('/#whatsapp');
      }

      if (p === '/login' && req.method !== 'POST') {
        const to = next(url.searchParams.get('next'));
        if (found) return redirect(await landing(found.user, found.session, to));
        const out_ = url.searchParams.get('out');
        const notice = out_ === 'all' ? T.signedOutAll(Number(url.searchParams.get('n')) || 0) : out_ ? T.signedOut : '';
        return page(200, T.loginTitle, P.loginPage({ csrf, next: to || '', notice, google: Boolean(google), signup: signupOn }));
      }

      if (p === '/login') {
        const email = normEmail(f('email'));
        const to = next(f('next'));
        if (!validEmail(email)) return page(400, T.loginTitle, P.loginPage({ csrf, next: to || '', email: f('email').slice(0, 254), error: T.badEmail, google: Boolean(google), signup: signupOn }));
        const wait = Math.max(limiters.magicIp.check(ipKey(ip)) || 0, limiters.magicEmail.check(email) || 0);
        if (wait) {
          return send(429, layout({ title: T.loginTitle, body: P.loginPage({ csrf, next: to || '', email, error: T.tooMany(wait), google: Boolean(google), signup: signupOn }) }), { 'retry-after': String(wait) });
        }
        limiters.magicIp.hit(ipKey(ip));
        limiters.magicEmail.hit(email);
        const link = requestMagicLink(db, email, { next: to, ip });
        if (link) {
          const href = `${base}/auth/link?t=${link.token}`;
          mailer.send(magicLinkMail(link.user.email, href));
        }
        return page(200, T.sentTitle, P.sentPage({ email, next: to || '' }));
      }

      if (p === '/auth/link') {
        const dead = () => page(410, T.linkDeadTitle, P.deadPage({ title: T.linkDeadTitle, lead: T.linkDeadLead }));
        if (req.method !== 'POST') {
          const t = url.searchParams.get('t') || '';
          const live = peekMagicLink(db, t);
          return live ? page(200, T.linkTitle, P.confirmLinkPage({ csrf, token: t, email: live.user.email })) : dead();
        }
        const used = consumeMagicLink(db, f('t'), { ip });
        if (!used) return dead();
        if (found) revokeSession(db, sid, { reason: 'replaced', ip });
        const row = setSession(used.user);
        return redirect(await landing(used.user, row, next(used.next)));
      }

      // Sign in with Google: off to Google with a fresh state (and the invite, when it is one being accepted), then
      // back to the callback, which signs in the customer that Google account is, or accepts the invite for them.
      if (p === '/auth/google' || p === '/auth/google/callback') {
        const missing = () => page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/login', T.notFoundBack]] }));
        const inviteDead = () => page(410, T.inviteDeadTitle, deadInvite());
        if (!google || req.method === 'POST') return missing();

        if (p === '/auth/google') {
          const invite = url.searchParams.get('invite') || '';
          const live = invite ? peekInvite(db, invite) : null;
          if (invite && !live) return inviteDead();
          const { url: to, flow } = startGoogle({ clientId: google.clientId, redirectUri: googleCallback, next: invite ? null : next(url.searchParams.get('next')), invite: invite || null, loginHint: live?.row.email });
          out.cookies.push(`${googleName}=${sealFlow(flow, secret)}; Path=/; Max-Age=${FLOW_TTL / 1000}; HttpOnly; SameSite=Lax${sec}`);
          return redirect(to);
        }

        // The callback. The flow cookie is used once, whatever happens next.
        const flow = openFlow(jar[googleName], secret);
        out.cookies.push(`${googleName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${sec}`);
        const back = flow?.invite ? `/invite?t=${encodeURIComponent(flow.invite)}` : flow?.signup ? '/signup' : `/login${flow?.next ? `?next=${encodeURIComponent(flow.next)}` : ''}`;
        const fail = (status, title, lead, more = []) => page(status, T.googleTitle, P.messagePage({ title, lead, links: [[back, T.googleAgain], ...more] }));
        if (!flow || !sameState(url.searchParams.get('state'), flow)) return fail(400, T.googleStale, T.googleStaleLead);
        const code = url.searchParams.get('code');
        if (url.searchParams.get('error') || !code) {
          setFlash(T.googleCancelled);
          return redirect(back);
        }
        let who;
        try {
          who = await finishGoogle({ code, flow, ...google, redirectUri: googleCallback, fetch: googleFetch });
        } catch (e) {
          if (!(e instanceof GoogleError)) throw e;
          if (e.code !== 'unverified') log(`google sign-in: ${e.code}`);
          audit(db, { action: 'google_failed', ip, detail: { reason: e.code } });
          const [title, lead] = T.googleErrors[e.code];
          return fail(e.code === 'unverified' ? 403 : 502, title, lead);
        }

        if (flow.invite) {
          const live = peekInvite(db, flow.invite);
          if (!live) return inviteDead();
          // Only the address the invite went to may accept it, as with the link in its email.
          if (mailbox(live.row.email) !== mailbox(who.email)) return fail(403, T.googleWrongInvite(live.row.email), T.googleWrongInviteLead(live.row.email, who.email));
          const done = acceptInvite(db, flow.invite, { name: who.name, ip, method: 'google' });
          if (!done) return inviteDead();
          bindGoogle(db, done.user, who);
          if (found) revokeSession(db, sid, { reason: 'replaced', ip });
          setSession(done.user, { workspaceId: done.workspace.id });
          return redirect('/');
        }

        // Sign-up with Google: the form's choices wait under the flow's token. An address or a Google account that is
        // already someone's opens nothing new: a customer's signs them in to the account they have.
        if (flow.signup) {
          const signupDead = () => page(410, SIGNUP.deadTitle, P.deadPage({ title: SIGNUP.deadTitle, lead: SIGNUP.deadLead, href: '/signup', label: SIGNUP.again }));
          if (!signupOn) return page(403, SIGNUP.title, P.messagePage({ title: SIGNUP.closedTitle, lead: SIGNUP.closedLead, links: [[CONTACT_URL, SIGNUP.closedLink]] }));
          if (!peekSignup(db, flow.signup, 'google')) return signupDead();
          const match = googleMatch(db, who);
          if (match.user) {
            dropSignup(db, flow.signup, 'google');
            const user = userForGoogle(db, who, { ip });
            if (found) revokeSession(db, sid, { reason: 'replaced', ip });
            const row = setSession(user);
            setFlash(SIGNUP.googleExisting(user.email));
            return redirect(await landing(user, row, null));
          }
          if (match.taken) {
            dropSignup(db, flow.signup, 'google');
            return fail(403, SIGNUP.googleTaken, SIGNUP.googleTakenLead);
          }
          const done = completeSignup(db, flow.signup, { kind: 'google', email: who.email, ip, env });
          if (!done) return signupDead();
          if (done.exists) return fail(403, SIGNUP.googleTaken, SIGNUP.googleTakenLead);
          bindGoogle(db, done.user, who);
          noticeSignup(done, 'google', base);
          welcome(done, base);
          if (found) revokeSession(db, sid, { reason: 'replaced', ip });
          setSession(done.user, { workspaceId: done.workspace.id });
          return redirect('/setup');
        }

        const user = userForGoogle(db, who, { ip });
        if (!user) return fail(403, T.googleNoAccount(who.email), signupOn ? T.googleNoAccountLeadOpen : T.googleNoAccountLead, signupOn ? [['/signup', T.loginSignup]] : []);
        if (found) revokeSession(db, sid, { reason: 'replaced', ip });
        const row = setSession(user);
        return redirect(await landing(user, row, next(flow.next)));
      }

      if (p === '/invite') {
        const dead = () => page(410, T.inviteDeadTitle, deadInvite());
        if (req.method !== 'POST') {
          const t = url.searchParams.get('t') || '';
          const live = peekInvite(db, t);
          return live ? page(200, T.inviteTitle(live.workspace.name), P.invitePage({ csrf, token: t, email: live.row.email, workspace: live.workspace, google: Boolean(google), signup: signupOn })) : dead();
        }
        const done = acceptInvite(db, f('t'), { name: f('name'), ip });
        if (!done) return dead();
        if (found) revokeSession(db, sid, { reason: 'replaced', ip });
        setSession(done.user, { workspaceId: done.workspace.id });
        return redirect('/');
      }

      if (p === '/workspace') {
        if (!found) return redirect(`/login`);
        if (found.user.is_superadmin) return redirect('/admin');
        const mine = memberships(db, found.user.id).filter((m) => !m.disabled_at);
        if (req.method === 'POST') {
          const id = Number(f('workspace'));
          if (!mine.some((m) => m.id === id) || !chooseWorkspace(db, found.session, id)) return redirect('/workspace');
          return redirect(next(f('next')) || '/');
        }
        const to = next(url.searchParams.get('next'));
        if (!mine.length) {
          // In a workspace that is closed, and no other: that it is closed, not "we have not connected you yet" (the
          // audit of 2026-11-11).
          const shut = memberships(db, found.user.id).find((m) => m.disabled_at);
          if (shut) return page(403, T.loginTitle, closedPage(shut.name, false));
          return page(200, T.loginTitle, P.messagePage({ title: T.homeNoWorkspace, lead: '', links: [['/logout', T.homeSignOut]] }));
        }
        if (mine.length === 1) {
          chooseWorkspace(db, found.session, mine[0].id);
          return redirect(to || '/');
        }
        return page(200, T.pickTitle, P.pickPage({ csrf, workspaces: mine, next: to || '' }));
      }

      if (p === '/logout') {
        if (req.method !== 'POST') {
          if (!found) return redirect('/login');
          return page(200, T.logoutTitle, P.logoutPage({ csrf, email: found.user.email }));
        }
        if (found) revokeSession(db, sid, { ip });
        clearSession();
        return redirect('/login?out=1');
      }

      if (p === '/logout-all' && req.method === 'POST') {
        let n = 0;
        if (found) n = revokeAllSessions(db, found.user.id, { ip });
        clearSession();
        return redirect(`/login?out=all&n=${n}`);
      }

      // ---------------------------------------------------------------- superadmin

      if (p === '/admin/login') {
        // ?next= back to the /admin page that sent here (Toran's pages under /admin/toran), or to the product's page the
        // customer sign-in was sent from (its "כניסה עם סיסמה" link): the owner, 2026-11-11, "I cant login on my phone
        // app because the login page isnt the same". The product's address passes the same check as /login's next.
        const adminNext = (raw) => {
          const to = safeNext(raw, { allowLocal: dev });
          if (!to) return '';
          if (!to.startsWith('/')) return to;
          return /^\/admin(?:[/?#]|$)/.test(to) && !to.startsWith('/admin/login') ? to : '';
        };
        if (req.method !== 'POST') {
          if (found?.user.is_superadmin) return redirect(adminNext(url.searchParams.get('next')) || '/admin');
          return page(200, T.adminLoginTitle, P.adminLoginPage({ csrf, next: adminNext(url.searchParams.get('next')) }));
        }
        const back = adminNext(f('next'));
        const wait = limiters.adminLogin.check(ipKey(ip));
        if (wait) return send(429, layout({ title: T.adminLoginTitle, body: P.adminLoginPage({ csrf, next: back, email: f('email'), error: T.adminTooMany(wait) }) }), { 'retry-after': String(wait) });
        const ok = verifySuperadmin(db, { email: f('email'), password: f('password'), code: f('code') });
        if (!ok) {
          limiters.adminLogin.hit(ipKey(ip));
          audit(db, { action: 'admin_login_failed', ip, detail: { email: f('email').slice(0, 254) } });
          await sleep(failDelayMs);
          return page(401, T.adminLoginTitle, P.adminLoginPage({ csrf, next: back, email: f('email'), error: T.adminLoginFailed }));
        }
        limiters.adminLogin.clear(ipKey(ip));
        audit(db, { actor: ok.user, action: 'sign_in', ip, detail: { method: ok.method } });
        if (found) revokeSession(db, sid, { reason: 'replaced', ip });
        setSession(ok.user);
        if (ok.method === 'recovery') setFlash(T.adminRecoveryUsed(ok.recoveryLeft));
        return redirect(back || '/admin');
      }

      if (p === '/admin' || p.startsWith('/admin/')) {
        if (!found?.user.is_superadmin) {
          if (req.method === 'GET') return redirect('/admin/login');
          return page(403, T.adminLoginTitle, P.messagePage({ title: T.staleForm, lead: '', links: [['/admin/login', T.adminLoginTitle]] }));
        }
        const me = found.user;
        const session = found.session;
        const banner = session.view_as_workspace_id ? P.viewAsBanner(db.get('SELECT name FROM workspaces WHERE id = ?', session.view_as_workspace_id)?.name || '', csrf) : '';
        const console_ = (status, extra = {}) =>
          page(status, T.adminTitle, P.adminPage({ csrf, workspaces: listWorkspaces(db).map((w) => ({ ...w, access: accessAll(db, w.id) })), audit: recentAudit(db), flash, ...extra }), { wide: true, banner });
        // The console's actions come back to the console, the dashboard's to the dashboard.
        const toConsole = () => redirect('/admin/accounts');
        // A receipt's page: what was owed then and what is owed now, the paid-until day of each product its button
        // records (sent back with it, as the console's button does), and a line for each paid for since it came.
        const receiptView = (r, status = 200, error = '') => {
          const fresh = receiptById(db, r.id);
          const record = receiptProducts(db, fresh);
          const subs = subscriptionsOf(db, fresh.workspace_id);
          const expects = Object.fromEntries(record.products.map((pr) => [pr, subs[pr]?.paid_until ?? '']));
          const since = (l) => !fresh.decided_at && l.item && subs[l.product]?.paid_until && subs[l.product].paid_until !== (l.paidUntil ?? null);
          const moved = (fresh.due.lines || []).filter(since).map((l) => ({ product: l.product, paidUntil: subs[l.product].paid_until }));
          return page(status, PAY.title(fresh.business), P.receiptPage({ csrf, r: fresh, now: record.now, record, expects, moved, error, flash, flashBad, morningOn: Boolean(morning) }), { wide: true, banner });
        };
        // The file, as it came, of a type we checked by its bytes: never cached, never framed, nothing sniffed.
        const receiptFile = (r) => {
          res.writeHead(200, headers({ 'content-type': r.type, 'content-disposition': `inline; filename="receipt-${r.id}.${RECEIPT_TYPES[r.type]}"`, 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }));
          return res.end(Buffer.from(r.file));
        };
        const by = { by: me, ip };
        // A refusal is said where its form is: a workspace's (`wsId`: its invoice, subscription, invite...) at that
        // workspace, and only "פתיחת חשבון"'s in that form (the audit of 2026-11-11: an invoice's error showed there).
        const problem = (e, form_, wsId = null) => {
          if (!(e instanceof WorkspaceError || e instanceof InviteError)) throw e;
          const error = T.errors[e.code] || e.code;
          return wsId ? console_(400, { errorWs: { id: Number(wsId), text: error } }) : console_(400, { error, form: form_ });
        };

        // The operator's home: the dashboard, read from Toran and from our own subscriptions at each load.
        if (p === '/admin' && req.method === 'GET') {
          const viewAs = Boolean(session.view_as_workspace_id);
          const t = viewAs ? null : { ...(await toran.ops()), base: toran.base };
          const body = dashboardPage({ csrf, flash, flashBad, toran: t, customers: viewAs ? null : opsCustomers(db), at: now(), viewAs, receipts: viewAs ? [] : receiptsWaiting(db), founders: viewAs ? null : foundersState(db, env), company: viewAs ? null : operatorWorkspace(db, env) });
          return send(200, layout({ title: OPS.title, body, wide: true, banner, script: true }), { 'content-security-policy': CSP_SCRIPT });
        }
        if (p === '/admin/accounts' && req.method === 'GET') return console_(200);
        // Toran's waitlist, from the website, and a message to it (src/web/waitlist.js). After a message, the same page
        // with a WhatsApp button for each phone on the list.
        const waitlistView = async (status, extra = {}) =>
          page(status, WAIT.tool, waitlistPage({ csrf, list: await site.waitlist(), at: now(), flash, flashBad, ...extra }), { wide: true, banner });
        if (p === '/admin/waitlist' && req.method === 'GET') return waitlistView(200);
        if (p === '/admin/waitlist/send' && req.method === 'POST') {
          if (session.view_as_workspace_id) return redirect('/admin');
          const form_ = { subject: f('subject').trim().slice(0, 150), text: f('text').trim().slice(0, 5000) };
          const r = form_.subject && form_.text ? await site.send(form_.subject, form_.text) : { ok: false, error: 'empty' };
          audit(db, { actor: me, action: 'waitlist_message', ip, detail: { ok: r.ok, emails: r.emails ?? 0, phones: r.phones?.length ?? 0, subject: form_.subject } });
          if (!r.ok) {
            flash = WAIT[{ again: 'again', empty: 'empty', no_mail: 'noMail' }[r.error] || 'failed'];
            flashBad = true;
            return waitlistView(r.error === 'again' ? 409 : 400, { form: form_ });
          }
          flash = WAIT.sent(r.emails);
          return waitlistView(200, { sent: { text: form_.text, emails: r.emails, phones: r.phones } });
        }
        let m = /^\/admin\/invoices\/(\d+)$/.exec(p);
        if (m && req.method === 'GET') {
          const inv = db.get('SELECT * FROM invoices WHERE id = ?', Number(m[1]));
          if (inv) return pdf(inv);
        }
        // A transfer's receipt from Toran (src/accounts/pay.js): its page, and its file as it came.
        m = /^\/admin\/receipts\/(\d+)(\/file)?$/.exec(p);
        if (m && req.method === 'GET') {
          const r = receiptById(db, m[1]);
          if (r && m[2] && r.file) return receiptFile(r);
          if (r && !m[2]) return receiptView(r);
        }
        // The shared lead dashboard (src/web/leads.js): the list, and one lead's page; Toran gives both (GET /internal/leads).
        if (p === '/admin/leads' && req.method === 'GET') {
          if (session.view_as_workspace_id) return redirect('/admin');
          const where = WHERE.includes(url.searchParams.get('where')) ? url.searchParams.get('where') : '';
          const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
          const all = url.searchParams.get('all') === '1';
          const body = leadsPage({ csrf, flash, flashBad, result: await toran.leads({ where, q, all }), where, q, all, at: now() });
          return send(200, layout({ title: LEADS.title, body, wide: true, banner, script: true }), { 'content-security-policy': CSP_SCRIPT });
        }
        m = /^\/admin\/leads\/(\d{1,9})$/.exec(p);
        if (m && req.method === 'GET') {
          if (session.view_as_workspace_id) return redirect('/admin');
          const result = await toran.lead(m[1]);
          const body = leadPage({ csrf, flash, flashBad, result, at: now() });
          return send(result.ok || result.why !== 'none' ? 200 : 404, layout({ title: result.ok ? result.lead.name : LEADS.title, body, wide: true, banner, script: true }), { 'content-security-policy': CSP_SCRIPT });
        }
        if (req.method !== 'POST') return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }), { banner });

        // The list's own buttons (src/web/leads.js): a store added by its address, more stores found. Back to the list
        // with Toran's line, or to the lead when the store was here already.
        if (p === '/admin/leads/add' || p === '/admin/leads/discover') {
          const what = p.endsWith('/add') ? 'add' : 'discover';
          const fail = (msg) => {
            setFlash(msg, true);
            return redirect('/admin/leads');
          };
          if (session.view_as_workspace_id) return fail(OPS.viewAsClosed);
          const by = me.name || me.email;
          const r = await toran.leadsDo(what, what === 'add' ? { url: f('url').trim().slice(0, 300), by } : { source: SOURCES.includes(f('source')) ? f('source') : 'storecensus', by });
          audit(db, { actor: me, action: `leads_${what}`, ip, detail: { ok: r.ok } });
          if (!r.ok) return fail(r.error || (r.status ? OPS.toranFailed(r.status) : OPS.toranNoAnswer));
          setFlash(r.message, false);
          return redirect(r.id ? `/admin/leads/${r.id}` : '/admin/leads');
        }

        // A lead's button (src/web/leads.js), every one Toran's /internal/leads: what it goes on with, its demos built,
        // sent and marked, Toran's page checked and fixed, where it stands, Teder's demo worked, the page taken down,
        // the store deleted. Back to the lead's page with Toran's line, or, for a choice made from the list (back=list),
        // to the list as it was: at the lead's row, whose tags now say what is being built, or at the top when Toran
        // refused, where its line is. A choice whose message can go now (Toran's ready) opens the lead at its message
        // instead, and a store deleted goes back to the list.
        m = /^\/admin\/leads\/(\d{1,9})\/([a-z-]{1,20})$/.exec(p);
        if (m) {
          const [, id, action] = m;
          const list = f('back') === 'list' && (action.startsWith('build-') || action.startsWith('go-'));
          const back = (msg, bad) => {
            setFlash(msg, bad);
            if (!list) return redirect(`/admin/leads/${id}`);
            const qs = new URLSearchParams(Object.entries({ where: WHERE.includes(f('where')) ? f('where') : '', q: f('q').trim().slice(0, 100), all: f('all') === '1' ? '1' : '' }).filter(([, v]) => v)).toString();
            return redirect(`/admin/leads${qs ? `?${qs}` : ''}${bad ? '' : `#lead-${id}`}`);
          };
          if (session.view_as_workspace_id) return back(OPS.viewAsClosed, true);
          if (!LEAD_ACTIONS.includes(action)) return back(LEADS.badAction, true);
          const by = me.name || me.email;
          const body = { by };
          if (action === 'notes') body.notes = f('notes').slice(0, 4000);
          if (action === 'skip' || action === 'go-none') body.reason = f('reason').trim().slice(0, 300);
          if (action === 'later') body.days = f('days') === '7' ? 7 : 1;
          if (action === 'lost') {
            if (!LOST_REASONS.includes(f('reason'))) return back(OPS.badReason, true);
            body.reason = f('reason');
          }
          // The name and the colour Toran's page shows: either, or both.
          if (action === 'brand') Object.assign(body, { name: f('name').trim().slice(0, 80), color: f('color').trim().slice(0, 7) });
          // "שלחתי" on the message the page showed: which demo it was for (Toran when the page says none).
          if ((action === 'mark-sent' || action === 'mark-reminded') && ['both', 'toran', 'teder'].includes(f('product'))) body.product = f('product');
          const r = await toran.leadAct(id, action, body);
          audit(db, { actor: me, action: 'lead_action', ip, detail: { id, action, ok: r.ok } });
          if (r.ok && r.ready && action.startsWith('go-')) {
            setFlash(r.message, false);
            return redirect(`/admin/leads/${id}#send`);
          }
          if (r.ok && r.gone) {
            setFlash(r.message, false);
            return redirect('/admin/leads');
          }
          if (r.ok) return back(r.message, false);
          return back(r.error || (r.status ? OPS.toranFailed(r.status) : OPS.toranNoAnswer), true);
        }

        // A button on the dashboard: checked here, then handed to Toran, which keeps the outreach and its rules. It
        // answers JSON to the page's script (X-OF-Ajax), and otherwise comes back to the dashboard with Toran's line.
        m = OPS_ACTION.exec(p);
        if (m) {
          const ajax = req.headers['x-of-ajax'] === '1';
          const back = OPS_BACK.includes(f('back')) ? f('back') : 'contact';
          const answer = (ok, msg) => {
            if (ajax) return json(ok ? 200 : 400, { ok, message: msg });
            setFlash(msg, !ok);
            return redirect(`/admin#${back}`);
          };
          const [, kind, rawId, action] = m;
          let id = '';
          try {
            id = decodeURIComponent(rawId);
          } catch {
            /* refused below */
          }
          if (!ID.test(id) || !Object.hasOwn(ACTIONS, action)) return answer(false, OPS.badAction);
          if (session.view_as_workspace_id) return answer(false, OPS.viewAsClosed);
          if (ACTIONS[action] && ACTIONS[action] !== kind) return answer(false, action === 'won' ? OPS.wonTederOnly : OPS.pilotToranOnly);
          const body = { by: me.name || me.email };
          if (action === 'next') {
            const days = Number(f('days'));
            Object.assign(body, { text: f('text').trim().slice(0, 300), days: Number.isInteger(days) && days >= 1 && days <= 30 ? days : 1 });
          } else if (action === 'later') body.days = f('days') === '7' ? 7 : 1;
          else if (action === 'lost') {
            if (!LOST_REASONS.includes(f('reason'))) return answer(false, OPS.badReason);
            body.reason = f('reason');
          }
          const r = await toran.act(kind, id, action, body);
          audit(db, { actor: me, action: 'ops_action', ip, detail: { product: kind, id, action, ok: r.ok } });
          if (r.ok) return answer(true, r.message);
          return answer(false, r.error || (r.status ? OPS.toranFailed(r.status) : OPS.toranNoAnswer));
        }

        // The operator's answer to a receipt: the payment came (a month recorded for each product, guarded by the
        // paid-until days the page showed, and each owner told; then, with Morning set up, its invoice-receipt, which
        // never holds the payment up), or it did not (nothing recorded). A failed invoice comes back to the receipt's
        // page, which says why and offers it again.
        m = /^\/admin\/receipts\/(\d+)\/(paid|not-paid|invoice)$/.exec(p);
        if (m && m[2] === 'invoice') {
          const r = receiptById(db, m[1]);
          if (!r) return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }), { banner });
          const inv = await invoiceReceipt(db, r.id, { client: morning, by: me, ip });
          if (inv.state === 'issued') setFlash(MORNING.flashIssued(inv.number));
          else if (inv.state === 'failed' || inv.state === 'blocked') setFlash(MORNING.flashFailed, true);
          return redirect(`/admin/receipts/${r.id}`);
        }
        if (m) {
          const r = receiptById(db, m[1]);
          if (!r) return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }), { banner });
          const expects = Object.fromEntries(PRODUCTS.map((pr) => [pr, f(`expect_${pr}`)]));
          try {
            // Each product's access just before, for what the owners' email says first (tellPaid()).
            const before = accessAll(db, r.workspace_id);
            const { recorded } = decideReceipt(db, r.id, m[2] === 'paid' ? 'paid' : 'not_paid', { ...by, expects });
            if (m[2] === 'paid') {
              // Committed: each product paid for hears at once, before the emails and before Morning, which may be slow.
              accessChanged(r.workspace_id, recorded.map((x) => x.product), 'paid');
              tellPaid(base, r.workspace_id, r.business, recorded, before);
              const paidLine = PAY.flashPaid(r.business, recorded.map((x) => PAY.flashPaidLine(PRODUCT_NAMES[x.product], dayHe(x.until))).join(' '));
              const inv = await invoiceReceipt(db, r.id, { client: morning, by: me, ip });
              if (inv.state === 'failed' || inv.state === 'blocked') {
                setFlash(`${paidLine} ${MORNING.flashFailed}`, true);
                return redirect(`/admin/receipts/${r.id}`);
              }
              setFlash(inv.state === 'issued' ? `${paidLine} ${MORNING.flashIssued(inv.number)}` : paidLine);
            } else setFlash(PAY.flashNotPaid(r.business));
            return redirect('/admin');
          } catch (e) {
            // The same "התשלום הגיע" again (a double click, the browser sending it again): it was recorded, and nothing
            // more is (no month, email, invoice or audit entry). Said on the receipt's page, above what was decided.
            if (e instanceof PayError && e.code === 'already_paid') {
              setFlash(T.errors.already_paid);
              return redirect(`/admin/receipts/${r.id}`);
            }
            if (e instanceof PayError) return receiptView(r, 409, PAY.errors[e.code] || e.code);
            if (e instanceof WorkspaceError) return receiptView(r, 409, T.errors[e.code] || e.code);
            throw e;
          }
        }

        if (p === '/admin/workspaces') {
          const form_ = { name: f('name'), slug: f('slug'), owner: f('owner'), products: form.getAll('products') };
          try {
            const { workspace, invite } = createWorkspace(db, { name: form_.name, slug: form_.slug, ownerEmail: form_.owner, products: form_.products }, by);
            mailer.send(inviteMail(invite.email, workspace.name, `${base}/invite?t=${invite.token}`, invite.expiresAt));
            setFlash(T.flashCreated(workspace.name, invite.email));
            return toConsole();
          } catch (e) {
            return problem(e, form_);
          }
        }

        m = /^\/admin\/workspaces\/(\d+)\/invoices$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            const fields = Object.fromEntries(['product', 'number', 'issued_on', 'period_from', 'period_to', 'amount', 'vat'].map((k) => [k, f(k)]));
            addInvoice(db, w.id, fields, files.pdf?.data, by);
            setFlash(T.flashInvoiceAdded(fields.number.trim(), w.name));
            return toConsole();
          } catch (e) {
            return problem(e, {}, m[1]);
          }
        }

        m = /^\/admin\/invoices\/(\d+)\/remove$/.exec(p);
        if (m) {
          const row = removeInvoice(db, m[1], by);
          if (row) setFlash(T.flashInvoiceRemoved(row.number));
          return toConsole();
        }

        // An invoice-receipt for a month already recorded with none (a month paid before "התקבל תשלום לחודש" issued
        // one; the owner, 2026-11-10: "I did not get an invoice, for my 1.18NIS payment"). Nothing more is recorded.
        m = /^\/admin\/workspaces\/(\d+)\/subscription\/invoice$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            const product = f('product');
            const s = subscriptionsOf(db, w.id)[product];
            if (!s?.paid_until || monthReceipted(db, w.id, product, s.paid_until)) {
              setFlash(T.flashInvoiceNone);
              return toConsole();
            }
            const first = (db.get('SELECT COUNT(*) AS n FROM paid_months WHERE workspace_id = ? AND product = ?', w.id, product)?.n || 0) <= 1;
            const rid = manualReceipt(db, w.id, monthBill(s, product, s.paid_until, { first }), by);
            const inv = await invoiceReceipt(db, rid, { client: morning, by: me, ip });
            if (inv.state === 'issued') setFlash(MORNING.flashIssued(inv.number));
            else if (inv.state === 'failed' || inv.state === 'blocked') setFlash(MORNING.flashFailed, true);
            return redirect(`/admin/receipts/${rid}`);
          } catch (e) {
            return problem(e, {}, m[1]);
          }
        }

        m = /^\/admin\/workspaces\/(\d+)\/subscription(\/pay)?$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            const product = f('product');
            if (m[2]) {
              // The button's one-time token and the paid-until date the console showed (ACC-03): the same form sent
              // again records nothing, and comes back to the console with "התשלום כבר נרשם" (below). Without either,
              // payMonth() refuses a second month within 60 seconds.
              let until;
              // The product's access just before, for what the owners' email says first (tellPaid()).
              const before = { [product]: accessFor(db, w.id, product) };
              // Whether this is its first month (its setup fee is on the invoice then), as payMonth() finds it.
              const paidBefore = subscriptionsOf(db, w.id)[product]?.paid_until || null;
              try {
                until = payMonth(db, w.id, product, { ...by, expect: form.has('expect') ? f('expect') : undefined, once: f('once') || undefined });
              } catch (e) {
                if (!(e instanceof WorkspaceError && e.code === 'already_paid')) throw e;
                const s = subscriptionsOf(db, w.id)[product];
                setFlash(s?.paid_until ? `${T.errors.already_paid} ${T.flashSubPaid(PRODUCT_NAMES[product], w.name, dayHe(s.paid_until))}` : T.errors.already_paid);
                return toConsole();
              }
              // Recorded and committed: the product hears at once (a refused duplicate, above, tells nobody), and each
              // owner that the payment is in.
              accessChanged(w.id, [product], 'paid');
              tellPaid(base, w.id, w.name, [{ product, until }], before);
              // Its invoice-receipt in Morning, as for a transfer's receipt (pay.js manualReceipt()); none for a month of
              // 0 ₪ (the owner, 2026-11-10: "When i get a payment other than 0NIS, it should be done automatically").
              const bill = monthBill(subscriptionsOf(db, w.id)[product], product, until, { first: !paidBefore });
              const rid = bill.total > 0 ? manualReceipt(db, w.id, bill, by) : null;
              const inv = rid ? await invoiceReceipt(db, rid, { client: morning, by: me, ip }) : { state: 'off' };
              const line = T.flashSubPaid(PRODUCT_NAMES[product], w.name, dayHe(until));
              if (inv.state === 'failed' || inv.state === 'blocked') {
                setFlash(`${line} ${MORNING.flashFailed}`, true);
                return redirect(`/admin/receipts/${rid}`);
              }
              setFlash(inv.state === 'issued' ? `${line} ${MORNING.flashIssued(inv.number)}` : line);
            } else {
              setSubscription(db, w.id, product, { plan: f('plan'), monthly: f('monthly'), setup: f('setup'), vat: f('vat'), started_on: f('started_on'), paid_until: f('paid_until'), ends_on: f('ends_on') }, by);
              // The paid-until day, the last day or Teder's plan may have moved: the product asks again.
              accessChanged(w.id, [product], 'subscription');
              setFlash(T.flashSubSaved(PRODUCT_NAMES[product], w.name));
            }
            return toConsole();
          } catch (e) {
            return problem(e, {}, m[1]);
          }
        }

        // The paywall: a product marked complimentary (free), or no longer.
        m = /^\/admin\/workspaces\/(\d+)\/comp$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            const on = f('comp') === '1';
            setComp(db, w.id, f('product'), on, by);
            accessChanged(w.id, [f('product')], 'comp');
            setFlash((on ? T.flashCompOn : T.flashCompOff)(PRODUCT_NAMES[f('product')], w.name));
            return toConsole();
          } catch (e) {
            return problem(e, {}, m[1]);
          }
        }

        // Delete a workspace and its data, as its owner can from their account: the name typed to confirm.
        m = /^\/admin\/workspaces\/(\d+)\/delete$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            if (w.deleted_at) throw new WorkspaceError('no_workspace');
            if (!sameName(f('name'), w.name)) return console_(400, { errorWs: { id: w.id, text: T.errors.name_mismatch } });
            const r = await eraseAll(w, { by: me, ip, source: 'admin' });
            if (!r.ok) return console_(502, { errorWs: { id: w.id, text: r.error } });
            setFlash(T.flashDeleted(r.name));
            return toConsole();
          } catch (e) {
            return problem(e, {}, m[1]);
          }
        }

        m = /^\/admin\/workspaces\/(\d+)\/(invite|products|disable|enable|founders|view-as)$/.exec(p);
        if (m) {
          const [, id, action] = m;
          try {
            const w = getWorkspace(db, id);
            if (action === 'invite') {
              const inv = createInvite(db, { workspaceId: w.id, email: f('email'), role: f('role'), ...by });
              mailer.send(inviteMail(inv.email, w.name, `${base}/invite?t=${inv.token}`, inv.expiresAt));
              setFlash(T.flashInvited(inv.email));
            } else if (action === 'products') {
              const on = f('enabled') === '1';
              setProduct(db, w.id, f('product'), on, by);
              // Off, it is told too: it had the product until now, and its engine reads what it kept.
              accessChanged(w.id, [f('product')], 'product', { had: true });
              setFlash((on ? T.flashProductOn : T.flashProductOff)(PRODUCT_NAMES[f('product')], w.name));
            } else if (action === 'disable' || action === 'enable') {
              setDisabled(db, w.id, action === 'disable', by);
              accessChanged(w.id, enabledProducts(db, w.id), 'workspace');
              setFlash((action === 'disable' ? T.flashDisabled : T.flashEnabled)(w.name));
              // The company's workspace opened from /admin's note goes back there (dashboard.js companyNote).
              if (f('back') === 'today') return redirect('/admin');
            } else if (action === 'founders') {
              // A test account's spot given back (src/accounts/founders.js): the website's counter counts it again.
              giveBackSpot(db, w.id, by);
              setFlash(T.flashFounderBack(w.name));
            } else {
              startViewAs(db, session, w.id, by);
              const product = f('product');
              return redirect(PRODUCTS.includes(product) ? urls[product] : '/admin/accounts');
            }
            return toConsole();
          } catch (e) {
            return problem(e, {}, m[1]);
          }
        }

        if (p === '/admin/view-as/stop') {
          if (stopViewAs(db, session, by)) setFlash(T.flashViewStopped);
          return toConsole();
        }

        m = /^\/admin\/invites\/(\d+)\/revoke$/.exec(p);
        if (m) {
          const row = db.get("SELECT email FROM tokens WHERE id = ? AND kind = 'invite'", Number(m[1]));
          if (row && revokeInvite(db, Number(m[1]), by)) setFlash(T.flashInviteRevoked(row.email));
          return toConsole();
        }
      }

      return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/login', T.notFoundBack]] }));
    } catch (e) {
      if (e instanceof Refused) return res.headersSent ? res.end() : refused(e.status);
      log(`[accounts] ${req.method} ${req.url?.split('?')[0]}: ${e.stack || e.message}`);
      if (!res.headersSent) {
        out.cookies = [];
        send(500, layout({ title: T.serverError, body: P.messagePage({ title: T.serverError, lead: '' }) }));
      }
    }
  };
}

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../core/audit.js';
import { ROOT } from '../core/paths.js';
import { PRODUCTS } from '../db/schema.js';
import { clientIp, cookies, csrfFor, csrfOk, isHttps, sessionSecret } from '../auth/http.js';
import { createLimiter, ipKey, LIMITS, signupMailDaily } from '../auth/limiter.js';
import { safeNext } from '../auth/next.js';
import { finishGoogle, GOOGLE, GoogleError, googleConfig, openFlow, sameState, sealFlow, startGoogle, FLOW_TTL } from '../auth/google.js';
import { bindGoogle, googleMatch, mailbox, userForGoogle } from '../accounts/google.js';
import { chooseWorkspace, createSession, describeSession, enabledProducts, findSession, LIFETIME, memberships, revokeAllSessions, revokeSession, sessionCookie, sessionFromJar } from '../auth/sessions.js';
import { acceptInvite, consumeMagicLink, createInvite, InviteError, normEmail, peekInvite, peekMagicLink, requestMagicLink, revokeInvite, validEmail } from '../accounts/links.js';
import { verifySuperadmin } from '../accounts/superadmin.js';
import { createWorkspace, getWorkspace, listWorkspaces, recentAudit, setDisabled, setProduct, startViewAs, stopViewAs, WorkspaceError } from '../accounts/workspaces.js';
import { checkSignup, completeSignup, CONTACT_URL, dropSignup, peekSignup, requestSignup, SignupError, signupNotify, signupOpen, signupProducts } from '../accounts/signup.js';
import { billingReady, checkoutUrl, payHow, paymentMode, supportWa } from '../accounts/billing.js';
import { accessAll, accessFor, BillingError, cancelSubscription, resumeSubscription, setComp } from '../accounts/entitlement.js';
import { eraseWorkspace, productsEver, sameName } from '../accounts/erase.js';
import { prefsOf, savePrefs } from '../accounts/notify.js';
import { cancelMail, cancelNoticeMail, deleteNoticeMail, existingAccountMail, inviteMail, magicLinkMail, paidMail, signupMail, signupNoticeMail, welcomeMail } from '../mail/messages.js';
import { CANCEL, ERASE, MAIL, NOTIFY, OPS, PRODUCT_NAMES, SETUP, SIGNUP, T, dayHe, ils, opensAfter, phoneHe } from './copy.js';
import { setupClient, setupState } from './setup.js';
import { eraseClient } from './erase.js';
import { createLinkCode, openLinkCode, phoneIn, phonesFor, PHONE, removePhone, setConsent } from '../accounts/phones.js';
import { describe, listPrice, payMonth, setSubscription, subscriptionsOf } from '../accounts/subscriptions.js';
import { addInvoice, invoiceIn, invoicesOf, PDF_MAX, removeInvoice } from '../accounts/invoices.js';
import { cancelTeamInvite, inviteToTeam, removeMember, TEAM_LIMIT, TeamError, teamOf } from '../accounts/team.js';
import { opsCustomers } from '../accounts/ops.js';
import { now } from '../core/clock.js';
import { dashboardPage } from './dashboard.js';
import { ACTIONS, ID, LOST_REASONS, toranClient } from './toran.js';
import { isAdminToran, operatorAssertion, proxyToToran, toranBase, touchesInternal } from './admin-toran.js';
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
// Server-rendered HTML; the only scripts are our own files: static/load.js (the loading state) on every page and
// static/admin.js on the operator's dashboard (/admin), nothing inline. Referrer-Policy is same-origin: a token in a
// URL (magic links, invites) is never sent to another site as a Referer, Teder
// and Toran included. Not no-referrer: with that, browsers send "Origin: null"
// on our own forms and the Origin check above would refuse every one of them.

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const BRAND = path.join(ROOT, 'assets', 'brand');
// The stylesheet and the company's icon (Teder's brand files, unchanged), read once.
const FILES = {
  '/static/site.css': [readFileSync(path.join(STATIC, 'site.css')), 'text/css; charset=utf-8'],
  '/static/admin.js': [readFileSync(path.join(STATIC, 'admin.js')), 'text/javascript; charset=utf-8'],
  '/static/load.js': [readFileSync(path.join(STATIC, 'load.js')), 'text/javascript; charset=utf-8'],
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
  };
}

export function productUrls(env = process.env) {
  return Object.fromEntries(PRODUCTS.map((p) => [p, String(env[`${p.toUpperCase()}_URL`] || '').trim() || `https://${p}.openfrequency.co.il/`]));
}

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

/** The owner line's WhatsApp number in international digits (OF_ASSISTANT_WA), or null while it is unset. */
export function assistantWa(env = process.env) {
  const digits = String(env.OF_ASSISTANT_WA || '').replace(/[\s+-]/g, '');
  return PHONE.test(digits) ? digits : null;
}

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

export function publicHandler({ db, env = process.env, mailer, limiters: given = {}, failDelayMs = 400, log = console.error, toran = toranClient({ env, log }), toranProxyMs, google = googleConfig(env), googleFetch = globalThis.fetch, setupMs, setupFetch = globalThis.fetch, eraseFetch = setupFetch, eraseMs }) {
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
      contact: payContact(env, SETUP.billingSupportText(name)),
    });
  };
  // Deleting a workspace: the products' parts first (src/web/erase.js), then ours (src/accounts/erase.js).
  const eraser = eraseClient({ env, log, fetchImpl: eraseFetch, ...(eraseMs ? { timeoutMs: eraseMs } : {}) });
  // The owner hears of each confirmed sign-up (OF_SIGNUP_NOTIFY). Called once its transaction has committed; the
  // mailer queues and never waits, and a failure here is logged and never stands in the customer's way. It has each
  // product's plan and price as its subscription has them, and what to do next: in manual mode, email the customer
  // the payment details.
  const notifyTo = signupNotify(env);
  const noticeSignup = ({ user, workspace }, method, base) => {
    if (!notifyTo.length) return;
    try {
      const products = enabledProducts(db, workspace.id);
      const subs = subscriptionsOf(db, workspace.id);
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
        payment,
        // The welcome email carries the payment details when the owner wrote them (OF_PAYMENT_METHOD).
        detailsSent: Boolean(payHow(env)),
        names: products.map((p) => PRODUCT_NAMES[p]).join(SIGNUP.and),
        many: products.length > 1,
        at: workspace.created_at,
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
  // to us; provider, they pay on the setup page.
  const welcome = ({ user, workspace }, base) => {
    try {
      const subs = subscriptionsOf(db, workspace.id);
      const products = enabledProducts(db, workspace.id);
      const prices = products.map((p) => {
        const list = listPrice(p, subs[p]?.plan);
        const setupFee = subs[p]?.setup ?? list.setup;
        return MAIL.welcomePrice(P.productLabel(p, subs[p]?.plan), ils(subs[p]?.monthly ?? list.monthly), ils(setupFee), p === 'teder' && setupFee > 0);
      });
      const opens = opensAfter(payment, products.map((p) => PRODUCT_NAMES[p]).join(SIGNUP.and), products.length > 1);
      mailer.send(welcomeMail(user.email, { business: workspace.name, link: `${base}/setup`, payment, opens, prices, payHow: payHow(env), wa: supportWa(env) }));
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
  // Our own script files only (load.js on every page, admin.js on /admin), from the fixed list in FILES, and nothing
  // inline: no script anyone could put in a page runs.
  const CSP = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction}`;
  const CSP_SCRIPT = CSP;
  const toranAt = toranBase(env);

  return async (req, res) => {
    const out = { cookies: [] };
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

    try {
      const host = String(req.headers.host || '').toLowerCase();
      const port = req.socket.localPort;
      if (![publicHost, `127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return text(421, 'unknown host');
      const secure = isHttps(req);
      if (publicHost && host === publicHost && !secure) return text(403, T.httpsOnly);

      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/healthz') return text(200, 'ok');
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
      // Toran's /internal routes. Everything else about the request (its CSRF, its forms) is Toran's to check.
      if (isAdminToran(p)) {
        const page_ = (status, title, body) => send(status, P.layout({ title, body, v: V }));
        if (!found?.user.is_superadmin || found.session.view_as_workspace_id) {
          if (req.method === 'GET') return redirect(`/admin/login?next=${encodeURIComponent(p + url.search)}`);
          return page_(403, T.adminLoginTitle, P.messagePage({ title: T.staleForm, lead: '', links: [['/admin/login', T.adminLoginTitle]] }));
        }
        if (touchesInternal(p)) return page_(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }));
        const o = req.headers.origin;
        if (req.method !== 'GET' && req.method !== 'HEAD' && o && o !== origin) return page_(403, T.loginTitle, P.messagePage({ title: T.crossSite, lead: '' }));
        return proxyToToran(req, res, {
          base: toranAt,
          path: p + url.search,
          secure,
          origin: base,
          operator: operatorAssertion(found.user, sid, env.OF_INTERNAL_TOKEN),
          timeoutMs: toranProxyMs,
          log,
          failed: (status) =>
            status === 413 ? text(413, 'too large') : page_(502, OPS.toranNoAnswerTitle, P.messagePage({ title: OPS.toranNoAnswerTitle, lead: OPS.toranNoAnswerLead, links: [['/admin', OPS.toranNoAnswerBack]] })),
        });
      }

      // The CSRF cookie: random, this host only, made on the first visit.
      const csrfName = secure ? '__Host-of_csrf' : 'of_csrf';
      let nonce = jar[csrfName];
      if (!/^[A-Za-z0-9_-]{22,}$/.test(nonce || '')) {
        if (req.method === 'POST') return send(403, P.layout({ title: T.loginTitle, body: P.messagePage({ title: T.staleForm, lead: '', links: [['/login', T.notFoundBack]] }), v: V }));
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
        if (o && o !== origin) return send(403, P.layout({ title: T.loginTitle, body: P.messagePage({ title: T.crossSite, lead: '' }), v: V }));
        if (/^multipart\/form-data/i.test(String(req.headers['content-type'] || ''))) {
          // A file, up to PDF_MAX, only on the invoice form and only from the superadmin; nobody else sends one.
          if (!UPLOAD.test(p) || !found?.user.is_superadmin) throw new Refused(415, 'unsupported');
          const parsed = parseMultipart(await readBody(req, PDF_MAX + 64_000), req.headers['content-type']);
          if (!parsed) throw new Refused(400, 'unreadable form');
          ({ fields: form, files } = parsed);
        } else {
          form = await readForm(req);
        }
        if (!csrfOk(form.get('_csrf'), nonce, secret)) return send(403, P.layout({ title: T.loginTitle, body: P.messagePage({ title: T.staleForm, lead: '', links: [[p.startsWith('/admin') ? '/admin' : '/login', T.notFoundBack]] }), v: V }));
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        return text(405, 'method not allowed');
      }
      const f = (k) => String(form?.get(k) ?? '');
      const page = (status, title, body, opts = {}) => send(status, P.layout({ title, body, flash, v: V, ...opts }));
      const next = (raw) => safeNext(raw, { allowLocal: dev });
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
        const subscriptions = Object.fromEntries(Object.entries(subscriptionsOf(db, wsId)).map(([prod, row]) => [prod, describe(row)]));
        const others = PRODUCTS.filter((prod) => !d.body.products.includes(prod));
        const body = P.homePage({
          csrf,
          user: found.user,
          workspace: d.body.workspace,
          products: d.body.products,
          productUrls: urls,
          canSwitch: mine.length > 1,
          subscriptions,
          access: accessAll(db, wsId),
          providerReady: billingReady(env),
          others,
          // Invoices are the owners' only: a member sees the team and the products, not what the business pays.
          invoices: d.body.role === 'client_owner' ? invoicesOf(db, wsId) : null,
          team: teamOf(db, wsId),
          whatsapp: { phones: phonesFor(db, { userId: found.user.id, workspaceId: wsId, role: d.body.role }), code: openLinkCode(db, found.user.id, wsId), waNumber },
          role: d.body.role,
          readOnly: d.body.readOnly,
          support,
          supportTeam: supportUrl(env, T.supportTeamText(d.body.workspace.name, TEAM_LIMIT)),
          flash,
          setup: st.complete ? null : { done: st.done, total: st.total, incomplete: st.incomplete },
          ...extra,
        });
        return page(status, T.homeHello(found.user.name || found.user.email), body, { wide: true });
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
          const links = [...(mine.length ? [['/workspace', T.homeSwitch]] : []), ['/logout', T.homeSignOut]];
          return page(403, T.loginTitle, P.messagePage({ title: T.homeClosed(ws?.name || ''), lead: '', links }));
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
        return page(200, SETUP.title, P.setupPage({ state, productUrls: urls, readOnly: d.body.readOnly, flash, access: accessAll(db, wsId), prices: subscriptionsOf(db, wsId), payHow: payHow(env) }), { wide: true, banner });
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

      const subMatch = /^\/subscription\/(teder|toran)\/(cancel|resume)$/.exec(p);
      if (subMatch) {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return page(403, CANCEL.title, P.messagePage({ title: CANCEL.readOnly, lead: '', links: [['/admin', T.adminTitle]] }));
        const { d, go } = customerIn(p);
        if (go) return redirect(go);
        const [, product, action] = subMatch;
        const ws = d.body.workspace;
        const name = PRODUCT_NAMES[product];
        const refuse = (code, status = 400) => page(status, CANCEL.title, P.messagePage({ title: CANCEL.errors[code] || code, lead: '', links: [['/', CANCEL.back]] }));
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
            const owners = db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL", ws.id);
            for (const o of owners) mailer.send(cancelMail(o.email, { business: ws.name, product, lastDay: r.lastDay, paid: r.paid, link: `${base}/` }));
            tellOwner((to) => cancelNoticeMail(to, { business: ws.name, product, who: found.user.email, lastDay: r.lastDay, paid: r.paid, link: `${base}/admin/accounts#ws-${ws.id}` }), 'cancellation');
            setFlash(r.paid ? CANCEL.flashCancelled(name, dayHe(r.lastDay)) : CANCEL.flashCancelledNow(name));
          } else {
            resumeSubscription(db, ws.id, product, { by: found.user, ip });
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
        if (d.body.role !== 'client_owner') return page(403, ERASE.title, P.messagePage({ title: ERASE.ownersOnly, lead: '', links: [['/', ERASE.back]] }));
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
          const done = completeSignup(db, f('t'), { kind: 'email', ip });
          if (!done) return dead();
          if (done.exists) return page(409, SIGNUP.existsTitle, P.messagePage({ title: SIGNUP.existsTitle, lead: SIGNUP.existsLead, links: [['/login', SIGNUP.toLogin]] }));
          noticeSignup(done, 'email', base);
          welcome(done, base);
          if (found) revokeSession(db, sid, { reason: 'replaced', ip });
          setSession(done.user, { workspaceId: done.workspace.id });
          return redirect('/setup');
        }

        // Someone already signed in: their account is open. A second workspace is the superadmin's to open.
        if (found) {
          const links = found.user.is_superadmin ? [['/admin', T.adminTitle]] : [['/', SIGNUP.home], ['/logout', SIGNUP.signOut]];
          return page(200, SIGNUP.title, P.messagePage({ title: SIGNUP.signedInTitle(found.user.email), lead: found.user.is_superadmin ? '' : SIGNUP.signedInLead, links }));
        }
        // No product starts chosen, not even the one the visitor came from (?p=) or the only one open: they tick it
        // themselves, and its plans open under it (the owner's choice, 2026-10-31).
        if (req.method !== 'POST') {
          // ?plan= (the website's button under each of Teder's plans) starts that plan chosen, for when Teder is ticked.
          return page(200, SIGNUP.title, P.signupPage({ csrf, google: Boolean(google), open: openProducts, payment, form: { products: [], plan: url.searchParams.get('plan') || '' } }));
        }

        const via = f('via') === 'google' && google ? 'google' : 'email';
        const raw = { name: f('name').slice(0, 200), business: f('business').slice(0, 200), email: f('email').slice(0, 254), products: form.getAll('products'), plan: f('plan').slice(0, 20), terms: f('terms') === '1' };
        const again = (status, error, extra) => send(status, P.layout({ title: SIGNUP.title, body: P.signupPage({ csrf, form: raw, error, google: Boolean(google), open: openProducts, payment }), v: V }), extra);
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
          return again(400, SIGNUP.errors[e.code]);
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
            const inv = inviteToTeam(db, { workspaceId: wsId, email: f('email'), role: f('role'), ...by });
            mailer.send(inviteMail(inv.email, inv.workspace.name, `${base}/invite?t=${inv.token}`, inv.expiresAt));
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

      // WhatsApp on the home page: a link code, a number removed, its updates on or off. Only a customer in their own
      // workspace; the superadmin (in view-as, read-only) changes nothing here.
      if (p.startsWith('/whatsapp/') && req.method === 'POST') {
        if (!found) return redirect('/login');
        if (found.user.is_superadmin) return page(403, T.loginTitle, P.messagePage({ title: T.waReadOnly, lead: '', links: [['/admin', T.adminTitle]] }));
        const d = describeSession(db, sid);
        if (d.status !== 200 || d.body.readOnly) return redirect('/');
        const me = found.user;
        const wsId = d.body.workspace.id;
        if (p === '/whatsapp/link') {
          createLinkCode(db, { user: me, workspaceId: wsId, optIn: f('updates') === '1', ip });
          return redirect('/#whatsapp');
        }
        // A number of this workspace only: its own person, or the owner to remove it. Anything else changes nothing.
        const row = phoneIn(db, f('phone'), wsId);
        if (p === '/whatsapp/remove' && row && (row.user_id === me.id || d.body.role === 'client_owner')) {
          removePhone(db, row.phone, { by: me, ip });
          setFlash(T.flashWaRemoved(phoneHe(row.phone)));
        } else if (p === '/whatsapp/updates' && row && row.user_id === me.id) {
          const on = f('on') === '1';
          setConsent(db, row.phone, { optIn: on, source: 'accounts', actor: me, ip });
          setFlash((on ? T.flashWaOn : T.flashWaOff)(phoneHe(row.phone)));
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
          return send(429, P.layout({ title: T.loginTitle, body: P.loginPage({ csrf, next: to || '', email, error: T.tooMany(wait), google: Boolean(google), signup: signupOn }), v: V }), { 'retry-after': String(wait) });
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
        const inviteDead = () => page(410, T.inviteDeadTitle, P.deadPage({ title: T.inviteDeadTitle, lead: T.inviteDeadLead }));
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
          const done = completeSignup(db, flow.signup, { kind: 'google', email: who.email, ip });
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
        const dead = () => page(410, T.inviteDeadTitle, P.deadPage({ title: T.inviteDeadTitle, lead: T.inviteDeadLead }));
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
        if (!mine.length) return page(200, T.loginTitle, P.messagePage({ title: T.homeNoWorkspace, lead: '', links: [['/logout', T.homeSignOut]] }));
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
        // ?next= back to the /admin page that sent here (Toran's pages under /admin/toran), and only to one of those.
        const adminNext = (raw) => {
          const to = safeNext(raw);
          return to && /^\/admin(?:[/?#]|$)/.test(to) && !to.startsWith('/admin/login') ? to : '';
        };
        if (req.method !== 'POST') {
          if (found?.user.is_superadmin) return redirect('/admin');
          return page(200, T.adminLoginTitle, P.adminLoginPage({ csrf, next: adminNext(url.searchParams.get('next')) }));
        }
        const back = adminNext(f('next'));
        const wait = limiters.adminLogin.check(ipKey(ip));
        if (wait) return send(429, P.layout({ title: T.adminLoginTitle, body: P.adminLoginPage({ csrf, next: back, email: f('email'), error: T.adminTooMany(wait) }), v: V }), { 'retry-after': String(wait) });
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
        const by = { by: me, ip };
        const problem = (e, form_) => {
          if (e instanceof WorkspaceError || e instanceof InviteError) return console_(400, { error: T.errors[e.code] || e.code, form: form_ });
          throw e;
        };

        // The operator's home: the dashboard, read from Toran and from our own subscriptions at each load.
        if (p === '/admin' && req.method === 'GET') {
          const viewAs = Boolean(session.view_as_workspace_id);
          const t = viewAs ? null : { ...(await toran.ops()), base: toran.base };
          const body = dashboardPage({ csrf, flash, flashBad, toran: t, customers: viewAs ? null : opsCustomers(db), at: now(), viewAs });
          return send(200, P.layout({ title: OPS.title, body, v: V, wide: true, banner, script: true }), { 'content-security-policy': CSP_SCRIPT });
        }
        if (p === '/admin/accounts' && req.method === 'GET') return console_(200);
        let m = /^\/admin\/invoices\/(\d+)$/.exec(p);
        if (m && req.method === 'GET') {
          const inv = db.get('SELECT * FROM invoices WHERE id = ?', Number(m[1]));
          if (inv) return pdf(inv);
        }
        if (req.method !== 'POST') return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }), { banner });

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
            return problem(e, {});
          }
        }

        m = /^\/admin\/invoices\/(\d+)\/remove$/.exec(p);
        if (m) {
          const row = removeInvoice(db, m[1], by);
          if (row) setFlash(T.flashInvoiceRemoved(row.number));
          return toConsole();
        }

        m = /^\/admin\/workspaces\/(\d+)\/subscription(\/pay)?$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            const product = f('product');
            if (m[2]) {
              // The paid-until date the console showed: a second press of the same button records nothing (ACC-03).
              const until = payMonth(db, w.id, product, { ...by, expect: form.has('expect') ? f('expect') : undefined });
              // Each owner hears that the payment is in.
              const owners = db.all("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'client_owner' AND u.disabled_at IS NULL", w.id);
              for (const o of owners) mailer.send(paidMail(o.email, { business: w.name, product, until, link: `${base}/` }));
              setFlash(T.flashSubPaid(PRODUCT_NAMES[product], w.name, dayHe(until)));
            } else {
              setSubscription(db, w.id, product, { plan: f('plan'), monthly: f('monthly'), setup: f('setup'), vat: f('vat'), started_on: f('started_on'), paid_until: f('paid_until'), ends_on: f('ends_on') }, by);
              setFlash(T.flashSubSaved(PRODUCT_NAMES[product], w.name));
            }
            return toConsole();
          } catch (e) {
            return problem(e, {});
          }
        }

        // The paywall: a product marked complimentary (free), or no longer.
        m = /^\/admin\/workspaces\/(\d+)\/comp$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            const on = f('comp') === '1';
            setComp(db, w.id, f('product'), on, by);
            setFlash((on ? T.flashCompOn : T.flashCompOff)(PRODUCT_NAMES[f('product')], w.name));
            return toConsole();
          } catch (e) {
            return problem(e, {});
          }
        }

        // Delete a workspace and its data, as its owner can from their account: the name typed to confirm.
        m = /^\/admin\/workspaces\/(\d+)\/delete$/.exec(p);
        if (m) {
          try {
            const w = getWorkspace(db, m[1]);
            if (w.deleted_at) throw new WorkspaceError('no_workspace');
            if (!sameName(f('name'), w.name)) return console_(400, { error: T.errors.name_mismatch });
            const r = await eraseAll(w, { by: me, ip, source: 'admin' });
            if (!r.ok) return console_(502, { error: r.error });
            setFlash(T.flashDeleted(r.name));
            return toConsole();
          } catch (e) {
            return problem(e, {});
          }
        }

        m = /^\/admin\/workspaces\/(\d+)\/(invite|products|disable|enable|view-as)$/.exec(p);
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
              setFlash((on ? T.flashProductOn : T.flashProductOff)(PRODUCT_NAMES[f('product')], w.name));
            } else if (action === 'disable' || action === 'enable') {
              setDisabled(db, w.id, action === 'disable', by);
              setFlash((action === 'disable' ? T.flashDisabled : T.flashEnabled)(w.name));
            } else {
              startViewAs(db, session, w.id, by);
              const product = f('product');
              return redirect(PRODUCTS.includes(product) ? urls[product] : '/admin/accounts');
            }
            return toConsole();
          } catch (e) {
            return problem(e, {});
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
      if (e instanceof Refused) return text(e.status, e.message);
      log(`[accounts] ${req.method} ${req.url?.split('?')[0]}: ${e.stack || e.message}`);
      if (!res.headersSent) {
        out.cookies = [];
        send(500, P.layout({ title: T.serverError, body: P.messagePage({ title: T.serverError, lead: '' }), v: V }));
      }
    }
  };
}

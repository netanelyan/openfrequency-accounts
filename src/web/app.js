import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../core/audit.js';
import { ROOT } from '../core/paths.js';
import { PRODUCTS } from '../db/schema.js';
import { clientIp, cookies, csrfFor, csrfOk, isHttps, sessionSecret } from '../auth/http.js';
import { createLimiter, LIMITS } from '../auth/limiter.js';
import { safeNext } from '../auth/next.js';
import { chooseWorkspace, createSession, describeSession, findSession, LIFETIME, memberships, revokeAllSessions, revokeSession, sessionCookie, sessionFromJar } from '../auth/sessions.js';
import { acceptInvite, consumeMagicLink, createInvite, InviteError, normEmail, peekInvite, peekMagicLink, requestMagicLink, revokeInvite, validEmail } from '../accounts/links.js';
import { verifySuperadmin } from '../accounts/superadmin.js';
import { createWorkspace, getWorkspace, listWorkspaces, recentAudit, setDisabled, setProduct, startViewAs, stopViewAs, WorkspaceError } from '../accounts/workspaces.js';
import { inviteMail, magicLinkMail } from '../mail/messages.js';
import { OPS, PRODUCT_NAMES, T, dayHe, phoneHe } from './copy.js';
import { createLinkCode, openLinkCode, phoneIn, phonesFor, PHONE, removePhone, setConsent } from '../accounts/phones.js';
import { describe, payMonth, setSubscription, subscriptionsOf } from '../accounts/subscriptions.js';
import { addInvoice, invoiceIn, invoicesOf, PDF_MAX, removeInvoice } from '../accounts/invoices.js';
import { cancelTeamInvite, inviteToTeam, removeMember, TEAM_LIMIT, TeamError, teamOf } from '../accounts/team.js';
import { opsCustomers } from '../accounts/ops.js';
import { now } from '../core/clock.js';
import { dashboardPage } from './dashboard.js';
import { ACTIONS, ID, LOST_REASONS, toranClient } from './toran.js';
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
// Server-rendered HTML, no script, except static/admin.js on the operator's
// dashboard (/admin), which only that page's CSP allows. Referrer-Policy is same-origin: a token in a
// URL (magic links, invites) is never sent to another site as a Referer, Teder
// and Toran included. Not no-referrer: with that, browsers send "Origin: null"
// on our own forms and the Origin check above would refuse every one of them.

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const BRAND = path.join(ROOT, 'assets', 'brand');
// The stylesheet and the company's icon (Teder's brand files, unchanged), read once.
const FILES = {
  '/static/site.css': [readFileSync(path.join(STATIC, 'site.css')), 'text/css; charset=utf-8'],
  '/static/admin.js': [readFileSync(path.join(STATIC, 'admin.js')), 'text/javascript; charset=utf-8'],
  '/static/icon.svg': [readFileSync(path.join(BRAND, 'svg', 'openfrequency-small.svg')), 'image/svg+xml'],
  '/static/icon-180.png': [readFileSync(path.join(BRAND, 'png', 'openfrequency-180.png')), 'image/png'],
};
const V = Date.now().toString(36);

export function defaultLimiters() {
  return { magicEmail: createLimiter(LIMITS.magicPerEmail), magicIp: createLimiter(LIMITS.magicPerIp), adminLogin: createLimiter(LIMITS.adminLogin) };
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
  const digits = String(env.OF_SUPPORT_WA || '').replace(/[\s+-]/g, '');
  if (!PHONE.test(digits)) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
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

export function publicHandler({ db, env = process.env, mailer, limiters = defaultLimiters(), failDelayMs = 400, log = console.error, toran = toranClient({ env, log }) }) {
  const secret = sessionSecret(env);
  const publicHost = String(env.PUBLIC_HOST || '').trim().toLowerCase() || null;
  const dev = !publicHost;
  const urls = productUrls(env);
  const support = supportUrl(env);
  const waNumber = assistantWa(env);
  const formAction = `'self' https://*.openfrequency.co.il${dev ? ' http://localhost:* http://127.0.0.1:*' : ''}`;
  const CSP = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction}`;
  // The dashboard: our one script file, and nothing inline.
  const CSP_SCRIPT = CSP.replace("script-src 'none'", "script-src 'self'");

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

      const sid = sessionFromJar(jar, secure);
      const found = sid ? findSession(db, sid) : null;

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
      const dashboard = (d, status = 200, extra = {}) => {
        const wsId = d.body.workspace.id;
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
          ...extra,
        });
        return page(status, T.homeHello(found.user.name || found.user.email), body, { wide: true });
      };
      const clearSession = () => out.cookies.push(sessionCookie('', { secure, clear: true }));
      const landing = (user, session, to) => {
        if (user.is_superadmin) return to || '/admin';
        if (!session.workspace_id) return `/workspace${to ? `?next=${encodeURIComponent(to)}` : ''}`;
        return to || '/';
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
        return dashboard(d);
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
          return dashboard(d, e.code === 'not_owner' ? 403 : 400, { teamError: T.teamErrors[e.code] || T.errors[e.code] || e.code, teamForm: { email: f('email'), role: f('role') } });
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
        if (found) return redirect(landing(found.user, found.session, to));
        const out_ = url.searchParams.get('out');
        const notice = out_ === 'all' ? T.signedOutAll(Number(url.searchParams.get('n')) || 0) : out_ ? T.signedOut : '';
        return page(200, T.loginTitle, P.loginPage({ csrf, next: to || '', notice }));
      }

      if (p === '/login') {
        const email = normEmail(f('email'));
        const to = next(f('next'));
        if (!validEmail(email)) return page(400, T.loginTitle, P.loginPage({ csrf, next: to || '', email: f('email').slice(0, 254), error: T.badEmail }));
        const wait = Math.max(limiters.magicIp.check(ip) || 0, limiters.magicEmail.check(email) || 0);
        if (wait) {
          return send(429, P.layout({ title: T.loginTitle, body: P.loginPage({ csrf, next: to || '', email, error: T.tooMany(wait) }), v: V }), { 'retry-after': String(wait) });
        }
        limiters.magicIp.hit(ip);
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
        return redirect(landing(used.user, row, next(used.next)));
      }

      if (p === '/invite') {
        const dead = () => page(410, T.inviteDeadTitle, P.deadPage({ title: T.inviteDeadTitle, lead: T.inviteDeadLead }));
        if (req.method !== 'POST') {
          const t = url.searchParams.get('t') || '';
          const live = peekInvite(db, t);
          return live ? page(200, T.inviteTitle(live.workspace.name), P.invitePage({ csrf, token: t, email: live.row.email, workspace: live.workspace })) : dead();
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
        if (req.method !== 'POST') {
          if (found?.user.is_superadmin) return redirect('/admin');
          return page(200, T.adminLoginTitle, P.adminLoginPage({ csrf }));
        }
        const wait = limiters.adminLogin.check(ip);
        if (wait) return send(429, P.layout({ title: T.adminLoginTitle, body: P.adminLoginPage({ csrf, email: f('email'), error: T.adminTooMany(wait) }), v: V }), { 'retry-after': String(wait) });
        const ok = verifySuperadmin(db, { email: f('email'), password: f('password'), code: f('code') });
        if (!ok) {
          limiters.adminLogin.hit(ip);
          audit(db, { action: 'admin_login_failed', ip, detail: { email: f('email').slice(0, 254) } });
          await sleep(failDelayMs);
          return page(401, T.adminLoginTitle, P.adminLoginPage({ csrf, email: f('email'), error: T.adminLoginFailed }));
        }
        limiters.adminLogin.clear(ip);
        audit(db, { actor: ok.user, action: 'sign_in', ip, detail: { method: ok.method } });
        if (found) revokeSession(db, sid, { reason: 'replaced', ip });
        setSession(ok.user);
        if (ok.method === 'recovery') setFlash(T.adminRecoveryUsed(ok.recoveryLeft));
        return redirect('/admin');
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
          page(status, T.adminTitle, P.adminPage({ csrf, workspaces: listWorkspaces(db), audit: recentAudit(db), flash, ...extra }), { wide: true, banner });
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
          if (ACTIONS[action] && ACTIONS[action] !== kind) return answer(false, action === 'direct' ? OPS.directToranOnly : action === 'won' ? OPS.wonTederOnly : OPS.pilotToranOnly);
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
              const until = payMonth(db, w.id, product, by);
              setFlash(T.flashSubPaid(PRODUCT_NAMES[product], w.name, dayHe(until)));
            } else {
              setSubscription(db, w.id, product, { monthly: f('monthly'), setup: f('setup'), vat: f('vat'), started_on: f('started_on'), paid_until: f('paid_until'), ends_on: f('ends_on') }, by);
              setFlash(T.flashSubSaved(PRODUCT_NAMES[product], w.name));
            }
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

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { clientIp, cookies, csrfFor, csrfOk, isHttps, sessionSecret } from '../auth/http.js';
import { createLimiter, LIMITS } from '../auth/limiter.js';
import { safeNext } from '../auth/next.js';
import { chooseWorkspace, createSession, describeSession, findSession, LIFETIME, memberships, revokeAllSessions, revokeSession, sessionCookie, sessionFromJar } from '../auth/sessions.js';
import { acceptInvite, consumeMagicLink, createInvite, InviteError, normEmail, peekInvite, peekMagicLink, requestMagicLink, revokeInvite, validEmail } from '../accounts/links.js';
import { verifySuperadmin } from '../accounts/superadmin.js';
import { createWorkspace, getWorkspace, listWorkspaces, recentAudit, setDisabled, setProduct, startViewAs, stopViewAs, WorkspaceError } from '../accounts/workspaces.js';
import { inviteMail, magicLinkMail } from '../mail/messages.js';
import { PRODUCT_NAMES, T } from './copy.js';
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
// Server-rendered HTML, no script. Referrer-Policy is same-origin: a token in a
// URL (magic links, invites) is never sent to another site as a Referer, Teder
// and Toran included. Not no-referrer: with that, browsers send "Origin: null"
// on our own forms and the Origin check above would refuse every one of them.

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const CSS = readFileSync(path.join(STATIC, 'site.css'));
const V = Date.now().toString(36);

export function defaultLimiters() {
  return { magicEmail: createLimiter(LIMITS.magicPerEmail), magicIp: createLimiter(LIMITS.magicPerIp), adminLogin: createLimiter(LIMITS.adminLogin) };
}

export function productUrls(env = process.env) {
  return Object.fromEntries(PRODUCTS.map((p) => [p, String(env[`${p.toUpperCase()}_URL`] || '').trim() || `https://${p}.openfrequency.co.il/`]));
}

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readForm(req, limit = 16_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Refused(413, 'too large');
    chunks.push(c);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function publicHandler({ db, env = process.env, mailer, limiters = defaultLimiters(), failDelayMs = 400, log = console.error }) {
  const secret = sessionSecret(env);
  const publicHost = String(env.PUBLIC_HOST || '').trim().toLowerCase() || null;
  const dev = !publicHost;
  const urls = productUrls(env);
  const formAction = `'self' https://*.openfrequency.co.il${dev ? ' http://localhost:* http://127.0.0.1:*' : ''}`;
  const CSP = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction}`;

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
    const text = (status, body) => {
      res.writeHead(status, headers({ 'content-type': 'text/plain; charset=utf-8' }));
      res.end(body);
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
      if (req.method === 'GET' && p === '/static/site.css') {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
        return res.end(CSS);
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
      let flash = '';
      if (jar[flashName] && req.method === 'GET') {
        flash = jar[flashName].slice(0, 300);
        out.cookies.push(`${flashName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${sec}`);
      }
      const setFlash = (msg) => out.cookies.push(`${flashName}=${encodeURIComponent(msg)}; Path=/; Max-Age=30; HttpOnly; SameSite=Lax${sec}`);

      let form = null;
      if (req.method === 'POST') {
        const o = req.headers.origin;
        if (o && o !== origin) return send(403, P.layout({ title: T.loginTitle, body: P.messagePage({ title: T.crossSite, lead: '' }), v: V }));
        form = await readForm(req);
        if (!csrfOk(form.get('_csrf'), nonce, secret)) return send(403, P.layout({ title: T.loginTitle, body: P.messagePage({ title: T.staleForm, lead: '', links: [[p.startsWith('/admin') ? '/admin' : '/login', T.notFoundBack]] }), v: V }));
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        return text(405, 'method not allowed');
      }
      const f = (k) => String(form?.get(k) ?? '');

      const sid = sessionFromJar(jar, secure);
      const found = sid ? findSession(db, sid) : null;
      const page = (status, title, body, opts = {}) => send(status, P.layout({ title, body, flash, v: V, ...opts }));
      const next = (raw) => safeNext(raw, { allowLocal: dev });
      const setSession = (user, opts = {}) => {
        const s = createSession(db, user, { ip, userAgent: req.headers['user-agent'], ...opts });
        out.cookies.push(sessionCookie(s.id, { secure, maxAgeMs: user.is_superadmin ? LIFETIME.superadmin.maxMs : LIFETIME.client.maxMs }));
        return s.row;
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
        return page(200, T.homeHello(found.user.name || found.user.email), P.homePage({ csrf, user: found.user, workspace: d.body.workspace, products: d.body.products, productUrls: urls, canSwitch: mine.length > 1 }));
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
          page(status, T.adminTitle, P.adminPage({ csrf, workspaces: listWorkspaces(db), audit: recentAudit(db), ...extra }), { wide: true, banner });
        const by = { by: me, ip };
        const problem = (e, form_) => {
          if (e instanceof WorkspaceError || e instanceof InviteError) return console_(400, { error: T.errors[e.code] || e.code, form: form_ });
          throw e;
        };

        if (p === '/admin' && req.method === 'GET') return console_(200);
        if (req.method !== 'POST') return page(404, T.notFound, P.messagePage({ title: T.notFound, lead: '', links: [['/admin', T.adminTitle]] }), { banner });

        if (p === '/admin/workspaces') {
          const form_ = { name: f('name'), slug: f('slug'), owner: f('owner'), products: form.getAll('products') };
          try {
            const { workspace, invite } = createWorkspace(db, { name: form_.name, slug: form_.slug, ownerEmail: form_.owner, products: form_.products }, by);
            mailer.send(inviteMail(invite.email, workspace.name, `${base}/invite?t=${invite.token}`, invite.expiresAt));
            setFlash(T.flashCreated(workspace.name, invite.email));
            return redirect('/admin');
          } catch (e) {
            return problem(e, form_);
          }
        }

        let m = /^\/admin\/workspaces\/(\d+)\/(invite|products|disable|enable|view-as)$/.exec(p);
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
              return redirect(PRODUCTS.includes(product) ? urls[product] : '/admin');
            }
            return redirect('/admin');
          } catch (e) {
            return problem(e, {});
          }
        }

        if (p === '/admin/view-as/stop') {
          if (stopViewAs(db, session, by)) setFlash(T.flashViewStopped);
          return redirect('/admin');
        }

        m = /^\/admin\/invites\/(\d+)\/revoke$/.exec(p);
        if (m) {
          const row = db.get("SELECT email FROM tokens WHERE id = ? AND kind = 'invite'", Number(m[1]));
          if (row && revokeInvite(db, Number(m[1]), by)) setFlash(T.flashInviteRevoked(row.email));
          return redirect('/admin');
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

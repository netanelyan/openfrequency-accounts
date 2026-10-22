import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/paths.js';
import { AUDIT_NAMES, PRODUCT_NAMES, ROLE_NAMES, T, when } from './copy.js';

// Server-rendered pages: Hebrew, right to left, one stylesheet, no script.
// Everything shown is escaped here; nothing reaches the page raw. The look is
// Teder's (see the head of static/site.css).

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

/** A one-button form. */
export const button = (action, label, csrf, { fields = {}, kind = 'primary' } = {}) =>
  `<form method="post" action="${esc(action)}" class="inline">${csrfField(csrf)}${Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')}<button class="${kind}">${esc(label)}</button></form>`;

// ---- the marks: the brand files' glyphs on their own colour, never redrawn (assets/brand)

const glyph = (name) => readFileSync(path.join(ROOT, 'assets', 'brand', 'svg', `${name}.svg`), 'utf8').replace(/^\s*<svg[^>]*>|<\/svg>\s*$/g, '');
const GLYPHS = { of: glyph('openfrequency-glyph'), ofSmall: glyph('openfrequency-glyph-small'), teder: glyph('teder-glyph'), toran: glyph('toran-glyph') };
const tile = (cls, inner) => `<span class="mark ${cls}" aria-hidden="true"><svg viewBox="0 0 100 100">${inner}</svg></span>`;
/** The company's halftone. The full one from 48px up; the simpler one below, where small dots vanish. */
const ofMark = (large = false) => tile('of', large ? GLYPHS.of : GLYPHS.ofSmall);
const productMark = (p) => tile(p, GLYPHS[p]);

export function layout({ title, body, banner = '', flash = '', wide = false, v = '' }) {
  const hero = wide ? '' : `<div class="hero">${ofMark(true)}<b class="ltr">${esc(T.brand)}</b></div>`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eeeff2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)">
<title>${esc(title)} · ${esc(T.brand)}</title>
<link rel="stylesheet" href="/static/site.css?v=${esc(v)}">
</head>
<body>
${banner}
<main class="${wide ? 'wide' : 'narrow'}">
${hero}
${flash && !wide ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
${body}
</main>
</body>
</html>`;
}

export const viewAsBanner = (workspaceName, csrf) =>
  `<div class="banner" role="status"><span>${esc(T.viewAsBanner(workspaceName))}</span>${button('/admin/view-as/stop', T.viewAsStop, csrf, { kind: 'quiet' })}</div>`;

/** Small grey links under a card: [href, label] pairs. */
const links = (pairs) => (pairs.length ? `<p class="links">${pairs.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('')}</p>` : '');

// ---- customer pages

export const loginPage = ({ csrf, next = '', email = '', error = '', notice = '' }) => `
<section class="card">
<h1>${esc(T.loginHeading)}</h1>
${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
<p class="lead">${esc(T.loginLead)}</p>
<form method="post" action="/login">
${csrfField(csrf)}
<input type="hidden" name="next" value="${esc(next)}">
<label for="email">${esc(T.emailLabel)}</label>
<input id="email" name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" required maxlength="254" placeholder="name@example.com" value="${esc(email)}"${error ? ' aria-invalid="true" aria-describedby="err"' : ''} autofocus>
${error ? `<p class="error" id="err" role="alert">${esc(error)}</p>` : ''}
<button class="primary">${esc(T.loginButton)}</button>
</form>
</section>
<p class="muted center">${esc(T.loginNoAccount)}</p>`;

export const sentPage = ({ email, next = '' }) => `
<section class="card">
<h1>${esc(T.sentTitle)}</h1>
<p class="lead">${esc(T.sentLead(email))}</p>
<p class="muted">${esc(T.sentSpam)}</p>
</section>
${links([[`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`, T.sentAgain]])}`;

export const confirmLinkPage = ({ csrf, token, email }) => `
<section class="card">
<h1>${esc(T.linkTitle)}</h1>
<p class="lead">${esc(T.linkLead(email))}</p>
<form method="post" action="/auth/link">${csrfField(csrf)}<input type="hidden" name="t" value="${esc(token)}"><button class="primary">${esc(T.linkButton)}</button></form>
</section>`;

export const deadPage = ({ title, lead, href = '/login', label = T.sentAgain }) => `
<section class="card">
<h1>${esc(title)}</h1>
<p class="lead">${esc(lead)}</p>
<p><a class="button primary" href="${esc(href)}">${esc(label)}</a></p>
</section>`;

export const invitePage = ({ csrf, token, email, workspace }) => `
<section class="card">
<h1>${esc(T.inviteTitle(workspace.name))}</h1>
<p class="lead">${esc(T.inviteLead(email))}</p>
<form method="post" action="/invite">
${csrfField(csrf)}
<input type="hidden" name="t" value="${esc(token)}">
<label for="name">${esc(T.inviteNameLabel)}</label>
<input id="name" name="name" autocomplete="name" maxlength="80">
<button class="primary">${esc(T.inviteButton)}</button>
</form>
</section>`;

export function homePage({ user, workspace, products, productUrls, canSwitch }) {
  const list = products.length
    ? `<ul class="products">${products
        .map((p) => `<li><a href="${esc(productUrls[p])}">${productMark(p)}<span>${esc(T.homeOpen(PRODUCT_NAMES[p]))}</span><span class="go" aria-hidden="true">‹</span></a></li>`)
        .join('')}</ul>`
    : `<p class="muted">${esc(T.homeNoProducts)}</p>`;
  return `
<section class="card">
<h1>${esc(T.homeHello(user.name || user.email))}</h1>
<p class="lead">${esc(T.homeWho(user.email, workspace.name))}</p>
${list}
</section>
${links([...(canSwitch ? [['/workspace', T.homeSwitch]] : []), ['/logout', T.homeSignOut]])}`;
}

export const messagePage = ({ title, lead, links: pairs = [] }) => `
<section class="card">
<h1>${esc(title)}</h1>
${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
</section>
${links(pairs)}`;

export const pickPage = ({ csrf, workspaces, next = '' }) => `
<section class="card">
<h1>${esc(T.pickTitle)}</h1>
<p class="lead">${esc(T.pickLead)}</p>
<ul class="pick">${workspaces
  .map(
    (w) => `<li><form method="post" action="/workspace">${csrfField(csrf)}<input type="hidden" name="workspace" value="${esc(w.id)}"><input type="hidden" name="next" value="${esc(next)}"><button><span><span>${esc(w.name)}</span><span class="role">${esc(ROLE_NAMES[w.role])}</span></span><span class="go" aria-hidden="true">‹</span></button></form></li>`
  )
  .join('')}</ul>
</section>`;

export const logoutPage = ({ csrf, email }) => `
<section class="card">
<h1>${esc(T.logoutTitle)}</h1>
<p class="lead">${esc(T.logoutLead(email))}</p>
<div class="row">${button('/logout', T.logoutHere, csrf)}${button('/logout-all', T.logoutAll, csrf, { kind: 'danger' })}</div>
</section>
${links([['/', T.logoutBack]])}`;

// ---- superadmin

export const adminLoginPage = ({ csrf, email = '', error = '' }) => `
<section class="card">
<h1>${esc(T.adminLoginTitle)}</h1>
<form method="post" action="/admin/login" autocomplete="on">
${csrfField(csrf)}
<label for="email">${esc(T.adminEmail)}</label>
<input id="email" name="email" type="email" autocomplete="username" dir="ltr" required value="${esc(email)}">
<label for="password">${esc(T.adminPassword)}</label>
<input id="password" name="password" type="password" autocomplete="current-password" dir="ltr" required>
<label for="code">${esc(T.adminCode)}</label>
<input id="code" name="code" autocomplete="one-time-code" inputmode="text" dir="ltr" required maxlength="20" aria-describedby="code-hint">
<small id="code-hint">${esc(T.adminCodeHint)}</small>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<button class="primary">${esc(T.adminLoginButton)}</button>
</form>
</section>`;

const roleSelect = (name) =>
  `<select name="${name}" aria-label="${esc(T.inviteRole)}">${['client_member', 'client_owner'].map((r) => `<option value="${r}">${esc(ROLE_NAMES[r])}</option>`).join('')}</select>`;

function workspaceTile(w, csrf) {
  const base = `/admin/workspaces/${w.id}`;
  const products = Object.entries(w.products)
    .map(([p, on]) => {
      const name = PRODUCT_NAMES[p];
      return `<li class="${on ? 'on' : 'off'}">${productMark(p)}<b>${esc(name)}</b><span class="state">${esc(on ? T.productOn : T.productOff)}</span>${button(`${base}/products`, on ? T.turnOff(name) : T.turnOn(name), csrf, { fields: { product: p, enabled: on ? '0' : '1' }, kind: 'quiet' })}</li>`;
    })
    .join('');
  const people = [
    ...w.members.map(
      (m) => `<li><span class="who ltr">${esc(m.email)}</span><span class="muted">${esc(ROLE_NAMES[m.role])}</span><span class="muted end">${esc(m.last_login_at ? T.lastLogin(when(m.last_login_at)) : T.neverLoggedIn)}</span></li>`
    ),
    ...w.invites.map((i) => `<li><span class="muted">${esc(T.pendingInvite(i.email, when(i.expires_at)))}</span><span class="end">${button(`/admin/invites/${i.id}/revoke`, T.revokeInvite, csrf, { kind: 'quiet' })}</span></li>`),
  ];
  const enabledProducts = Object.entries(w.products).filter(([, on]) => on).map(([p]) => p);
  const viewAs = `<form method="post" action="${base}/view-as" class="inline">${csrfField(csrf)}${
    enabledProducts.length
      ? `<select name="product" aria-label="${esc(T.viewIn)}">${enabledProducts.map((p) => `<option value="${p}">${esc(PRODUCT_NAMES[p])}</option>`).join('')}</select>`
      : ''
  }<button class="quiet">${esc(T.viewAs)}</button></form>`;
  return `
<article class="ws${w.disabled_at ? ' disabled' : ''}">
<header><h3>${esc(w.name)}<span class="slug ltr">${esc(w.slug)}</span></h3><span class="tag">${esc(w.disabled_at ? T.statusDisabled : T.statusActive)}</span></header>
<p class="section-l">${esc(T.colProducts)}</p>
<ul class="toggles">${products}</ul>
<p class="section-l">${esc(T.colMembers)}</p>
<ul class="people">${people.length ? people.join('') : `<li class="muted">${esc(T.noMembers)}</li>`}</ul>
<div class="actions">
<form method="post" action="${base}/invite" class="inline">${csrfField(csrf)}<input name="email" type="email" dir="ltr" required placeholder="${esc(T.inviteEmailPlaceholder)}" aria-label="${esc(T.adminEmail)}">${roleSelect('role')}<button class="quiet">${esc(T.inviteMore)}</button></form>
${viewAs}
<span class="end">${w.disabled_at ? button(`${base}/enable`, T.enableWs, csrf, { kind: 'quiet' }) : button(`${base}/disable`, T.disableWs, csrf, { kind: 'danger' })}</span>
</div>
</article>`;
}

function auditLabel(a) {
  let detail = null;
  try {
    detail = a.detail_json ? JSON.parse(a.detail_json) : null;
  } catch {
    /* an unreadable detail shows the plain name */
  }
  const name = AUDIT_NAMES[a.action] || a.action;
  return detail?.product && PRODUCT_NAMES[detail.product] ? `${name}: ${PRODUCT_NAMES[detail.product]}` : name;
}

export function adminPage({ csrf, workspaces, audit, form = {}, error = '', flash = '' }) {
  const checked = (p) => ((form.products ? form.products.includes(p) : p === 'teder') ? ' checked' : '');
  return `
<header class="top"><div class="brand">${ofMark()}<h1>${esc(T.adminTitle)}</h1></div>${button('/logout', T.adminSignOut, csrf, { kind: 'quiet' })}</header>
${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
<section class="card">
<h2>${esc(T.newWorkspace)}</h2>
<form method="post" action="/admin/workspaces" class="grid">
${csrfField(csrf)}
<label>${esc(T.wsName)}<input name="name" required maxlength="80" value="${esc(form.name)}"></label>
<label>${esc(T.wsSlug)}<input name="slug" required maxlength="40" dir="ltr" pattern="[a-z0-9][a-z0-9-]*" value="${esc(form.slug)}" aria-describedby="slug-hint"><small id="slug-hint">${esc(T.wsSlugHint)} <span class="ltr nowrap">dana-shop</span></small></label>
<label class="full">${esc(T.wsOwner)}<input name="owner" type="email" required dir="ltr" placeholder="name@example.com" value="${esc(form.owner)}"></label>
<fieldset><legend>${esc(T.wsProducts)}</legend>${Object.entries(PRODUCT_NAMES)
    .map(([p, name]) => `<label class="check"><input type="checkbox" name="products" value="${p}"${checked(p)}> ${esc(name)}</label>`)
    .join('')}</fieldset>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<button class="primary">${esc(T.wsCreate)}</button>
</form>
</section>
<div class="list-h"><h2>${esc(T.workspacesTitle)}</h2><p class="muted">${esc(T.workspacesCount(workspaces.length))}</p></div>
${workspaces.length ? workspaces.map((w) => workspaceTile(w, csrf)).join('') : `<p class="muted">${esc(T.noWorkspaces)}</p>`}
<section class="card">
<h2>${esc(T.auditTitle)}</h2>
<table class="audit"><tbody>${audit
    .map((a) => `<tr><td>${esc(auditLabel(a))}</td><td class="ltr">${esc(a.actor)}</td><td>${esc(a.workspace_name || '')}</td><td class="when">${esc(when(a.at))}</td></tr>`)
    .join('')}</tbody></table>
</section>`;
}

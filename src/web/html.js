import { PRODUCT_NAMES, ROLE_NAMES, T, when } from './copy.js';

// Server-rendered pages: Hebrew, right to left, one stylesheet, no script.
// Everything shown is escaped here; nothing reaches the page raw.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

/** A one-button form. */
export const button = (action, label, csrf, { fields = {}, kind = 'primary' } = {}) =>
  `<form method="post" action="${esc(action)}" class="inline">${csrfField(csrf)}${Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')}<button class="${kind}">${esc(label)}</button></form>`;

export function layout({ title, body, banner = '', flash = '', wide = false, v = '' }) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} · ${esc(T.brand)}</title>
<link rel="stylesheet" href="/static/site.css?v=${esc(v)}">
</head>
<body>
${banner}
<main class="${wide ? 'wide' : 'narrow'}">
<p class="brand">${esc(T.brand)}</p>
${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
${body}
</main>
</body>
</html>`;
}

export const viewAsBanner = (workspaceName, csrf) =>
  `<div class="banner" role="status"><span>${esc(T.viewAsBanner(workspaceName))}</span>${button('/admin/view-as/stop', T.viewAsStop, csrf, { kind: 'quiet' })}</div>`;

// ---- customer pages

export const loginPage = ({ csrf, next = '', email = '', error = '', notice = '' }) => `
<section class="card">
<h1>${esc(T.loginHeading)}</h1>
${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
<p>${esc(T.loginLead)}</p>
<form method="post" action="/login">
${csrfField(csrf)}
<input type="hidden" name="next" value="${esc(next)}">
<label for="email">${esc(T.emailLabel)}</label>
<input id="email" name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" required maxlength="254" value="${esc(email)}"${error ? ' aria-invalid="true" aria-describedby="err"' : ''} autofocus>
${error ? `<p class="error" id="err" role="alert">${esc(error)}</p>` : ''}
<button class="primary">${esc(T.loginButton)}</button>
</form>
<p class="muted">${esc(T.loginNoAccount)}</p>
</section>`;

export const sentPage = ({ email, next = '' }) => `
<section class="card">
<h1>${esc(T.sentTitle)}</h1>
<p>${esc(T.sentLead(email))}</p>
<p class="muted">${esc(T.sentSpam)}</p>
<p><a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">${esc(T.sentAgain)}</a></p>
</section>`;

export const confirmLinkPage = ({ csrf, token, email }) => `
<section class="card">
<h1>${esc(T.linkTitle)}</h1>
<p>${esc(T.linkLead(email))}</p>
<form method="post" action="/auth/link">${csrfField(csrf)}<input type="hidden" name="t" value="${esc(token)}"><button class="primary">${esc(T.linkButton)}</button></form>
</section>`;

export const deadPage = ({ title, lead, href = '/login', label = T.sentAgain }) => `
<section class="card">
<h1>${esc(title)}</h1>
<p>${esc(lead)}</p>
<p><a class="button" href="${esc(href)}">${esc(label)}</a></p>
</section>`;

export const invitePage = ({ csrf, token, email, workspace }) => `
<section class="card">
<h1>${esc(T.inviteTitle(workspace.name))}</h1>
<p>${esc(T.inviteLead(email))}</p>
<form method="post" action="/invite">
${csrfField(csrf)}
<input type="hidden" name="t" value="${esc(token)}">
<label for="name">${esc(T.inviteNameLabel)}</label>
<input id="name" name="name" autocomplete="name" maxlength="80">
<button class="primary">${esc(T.inviteButton)}</button>
</form>
</section>`;

export function homePage({ csrf, user, workspace, products, productUrls, canSwitch }) {
  const links = products.length
    ? `<ul class="products">${products.map((p) => `<li><a class="button" href="${esc(productUrls[p])}">${esc(T.homeOpen(PRODUCT_NAMES[p]))}</a></li>`).join('')}</ul>`
    : `<p class="muted">${esc(T.homeNoProducts)}</p>`;
  return `
<section class="card">
<h1>${esc(T.homeHello(user.name || user.email))}</h1>
<p>${esc(T.homeWho(user.email, workspace.name))}</p>
${links}
<p class="row">${canSwitch ? `<a href="/workspace">${esc(T.homeSwitch)}</a>` : ''}<a href="/logout">${esc(T.homeSignOut)}</a></p>
</section>`;
}

export const messagePage = ({ title, lead, links = [] }) => `
<section class="card">
<h1>${esc(title)}</h1>
<p>${esc(lead)}</p>
${links.length ? `<p class="row">${links.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('')}</p>` : ''}
</section>`;

export const pickPage = ({ csrf, workspaces, next = '' }) => `
<section class="card">
<h1>${esc(T.pickTitle)}</h1>
<p>${esc(T.pickLead)}</p>
<ul class="pick">${workspaces
  .map((w) => `<li>${button('/workspace', w.name, csrf, { fields: { workspace: w.id, next }, kind: 'choice' })}<span class="muted">${esc(ROLE_NAMES[w.role])}</span></li>`)
  .join('')}</ul>
</section>`;

export const logoutPage = ({ csrf, email }) => `
<section class="card">
<h1>${esc(T.logoutTitle)}</h1>
<p>${esc(T.logoutLead(email))}</p>
<div class="row">${button('/logout', T.logoutHere, csrf)}${button('/logout-all', T.logoutAll, csrf, { kind: 'danger' })}</div>
</section>`;

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
<p class="muted" id="code-hint">${esc(T.adminCodeHint)}</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<button class="primary">${esc(T.adminLoginButton)}</button>
</form>
</section>`;

const roleSelect = (name) =>
  `<select name="${name}" aria-label="${esc(T.inviteRole)}">${['client_member', 'client_owner'].map((r) => `<option value="${r}">${esc(ROLE_NAMES[r])}</option>`).join('')}</select>`;

function workspaceRow(w, csrf) {
  const base = `/admin/workspaces/${w.id}`;
  const products = Object.entries(w.products)
    .map(([p, on]) => `<li class="${on ? 'on' : 'off'}">${esc(PRODUCT_NAMES[p])} ${button(`${base}/products`, on ? T.turnOff(PRODUCT_NAMES[p]) : T.turnOn(PRODUCT_NAMES[p]), csrf, { fields: { product: p, enabled: on ? '0' : '1' }, kind: 'quiet' })}</li>`)
    .join('');
  const members = w.members.length
    ? w.members.map((m) => `<li><span dir="ltr">${esc(m.email)}</span> · ${esc(ROLE_NAMES[m.role])} · <span class="muted">${esc(m.last_login_at ? T.lastLogin(when(m.last_login_at)) : T.neverLoggedIn)}</span></li>`).join('')
    : `<li class="muted">${esc(T.noMembers)}</li>`;
  const invites = w.invites
    .map((i) => `<li class="muted">${esc(T.pendingInvite(i.email, when(i.expires_at)))} ${button(`/admin/invites/${i.id}/revoke`, T.revokeInvite, csrf, { kind: 'quiet' })}</li>`)
    .join('');
  const enabledProducts = Object.entries(w.products).filter(([, on]) => on).map(([p]) => p);
  const viewAs = `<form method="post" action="${base}/view-as" class="inline"><input type="hidden" name="_csrf" value="${esc(csrf)}">${
    enabledProducts.length
      ? `<select name="product" aria-label="${esc(T.viewIn)}">${enabledProducts.map((p) => `<option value="${p}">${esc(PRODUCT_NAMES[p])}</option>`).join('')}</select>`
      : ''
  }<button class="quiet">${esc(T.viewAs)}</button></form>`;
  return `
<article class="ws${w.disabled_at ? ' disabled' : ''}">
<header><h3>${esc(w.name)} <span class="muted" dir="ltr">${esc(w.slug)}</span></h3><span class="tag">${esc(w.disabled_at ? T.statusDisabled : T.statusActive)}</span></header>
<ul class="toggles">${products}</ul>
<ul class="people">${members}${invites}</ul>
<div class="row">
<form method="post" action="${base}/invite" class="inline">${csrfField(csrf)}<input name="email" type="email" dir="ltr" required placeholder="${esc(T.adminEmail)}" aria-label="${esc(T.adminEmail)}">${roleSelect('role')}<button class="quiet">${esc(T.inviteMore)}</button></form>
${viewAs}
${w.disabled_at ? button(`${base}/enable`, T.enableWs, csrf, { kind: 'quiet' }) : button(`${base}/disable`, T.disableWs, csrf, { kind: 'danger' })}
</div>
</article>`;
}

export function adminPage({ csrf, workspaces, audit, form = {}, error = '' }) {
  const checked = (p) => (form.products ? form.products.includes(p) : p === 'teder') ? ' checked' : '';
  return `
<header class="top"><h1>${esc(T.adminTitle)}</h1>${button('/logout', T.adminSignOut, csrf, { kind: 'quiet' })}</header>
<section class="card">
<h2>${esc(T.newWorkspace)}</h2>
<form method="post" action="/admin/workspaces" class="grid">
${csrfField(csrf)}
<label>${esc(T.wsName)}<input name="name" required maxlength="80" value="${esc(form.name)}"></label>
<label>${esc(T.wsSlug)}<input name="slug" required maxlength="40" dir="ltr" pattern="[a-z0-9][a-z0-9-]*" value="${esc(form.slug)}" aria-describedby="slug-hint"><small id="slug-hint" class="muted">${esc(T.wsSlugHint)}</small></label>
<label class="full">${esc(T.wsOwner)}<input name="owner" type="email" required dir="ltr" value="${esc(form.owner)}"></label>
<fieldset><legend>${esc(T.wsProducts)}</legend>${Object.entries(PRODUCT_NAMES)
    .map(([p, name]) => `<label class="check"><input type="checkbox" name="products" value="${p}"${checked(p)}> ${esc(name)}</label>`)
    .join('')}</fieldset>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<button class="primary">${esc(T.wsCreate)}</button>
</form>
</section>
<section>
${workspaces.length ? workspaces.map((w) => workspaceRow(w, csrf)).join('') : `<p class="muted">${esc(T.noWorkspaces)}</p>`}
</section>
<section class="card">
<h2>${esc(T.auditTitle)}</h2>
<table class="audit"><tbody>${audit
    .map((a) => `<tr><td class="muted">${esc(when(a.at))}</td><td dir="ltr">${esc(a.actor)}</td><td dir="ltr">${esc(a.action)}</td><td>${esc(a.workspace_name || '')}</td></tr>`)
    .join('')}</tbody></table>
</section>`;
}

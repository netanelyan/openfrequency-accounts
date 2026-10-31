import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/paths.js';
import { addDays, addMonths, describe, israelToday, LIST_PRICES, PLANS, plansOf } from '../accounts/subscriptions.js';
import { total } from '../accounts/invoices.js';
import { KINDS } from '../accounts/notify.js';
import { AUDIT_NAMES, CANCEL, ERASE, NOTIFY, OPS, PLAN_NAMES, PRODUCT_NAMES, ROLE_NAMES, SETUP, SIGNUP, T, dayHe, hourHe, ils, opensAfter, phoneHe, planGives, when } from './copy.js';
import { PRIVACY_URL, TERMS_URL } from '../accounts/signup.js';

// Server-rendered pages: Hebrew, right to left, one stylesheet. No script, except
// the operator's dashboard on /admin (dashboard.js), which loads static/admin.js
// to copy a message and to post its buttons in the background; every one of them
// works without it. Everything shown is escaped here; nothing reaches the page
// raw. The look is Teder's (see the head of static/site.css).

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

/** A one-button form. */
export const button = (action, label, csrf, { fields = {}, kind = 'primary', label: aria = '' } = {}) =>
  `<form method="post" action="${esc(action)}" class="inline">${csrfField(csrf)}${Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')}<button class="${kind}"${aria ? ` aria-label="${esc(aria)}"` : ''}>${esc(label)}</button></form>`;

// ---- the marks: the brand files' glyphs on their own colour, never redrawn (assets/brand)

const glyph = (name) => readFileSync(path.join(ROOT, 'assets', 'brand', 'svg', `${name}.svg`), 'utf8').replace(/^\s*<svg[^>]*>|<\/svg>\s*$/g, '');
const GLYPHS = { of: glyph('openfrequency-glyph'), ofSmall: glyph('openfrequency-glyph-small'), teder: glyph('teder-glyph'), toran: glyph('toran-glyph') };
const tile = (cls, inner) => `<span class="mark ${cls}" aria-hidden="true"><svg viewBox="0 0 100 100">${inner}</svg></span>`;
/** The company's halftone. The full one from 48px up; the simpler one below, where small dots vanish. */
export const ofMark = (large = false) => tile('of', large ? GLYPHS.of : GLYPHS.ofSmall);
export const productMark = (p) => tile(p, GLYPHS[p]);

/** The accessibility statement (openfrequency.co.il), linked from the foot of every page here, as IS 5568 asks. */
export const ACCESSIBILITY_URL = 'https://openfrequency.co.il/accessibility';

/** A product's label with its plan when it has one: "תדר, החבילה הקטנה". */
export const productLabel = (p, plan) => (plan && PLAN_NAMES[plan] ? `${PRODUCT_NAMES[p]}, ${PLAN_NAMES[plan]}` : PRODUCT_NAMES[p]);

/** A plan in one line: its name and what a month gives. */
const planLine = (p, plan) => (plan && PLANS[p]?.[plan] ? T.subPlan(PLAN_NAMES[plan], planGives(PLANS[p][plan].slideshows, PLANS[p][plan].redos)) : '');

export function layout({ title, body, banner = '', flash = '', wide = false, v = '', script = false }) {
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
<link rel="icon" href="/static/icon.svg?v=${esc(v)}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/icon-180.png?v=${esc(v)}">
<script src="/static/load.js?v=${esc(v)}" defer></script>
${script ? `<script src="/static/admin.js?v=${esc(v)}" defer></script>
` : ''}</head>
<body>
${banner}
<main class="${wide ? 'wide' : 'narrow'}">
${hero}
${flash && !wide ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
${body}
</main>
<footer class="site-foot"><a href="${esc(ACCESSIBILITY_URL)}">${esc(T.accessibility)}</a></footer>
</body>
</html>`;
}

export const viewAsBanner = (workspaceName, csrf) =>
  `<div class="banner" role="status"><span>${esc(T.viewAsBanner(workspaceName))}</span>${button('/admin/view-as/stop', T.viewAsStop, csrf, { kind: 'quiet' })}</div>`;

/** Small grey links under a card: [href, label] pairs. */
const links = (pairs) => (pairs.length ? `<p class="links">${pairs.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('')}</p>` : '');

// ---- customer pages

// Google's "G", in its four colours, as Google's sign-in branding asks for it beside the words.
const GOOGLE_G = `<svg class="g" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

/** The Google button and the line under it that leads to the other way in. */
const googleDoor = (href, label, or, hint = '') => `
<p class="google"><a class="button google" href="${esc(href)}">${GOOGLE_G}<span>${esc(label)}</span></a></p>
${hint ? `<p class="muted center">${esc(hint)}</p>` : ''}
<p class="or" role="separator"><span>${esc(or)}</span></p>`;

export const loginPage = ({ csrf, next = '', email = '', error = '', notice = '', google = false, signup = false }) => `
<section class="card">
<h1>${esc(T.loginHeading)}</h1>
${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
${google ? googleDoor(`/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`, T.googleButton, T.googleOrEmail) : ''}
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
${signup ? `<p class="muted center">${esc(T.loginNoAccountOpen)} <a href="/signup">${esc(T.loginSignup)}</a></p>` : `<p class="muted center">${esc(T.loginNoAccount)}</p>`}`;

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

export const invitePage = ({ csrf, token, email, workspace, google = false }) => `
<section class="card">
<h1>${esc(T.inviteTitle(workspace.name))}</h1>
<p class="lead">${esc(T.inviteLead(email))}</p>
${google ? googleDoor(`/auth/google?invite=${encodeURIComponent(token)}`, T.googleJoinButton, T.googleOrInvite, T.googleInviteHint(email)) : ''}
<form method="post" action="/invite">
${csrfField(csrf)}
<input type="hidden" name="t" value="${esc(token)}">
<label for="name">${esc(T.inviteNameLabel)}</label>
<input id="name" name="name" autocomplete="name" maxlength="80">
<button class="primary">${esc(T.inviteButton)}</button>
</form>
</section>`;

/**
 * How far through the month already paid for: the days left and today's place in it above a <progress> (its role is
 * progressbar, with the numbers and their words for a screen reader), filling from the right as the page reads.
 */
function paidBar(s, { saysLeft = true } = {}) {
  const b = s.bar;
  const left = b.days - b.day + 1;
  return `<div class="meter">
<p class="left">${saysLeft ? `<span>${esc(T.subLeft(left))}</span>` : ''}<span class="muted">${esc(T.subDay(b.day, b.days))}</span></p>
<progress max="${b.days}" value="${b.day}" aria-label="${esc(T.subBarLabel(dayHe(b.from), dayHe(b.to)))}" aria-valuetext="${esc(`${T.subDay(b.day, b.days)}. ${T.subLeft(left)}`)}"></progress>
</div>`;
}

/**
 * One product's subscription, as its customer sees it: the plan and its price, how far through the month paid for,
 * the next payment (only with OF_PAYMENT=provider, when they pay it on the payment page; in manual mode the payments
 * are arranged with us, by email), and
 * the status in plain words (src/accounts/subscriptions.js describe(), and the paywall's access, entitlement.js).
 * While the paywall keeps it closed, its button leads to the payment instead of into the product. Its owner cancels
 * it here (a confirmation page first) and takes a cancellation back before its last day.
 */
function subCard(p, s, href, { access = null, csrf = '', owner = false, providerReady = false } = {}) {
  const name = PRODUCT_NAMES[p];
  const comp = access?.access === 'comp';
  const cancelled = !comp && access?.cancelled && s?.status !== 'ended';
  const status = comp ? 'comp' : cancelled ? 'cancelled' : s?.status || 'open';
  const vat = s?.vat === 'included' ? T.vatIncluded : s?.vat === 'excluded' ? T.vatExcluded : '';
  const lines = [];
  if (status === 'comp') {
    lines.push(`<p class="muted">${esc(T.subComp)}</p>`);
  } else if (status === 'active') {
    lines.push(paidBar(s));
    if (s.next && providerReady) lines.push(`<p>${esc(T.subNext(dayHe(s.next.on), ils(s.next.monthly), s.next.vat === 'excluded'))}</p>`);
    lines.push(`<p class="muted">${esc(T.subPaidUntil(dayHe(s.paid_until)))}</p>`);
  } else if (status === 'due') {
    lines.push(`<p class="warn">${esc(access && !access.allowed ? T.subDueStopped(dayHe(s.next.on)) : T.subDue(dayHe(s.next.on), dayHe(s.graceUntil)))}</p>`);
  } else if (status === 'cancelled') {
    lines.push(`<p class="warn">${esc(access.allowed ? T.subCancelled(dayHe(s.ends_on)) : T.subCancelledNow)}</p>`);
    if (s.bar) lines.push(paidBar(s, { saysLeft: false }));
  } else if (status === 'ending') {
    // The days left are said once, in the warning; the bar shows where in the last month paid for today is.
    lines.push(`<p class="warn">${esc(T.subEnding(dayHe(s.ends_on), s.left))}</p>`);
    if (s.bar) lines.push(paidBar(s, { saysLeft: false }));
  } else if (status === 'ended') {
    lines.push(`<p class="muted">${esc(T.subEnded(dayHe(s.ends_on)))}</p>`);
  } else {
    lines.push(`<p class="muted">${esc(T.subOpen(name))}</p>`);
  }
  if (status === 'open' && s?.setup) lines.push(`<p class="muted">${esc(T.subSetup(ils(s.setup)))}</p>`);
  if (s?.started_on) lines.push(`<p class="muted">${esc(T.subSince(dayHe(s.started_on)))}</p>`);
  const locked = access && !access.allowed;
  const go =
    status === 'ended' || (status === 'cancelled' && locked)
      ? ''
      : locked
        ? `<a class="button primary" href="/setup#setup-billing">${esc(T.subPay)}</a>`
        : `<a class="button primary" href="${esc(href)}">${esc(T.homeOpen(name))}</a>${status === 'due' ? `<a class="button quiet" href="/setup#setup-billing">${esc(T.subPay)}</a>` : ''}`;
  let change = '';
  if (owner && status === 'cancelled' && s?.ends_on && s.ends_on >= israelToday())
    change = button(`/subscription/${p}/resume`, T.subResume, csrf, { kind: 'quiet', label: T.subResumeLabel(name) });
  else if (owner && ['active', 'open', 'due'].includes(status))
    change = `<a class="button quiet" href="/subscription/${esc(p)}/cancel" aria-label="${esc(T.subCancelLabel(name))}">${esc(T.subCancel)}</a>`;
  return `<article class="card sub s-${status}">
<header>${productMark(p)}<h3>${esc(name)}</h3><span class="tag">${esc(T.subStatus[status])}</span></header>
${s?.monthly != null && !comp ? `<p class="price">${esc(T.subPrice(ils(s.monthly), vat))}</p>` : ''}
${s?.plan ? `<p class="muted">${esc(planLine(p, s.plan))}</p>` : ''}
${lines.join('\n')}
${go || change ? `<p class="go">${go}${change}</p>` : ''}
</article>`;
}

/**
 * Every invoice of the workspace, newest first: its date, the product and its number, the days it pays for, the
 * total with the VAT in it stated, and the PDF. The link goes through /invoices/<id>, which checks the workspace.
 */
function invoicesCard(invoices) {
  const rows = invoices
    .map(
      (i) => `<li><span class="when">${esc(dayHe(i.issued_on))}</span><span class="what"><b>${esc(T.invTitle(PRODUCT_NAMES[i.product], i.number))}</b>${
        i.period_from ? `<small>${esc(T.invPeriod(dayHe(i.period_from), dayHe(i.period_to)))}</small>` : ''
      }</span><span class="sum"><b>${esc(ils(total(i)))}</b><small>${esc(i.vat ? T.invVat(ils(i.amount), ils(i.vat)) : T.invNoVat)}</small></span><a class="button quiet" href="/invoices/${esc(i.id)}" aria-label="${esc(T.invOpenLabel(i.number))}">${esc(T.invOpen)}</a></li>`
    )
    .join('');
  return `<section class="card invoices" id="invoices"><h2>${esc(T.dashInvoices)}</h2>${rows ? `<ul class="invoices">${rows}</ul>` : `<p class="muted">${esc(T.invNone)}</p>`}</section>`;
}

/**
 * Who is in the account: its people and the invites still waiting, with how many of the workspace's places they take.
 * Its owner invites someone by email, cancels an invite and removes anyone but themselves; once every place is taken
 * the form gives way to a line about talking to us. A member sees the same list and nothing to press; so does a
 * read-only view.
 */
function teamCard({ csrf, user, team, role, readOnly = false, support = null, error = '', form = {} }) {
  const owner = role === 'client_owner' && !readOnly;
  const people = team.members.map((m) => {
    const who = m.name || m.email;
    const remove = owner && m.id !== user.id ? button(`/team/members/${m.id}/remove`, T.teamRemove, csrf, { kind: 'danger', label: T.teamRemoveLabel(who) }) : '';
    return `<li><span class="who"><bdi>${esc(who)}</bdi>${m.id === user.id ? ` <span class="muted">${esc(T.dashYou)}</span>` : ''}${m.name ? `<small class="ltr">${esc(m.email)}</small>` : ''}</span><span class="muted end">${esc(ROLE_NAMES[m.role])}</span>${remove}</li>`;
  });
  const waiting = team.invites.map(
    (i) =>
      `<li class="waiting"><span class="who"><bdi class="ltr">${esc(i.email)}</bdi><small>${esc(T.teamWaiting(when(i.expires_at)))}</small></span><span class="muted end">${esc(ROLE_NAMES[i.role])}</span>${
        owner ? button(`/team/invites/${i.id}/cancel`, T.teamCancel, csrf, { kind: 'quiet', label: T.teamCancelLabel(i.email) }) : ''
      }</li>`
  );
  const sel = (r) => ((form.role || 'client_member') === r ? ' selected' : '');
  let add = '';
  if (!owner) add = `<p class="muted">${esc(T.teamOwnersOnly)}</p>`;
  else if (team.full)
    add = support
      ? `<div class="team-full" role="note"><p>${esc(T.teamFull(team.limit))}</p><p><a class="button primary" href="${esc(support)}">${esc(T.supportWrite)}</a></p></div>`
      : `<div class="team-full" role="note"><p>${esc(T.teamFullReply(team.limit))}</p></div>`;
  else
    add = `<form method="post" action="/team/invite" class="team-add">${csrfField(csrf)}
<label for="team-email">${esc(T.teamEmail)}</label>
<div class="fields"><input id="team-email" name="email" type="email" inputmode="email" autocomplete="off" dir="ltr" required maxlength="254" placeholder="name@example.com" value="${esc(form.email || '')}" aria-describedby="team-room${error ? ' team-err' : ''}"${error ? ' aria-invalid="true"' : ''}>
<select name="role" aria-label="${esc(T.teamRole)}"><option value="client_member"${sel('client_member')}>${esc(ROLE_NAMES.client_member)}</option><option value="client_owner"${sel('client_owner')}>${esc(ROLE_NAMES.client_owner)}</option></select>
<button class="primary">${esc(T.teamInvite)}</button></div>
<small id="team-room">${esc(T.teamRoom(team.limit - team.taken, team.limit))}</small>
</form>`;
  return `<section class="card team" id="team"><div class="card-h"><h2>${esc(T.dashTeam)}</h2><span class="muted">${esc(T.teamCount(team.taken, team.limit))}</span></div>
<ul class="people">${[...people, ...waiting].join('')}</ul>
${error ? `<p class="error" id="team-err" role="alert">${esc(error)}</p>` : ''}
${add}
</section>`;
}

/**
 * WhatsApp on the home page (docs/internal-owner-phone.md): the numbers linked (a member's own; the owner's, every
 * one in the workspace), the open link code with its wa.me button, and the form for a new one. A number's own person
 * turns its updates on or off; its own person or the owner removes it. Nothing to press when read-only.
 */
function whatsappCard({ csrf, phones = [], code = null, waNumber = null, readOnly = false }) {
  const items = phones
    .map((n) => {
      const shown = phoneHe(n.phone);
      const actions = readOnly
        ? ''
        : `<span class="end">${n.mine ? button('/whatsapp/updates', n.updates ? T.waTurnOff : T.waTurnOn, csrf, { fields: { phone: n.phone, on: n.updates ? '0' : '1' }, kind: 'quiet' }) : ''}${button('/whatsapp/remove', T.waRemove, csrf, { fields: { phone: n.phone }, kind: 'danger' })}</span>`;
      return `<li><span class="who ltr">${esc(shown)}</span>${n.mine ? '' : `<span class="muted"><bdi>${esc(T.waOf(n.name || n.email))}</bdi></span>`}<span class="tag${n.updates ? '' : ' off'}">${esc(n.updates ? T.waOn : T.waOff)}</span>${actions}</li>`;
    })
    .join('');
  const open = code
    ? `<div class="wa-code" role="status">
<p class="section-l">${esc(T.waCodeTitle)}</p>
<p class="code ltr">${esc(code.code)}</p>
<p>${esc(T.waCodeLead(hourHe(code.expires_at)))}</p>
<p class="muted">${esc(T.waCodeUpdates(Boolean(code.opt_in)))}</p>
${waNumber ? `<p><a class="button primary" href="${esc(`https://wa.me/${waNumber}?text=${encodeURIComponent(code.code)}`)}">${esc(T.waSend)}</a></p>` : `<p class="warn">${esc(T.waNoNumber)}</p>`}
</div>`
    : '';
  const form = readOnly
    ? ''
    : `<form method="post" action="/whatsapp/link" class="wa-form">${csrfField(csrf)}
<label class="check"><input type="checkbox" name="updates" value="1" aria-describedby="wa-hint"> ${esc(T.waOptIn)}</label>
<small id="wa-hint">${esc(T.waOptInHint)}</small>
<button class="${code ? 'quiet' : 'primary'}">${esc(code ? T.waAgain : T.waConnect)}</button>
</form>`;
  return `<section class="card wa" id="whatsapp">
<h2>${esc(T.waTitle)}</h2>
<p class="lead">${esc(T.waLead)}</p>
<ul class="people phones">${items || `<li class="muted">${esc(T.waNone)}</li>`}</ul>
${open}
${form}
</section>`;
}

/**
 * The customer's home: each product they have with its subscription (the price, the days left in the month paid
 * for, the next charge), the other products, the invoices, their WhatsApp, who is in the account, and their own details.
 * `setup` (null once setup is finished): a card that leads to /setup while a product says a step is left, and a
 * "הגדרה" link in the header instead while a product has not answered.
 */
export function homePage({ csrf, user, workspace, products, productUrls, canSwitch, subscriptions = {}, access = {}, providerReady = false, others = [], invoices = null, team, role, readOnly = false, support = null, supportTeam = null, flash = '', teamError = '', teamForm = {}, whatsapp = {}, setup = null }) {
  const owner = role === 'client_owner' && !readOnly;
  const subs = products.length
    ? `<div class="subs">${products.map((p) => subCard(p, subscriptions[p], productUrls[p], { access: access[p], csrf, owner, providerReady })).join('')}</div>`
    : `<section class="card"><p class="muted">${esc(T.homeNoProducts)}</p></section>`;
  const more = others.length
    ? `<div class="list-h"><h2>${esc(T.dashMore)}</h2></div>
<ul class="more">${others
        .map((p) => `<li><a href="https://openfrequency.co.il/${esc(p)}">${productMark(p)}<span><b>${esc(PRODUCT_NAMES[p])}</b><small>${esc(T.dashMoreWhat[p])}</small></span><span class="go">${esc(T.dashMoreLink)}</span></a></li>`)
        .join('')}</ul>`
    : '';
  return `
<header class="top"><div class="brand">${ofMark()}<h1>${esc(T.homeHello(user.name || user.email))}</h1></div><nav class="top-links" aria-label="${esc(SETUP.navLabel)}">${setup && !setup.incomplete ? `<a class="button quiet" href="/setup">${esc(SETUP.nav)}</a>` : ''}<a class="button quiet" href="/logout">${esc(T.homeSignOut)}</a></nav></header>
${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
<p class="lead dash-who">${esc(T.homeWho(user.email, workspace.name))}</p>
${setup?.incomplete ? `<section class="card setup-card"><div><h2>${esc(SETUP.cardTitle)}</h2><p class="muted">${esc(SETUP.cardLead(setup.done, setup.total))}</p></div><a class="button primary" href="/setup">${esc(SETUP.cardButton)}</a></section>` : ''}
<div class="list-h"><h2>${esc(T.dashProducts)}</h2></div>
${subs}
${more}
${invoices ? invoicesCard(invoices) : ''}
${whatsappCard({ csrf, readOnly, ...whatsapp })}
<div class="pair">
${teamCard({ csrf, user, team: team || { members: [], invites: [], taken: 0, limit: 0, full: true }, role, readOnly, support: supportTeam || support, error: teamError, form: teamForm })}
<section class="card"><h2>${esc(T.dashAccount)}</h2>
<dl class="facts"><div><dt>${esc(T.dashEmail)}</dt><dd class="ltr">${esc(user.email)}</dd></div><div><dt>${esc(T.dashBusiness)}</dt><dd>${esc(workspace.name)}</dd></div></dl>
<p class="row">${canSwitch ? `<a class="button" href="/workspace">${esc(T.homeSwitch)}</a>` : ''}<a class="button" href="/notifications">${esc(T.dashNotifications)}</a><a class="button" href="/logout">${esc(T.dashSignOutAll)}</a></p>
${owner ? `<p class="links"><a href="/account/delete">${esc(T.dashDelete)}</a></p>` : ''}
</section>
</div>
<p class="muted center">${support ? `${esc(T.dashHelpAsk)} <a href="${esc(support)}">${esc(T.supportWrite)}</a>` : esc(T.dashHelp)}</p>`;
}

// ---- public sign-up (src/accounts/signup.js)

/**
 * The sign-up form: name, business, products (each with its line), the terms, a honeypot, and the email; and, while
 * Google is set up, "continue with Google", a second submit button of the same form, so the choices go with it (kept
 * on our side, never in the URL). It skips the browser's checks, since Google brings the address; ours still run.
 * Under the products, how paying works in this payment mode (`payment`, OF_PAYMENT: manual or provider).
 */
export function signupPage({ csrf, form = {}, error = '', google = false, open = ['teder', 'toran'], payment = 'manual' }) {
  const chosen = [].concat(form.products || []);
  // A product sign-up does not offer yet (OF_SIGNUP_PRODUCTS): shown after the open ones, its box disabled and outside
  // the form's data, with a "בקרוב" tag and one line on why.
  // A product with plans (Teder) shows each plan, with what a month gives and its price, to choose under its box, once
  // the box is ticked (site.css; no product starts ticked).
  // ?plan=full or ?plan=small (the website's buttons) starts that one chosen; anything else, or none, the full one.
  const picked = Object.hasOwn(PLANS.teder, form.plan ?? '') ? form.plan : plansOf('teder')[0];
  const plans = (p) =>
    PLANS[p]
      ? `<fieldset class="plans-pick"><legend>${esc(SIGNUP.planLegend)}</legend>${plansOf(p)
          .map(
            (k) =>
              `<label class="plan-pick"><input type="radio" name="plan" value="${k}"${k === picked ? ' checked' : ''}><span><b>${esc(PLAN_NAMES[k])}</b><small>${esc(planGives(PLANS[p][k].slideshows, PLANS[p][k].redos))}</small><small class="price">${esc(SIGNUP.price(ils(PLANS[p][k].monthly), ils(PLANS[p][k].setup)))}</small></span></label>`
          )
          .join('')}<small>${esc(SIGNUP.planHint)}</small></fieldset>`
      : '';
  const product = (p) =>
    open.includes(p)
      ? `<label class="product-pick"><input type="checkbox" name="products" value="${p}"${chosen.includes(p) ? ' checked' : ''}>${productMark(p)}<span><b>${esc(PRODUCT_NAMES[p])}</b><small>${esc(SIGNUP.productWhat[p])}</small>${PLANS[p] ? '' : `<small class="price">${esc(SIGNUP.price(ils(LIST_PRICES[p].monthly), ils(LIST_PRICES[p].setup)))}</small>`}</span></label>${plans(p)}`
      : `<label class="product-pick soon"><input type="checkbox" disabled aria-describedby="su-soon-${p}">${productMark(p)}<span><b>${esc(PRODUCT_NAMES[p])}</b><small id="su-soon-${p}">${esc(SIGNUP.productSoon)}</small></span><span class="tag off">${esc(SIGNUP.soon)}</span></label>`;
  const order = ['toran', 'teder'].sort((a, b) => Number(!open.includes(a)) - Number(!open.includes(b)));
  return `
<section class="card signup">
<h1>${esc(SIGNUP.heading)}</h1>
<p class="lead">${esc(SIGNUP.lead)}</p>
<form method="post" action="/signup">
${csrfField(csrf)}
<label for="su-name">${esc(SIGNUP.nameLabel)}</label>
<input id="su-name" name="name" autocomplete="name" required minlength="2" maxlength="80" value="${esc(form.name || '')}">
<label for="su-business">${esc(SIGNUP.businessLabel)}</label>
<input id="su-business" name="business" autocomplete="organization" required minlength="2" maxlength="80" value="${esc(form.business || '')}" aria-describedby="su-business-hint">
<small id="su-business-hint">${esc(SIGNUP.businessHint)}</small>
<fieldset class="products-pick"><legend>${esc(SIGNUP.productsLegend)}</legend>
${order.map(product).join('\n')}
${open.length > 1 ? `<small>${esc(SIGNUP.productsHint)}</small>` : ''}
<small>${esc(SIGNUP.pricesNote(payment))}</small>
</fieldset>
<label class="check terms"><input type="checkbox" name="terms" value="1" required${form.terms ? ' checked' : ''}> <span>${esc(SIGNUP.termsPre)}<a href="${esc(TERMS_URL)}" target="_blank" rel="noopener">${esc(SIGNUP.termsLink)}</a>${esc(SIGNUP.termsMid)}<a href="${esc(PRIVACY_URL)}" target="_blank" rel="noopener">${esc(SIGNUP.privacyLink)}</a></span></label>
<div class="hp" aria-hidden="true"><label for="su-website">${esc(SIGNUP.honeypot)}</label><input id="su-website" name="website" tabindex="-1" autocomplete="off"></div>
<label for="su-email">${esc(SIGNUP.emailLabel)}</label>
<input id="su-email" name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" required maxlength="254" placeholder="name@example.com" value="${esc(form.email || '')}">
${error ? `<p class="error" id="su-err" role="alert">${esc(error)}</p>` : ''}
<button class="primary" name="via" value="email">${esc(SIGNUP.submit)}</button>
${google ? `<p class="or" role="separator"><span>${esc(SIGNUP.or)}</span></p>
<button class="google" name="via" value="google" formnovalidate>${GOOGLE_G}<span>${esc(SIGNUP.googleButton)}</span></button>
<p class="muted center">${esc(SIGNUP.googleHint)}</p>` : ''}
</form>
</section>
<p class="muted center">${esc(SIGNUP.haveAccount)} <a href="/login">${esc(SIGNUP.toLogin)}</a></p>`;
}

export const signupSentPage = ({ email }) => `
<section class="card">
<h1>${esc(SIGNUP.sentTitle)}</h1>
<p class="lead">${esc(SIGNUP.sentLead(email))}</p>
<p class="muted">${esc(SIGNUP.sentSpam)}</p>
</section>
${links([['/signup', SIGNUP.again]])}`;

/**
 * The page the email's link opens: what is about to be opened, how paying works next (`payment`, OF_PAYMENT), and the
 * button (mail scanners open links).
 */
export const signupConfirmPage = ({ csrf, token, row, payment = 'manual' }) => `
<section class="card">
<h1>${esc(SIGNUP.confirmTitle)}</h1>
<p class="lead">${esc(SIGNUP.confirmLead(row.business, row.email))}</p>
<p class="muted">${esc(SIGNUP.confirmProducts(row.products.map((p) => productLabel(p, p === 'teder' ? row.plan : null)).join(SIGNUP.and)))}</p>
<p class="muted">${esc(SIGNUP.confirmPay(payment, opensAfter(payment, row.products.map((p) => PRODUCT_NAMES[p]).join(SIGNUP.and), row.products.length > 1)))}</p>
<form method="post" action="/signup/confirm">${csrfField(csrf)}<input type="hidden" name="t" value="${esc(token)}"><button class="primary">${esc(SIGNUP.confirmButton)}</button></form>
</section>`;

// ---- the setup page (src/web/setup.js)

/**
 * One step: its status, its title and detail, and its button when it has a link and is not done (none in view-as).
 * The first step on the page that can be started is the one blue button. A step of a product the paywall keeps
 * closed is shown locked: no button, and "אחרי התשלום" unless it is done already.
 */
function stepRow(s, { readOnly, first, locked = false }) {
  if (locked && s.status !== 'done') {
    return `<li class="step st-locked"><span class="chip">${esc(SETUP.lockedChip)}</span><span class="what"><b>${esc(s.title)}</b>${s.detail ? `<small>${esc(s.detail)}</small>` : ''}</span></li>`;
  }
  const can = !locked && s.href && s.status !== 'done' && s.status !== 'soon' && !readOnly;
  const verb = s.status === 'todo' ? SETUP.start : SETUP.open;
  const btn = can ? `<a class="button ${first() ? 'primary' : 'quiet'}" href="${esc(s.href)}" aria-label="${esc(SETUP.actionLabel(verb, s.title))}">${esc(verb)}</a>` : '';
  return `<li class="step st-${esc(s.status)}"><span class="chip">${esc(SETUP.status[s.status])}</span><span class="what"><b>${esc(s.title)}</b>${s.detail ? `<small>${esc(s.detail)}</small>` : ''}</span>${btn}</li>`;
}

/**
 * The payment step, first: what is still to pay, product by product (the price recorded on the subscription: the
 * list price before VAT, and the setup fee until the first payment), or until when it is paid. How paying works
 * follows the payment mode (OF_PAYMENT): with a provider, "לתשלום" opens its payment page and the closed products open
 * once the payment is confirmed; in manual mode we email the payment details, the closed products open once the
 * payment reaches us, and the button (quiet: there is nothing to start here) is for questions, to us.
 */
function billingCard(b, { readOnly, first, products, access, prices, payHow = '' }) {
  const done = b.status === 'done';
  const closed = products.filter((p) => !access[p]?.allowed);
  const opens = closed.length ? opensAfter(b.checkout ? 'provider' : 'manual', closed.map((p) => PRODUCT_NAMES[p]).join(SIGNUP.and), closed.length > 1) : '';
  const detail = done ? (b.comp ? SETUP.billingComp : SETUP.billingDone) : b.checkout ? SETUP.billingTodo(opens) : SETUP.billingManual(opens, payHow);
  const wa = /^https:\/\/wa\.me\//.test(b.href || '');
  const label = b.checkout ? SETUP.billingPay : wa ? SETUP.billingWrite : SETUP.billingContact;
  const btn = !done && b.href && !readOnly ? `<a class="button ${b.checkout && first() ? 'primary' : 'quiet'}" href="${esc(b.href)}">${esc(label)}</a>` : '';
  const lines = products
    .map((p) => {
      const a = access[p];
      const s = prices[p] || {};
      if (a?.access === 'comp') return '';
      if (a?.access === 'due') return `<li>${esc(SETUP.billingDue(productLabel(p, s.plan), dayHe(a.graceUntil)))}</li>`;
      if (a?.allowed && a.paidUntil) return `<li>${esc(SETUP.billingPaidUntil(productLabel(p, s.plan), dayHe(a.paidUntil)))}</li>`;
      if (s.monthly == null) return '';
      const vat = s.vat === 'included' ? T.vatIncluded : T.vatExcluded;
      return `<li>${esc(SETUP.billingPrice(productLabel(p, s.plan), ils(s.monthly), vat, !s.paid_until && s.setup ? ils(s.setup) : ''))}</li>`;
    })
    .join('');
  return `<section class="card setup-p" id="setup-billing"><header><div><h2>${esc(SETUP.billingTitle)}</h2></div><span class="tag${done ? '' : ' off'}">${esc(done ? SETUP.ready : SETUP.notReady)}</span></header>
<ol class="steps"><li class="step st-${done ? 'done' : 'todo'}"><span class="chip">${esc(SETUP.status[done ? 'done' : 'todo'])}</span><span class="what"><b>${esc(SETUP.billingStep)}</b><small>${esc(detail)}</small></span>${btn}</li></ol>
${lines ? `<ul class="prices">${lines}</ul>` : ''}
${!done && payHow ? `<p>${esc(SETUP.billingHow(payHow))}</p>` : ''}
${!done && !b.checkout ? `<p class="muted">${esc(SETUP.billingAsk(wa))}</p>` : ''}
</section>`;
}

/**
 * The checklist (setupState() in src/web/setup.js): how far along, then payment, then a section for each product the
 * workspace has turned on, and nothing about one it has not. A product the paywall keeps closed shows its steps
 * locked, "נפתח אחרי התשלום".
 */
export function setupPage({ state, productUrls, readOnly = false, flash = '', access = {}, prices = {}, payHow = '' }) {
  let used = false;
  const first = () => (used ? false : (used = true));
  const steps = (list, locked) => `<ol class="steps">${list.map((s) => stepRow(s, { readOnly, first, locked })).join('')}</ol>`;
  const billing = state.billing ? billingCard(state.billing, { readOnly, first, products: state.sections.map((s) => s.product), access, prices, payHow }) : '';
  const sections = state.sections
    .map((sec) => {
      const p = sec.product;
      const tag = sec.locked ? `<span class="tag off">${esc(SETUP.locked)}</span>` : sec.ok ? `<span class="tag${sec.done ? '' : ' off'}">${esc(sec.done ? SETUP.ready : SETUP.notReady)}</span>` : '';
      const head = `<header>${productMark(p)}<div><h2>${esc(PRODUCT_NAMES[p])}</h2><small>${esc(SIGNUP.productWhat[p])}</small></div>${tag}</header>`;
      const lockedLead = sec.locked ? `<p class="muted">${esc(SETUP.lockedLead(PRODUCT_NAMES[p]))}</p>` : '';
      if (!sec.ok) {
        if (sec.locked) return `<section class="card setup-p locked" id="setup-${p}">${head}${lockedLead}</section>`;
        return `<section class="card setup-p" id="setup-${p}">${head}<p class="warn">${esc(SETUP.failed)}</p><p><a class="button quiet" href="${esc(productUrls[p])}">${esc(SETUP.failedLink(PRODUCT_NAMES[p]))}</a></p></section>`;
      }
      const body = (sec.required.length ? steps(sec.required, sec.locked) : '') + (sec.optional.length ? `<p class="section-l">${esc(SETUP.optional)}</p>${steps(sec.optional, sec.locked)}` : '');
      return `<section class="card setup-p${sec.locked ? ' locked' : ''}" id="setup-${p}">${head}${lockedLead}${body || `<p class="muted">${esc(SETUP.noSteps)}</p>`}</section>`;
    })
    .join('\n');
  return `
<header class="top"><div class="brand">${ofMark()}<h1>${esc(SETUP.heading)}</h1></div><a class="button quiet" href="/">${esc(SETUP.back)}</a></header>
${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
<section class="card setup-sum">
<p class="lead">${esc(state.sections.length ? SETUP.lead : SETUP.noProducts)}</p>
${state.total ? `<div class="meter"><p class="left"><span>${esc(SETUP.progress(state.done, state.total))}</span></p><progress max="${state.total}" value="${state.done}" aria-label="${esc(SETUP.progressLabel)}" aria-valuetext="${esc(SETUP.progress(state.done, state.total))}"></progress></div>` : ''}
${state.complete ? `<p class="notice" role="status">${esc(SETUP.allDone)}</p>` : ''}
${state.unknown ? `<p class="muted">${esc(SETUP.unknown)}</p>` : ''}
</section>
${billing}
${sections}`;
}

// ---- the account: cancelling a subscription, deleting the account, the product emails

/**
 * Before a subscription is cancelled: what happens (it works to the last day paid for, then stops, and nothing more is
 * charged; with nothing paid, it stops today), that it can be taken back until then, and that no data is deleted.
 */
export const cancelPage = ({ csrf, product, access, error = '' }) => {
  const name = PRODUCT_NAMES[product];
  const paid = access.access === 'paid';
  const until = dayHe(paid ? access.paidUntil : israelToday());
  return `
<section class="card">
<h1>${esc(CANCEL.heading(name))}</h1>
<p class="lead">${esc(paid ? CANCEL.leadPaid(name, until) : CANCEL.leadUnpaid(name))}</p>
<p>${esc(CANCEL.undo(until))}</p>
<p class="muted">${esc(CANCEL.keepsData)}</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<div class="row">${button(`/subscription/${product}/cancel`, CANCEL.confirm, csrf, { kind: 'danger' })}<a class="button quiet" href="/">${esc(CANCEL.back)}</a></div>
</section>`;
};

/**
 * Before a workspace is deleted: that it is permanent, what is deleted and what is kept (the invoices, by law, and the
 * audit log), and the business's name to type. The superadmin's console has its own form (workspaceTile).
 */
export const deletePage = ({ csrf, workspace, error = '', typed = '', canCancel = false }) => `
<section class="card erase">
<h1>${esc(ERASE.title)}</h1>
<p class="lead">${esc(ERASE.lead(workspace.name))}</p>
<h2>${esc(ERASE.goneTitle)}</h2>
<ul>${ERASE.gone.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<h2>${esc(ERASE.keptTitle)}</h2>
<p>${esc(ERASE.kept)}</p>
${canCancel ? `<p class="muted">${esc(ERASE.cancelInstead)}</p>` : ''}
<form method="post" action="/account/delete">
${csrfField(csrf)}
<label for="erase-name">${esc(ERASE.confirmLabel(workspace.name))}</label>
<input id="erase-name" name="name" required maxlength="200" autocomplete="off" value="${esc(typed)}"${error ? ' aria-invalid="true" aria-describedby="erase-err"' : ''}>
${error ? `<p class="error" id="erase-err" role="alert">${esc(error)}</p>` : ''}
<div class="row"><button class="danger">${esc(ERASE.button)}</button><a class="button quiet" href="/">${esc(ERASE.back)}</a></div>
</form>
</section>`;

/**
 * Which product emails this person gets in this workspace: a box for each kind of each product it has on, ticked as
 * they chose (an owner's all ticked, a member's none, until they save). Nothing to press when read-only.
 */
export const notificationsPage = ({ csrf, workspace, prefs, readOnly = false, flash = '' }) => {
  const products = Object.keys(prefs);
  const groups = products
    .map(
      (p) => `<fieldset class="notify"><legend>${productMark(p)}<b>${esc(PRODUCT_NAMES[p])}</b></legend>
${KINDS.map((k) => `<label class="check"><input type="checkbox" name="on" value="${p}:${k}"${prefs[p][k] ? ' checked' : ''}${readOnly ? ' disabled' : ''}> ${esc(NOTIFY.kinds[k])}</label>`).join('\n')}
</fieldset>`
    )
    .join('\n');
  return `
<header class="top"><div class="brand">${ofMark()}<h1>${esc(NOTIFY.title)}</h1></div><a class="button quiet" href="/">${esc(NOTIFY.back)}</a></header>
${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}
<section class="card">
<p class="lead">${esc(NOTIFY.lead)}</p>
<p class="muted">${esc(NOTIFY.defaults)}</p>
${
  products.length
    ? `<form method="post" action="/notifications">${csrfField(csrf)}<input type="hidden" name="workspace" value="${esc(workspace.id)}">
${groups}
${readOnly ? `<p class="muted">${esc(NOTIFY.readOnly)}</p>` : `<button class="primary">${esc(NOTIFY.save)}</button>`}
</form>`
    : `<p class="muted">${esc(NOTIFY.noProducts)}</p>`
}
</section>`;
};

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

export const adminLoginPage = ({ csrf, next = '', email = '', error = '' }) => `
<section class="card">
<h1>${esc(T.adminLoginTitle)}</h1>
<form method="post" action="/admin/login" autocomplete="on">
${csrfField(csrf)}
${next ? `<input type="hidden" name="next" value="${esc(next)}">
` : ''}<label for="email">${esc(T.adminEmail)}</label>
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

/**
 * The top of both /admin pages: the mark, the page's name, the tabs (today, the accounts, and Toran's operator pages,
 * which Toran renders under /admin/toran/) and sign-out.
 */
export const adminTop = ({ csrf, tab }) => {
  const a = (href, label, on) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return `<header class="top admin-top"><div class="brand">${ofMark()}<h1>${esc(tab === 'today' ? OPS.pageTitle : T.adminTitle)}</h1></div><nav class="tabs" aria-label="${esc(OPS.tabs)}">${a('/admin', OPS.tabToday, tab === 'today')}${a('/admin/accounts', OPS.tabAccounts, tab === 'accounts')}${a('/admin/toran/', OPS.tabToran, false)}</nav>${button('/logout', T.adminSignOut, csrf, { kind: 'quiet' })}</header>`;
};

const roleSelect = (name) =>
  `<select name="${name}" aria-label="${esc(T.inviteRole)}">${['client_member', 'client_owner'].map((r) => `<option value="${r}">${esc(ROLE_NAMES[r])}</option>`).join('')}</select>`;

/**
 * The operator records an invoice the invoicing service issued, next to the month's payment: its number and date,
 * the days it pays for (the last month paid for, to start with), the amount before VAT and the VAT, and the PDF.
 */
function invoiceForm(base, p, s, csrf) {
  const from = s.paid_until ? addMonths(addDays(s.paid_until, 1), -1) : '';
  return `<details class="inv-add"><summary>${esc(T.invAdd)}</summary>
<form method="post" action="${base}/invoices" enctype="multipart/form-data" class="sub-form">${csrfField(csrf)}<input type="hidden" name="product" value="${p}">
<small class="full">${esc(T.invHint)}</small>
<label>${esc(T.invNumber)}<input name="number" required maxlength="40" dir="ltr"></label>
<label>${esc(T.invIssuedOn)}<input name="issued_on" type="date" required value="${esc(israelToday())}"></label>
<label>${esc(T.invFrom)}<input name="period_from" type="date" value="${esc(from)}"></label>
<label>${esc(T.invTo)}<input name="period_to" type="date" value="${esc(s.paid_until ?? '')}"></label>
<label>${esc(T.invAmount)}<input name="amount" inputmode="decimal" dir="ltr" required></label>
<label>${esc(T.invVatAmount)}<input name="vat" inputmode="decimal" dir="ltr" required></label>
<label>${esc(T.invPdf)}<input name="pdf" type="file" accept="application/pdf,.pdf" required></label>
<button class="quiet">${esc(T.invSave)}</button></form></details>`;
}

/**
 * The paywall, for one product of a workspace on the console: its access today (paid, complimentary, unpaid,
 * cancelled, off), whether it is open, until when, and the button that marks it complimentary or takes that back.
 */
function accessRow(base, p, a, on, csrf) {
  if (!a) return '';
  const until = a.access === 'cancelled' ? a.lastDay : a.access === 'paid' ? a.paidUntil : a.access === 'due' ? a.graceUntil : null;
  const toggle = on ? button(`${base}/comp`, a.comp ? T.compOff : T.compOn, csrf, { fields: { product: p, comp: a.comp ? '0' : '1' }, kind: 'quiet' }) : '';
  return `<p class="access a-${esc(a.access)}"><span class="muted">${esc(T.accessLine(T.accessNames[a.access], a.allowed, until ? dayHe(until) : ''))}</span>${toggle}</p>`;
}

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
  // Each product's subscription: what the customer's dashboard shows, recorded here (no payment provider yet).
  const subs = Object.keys(w.products)
    .filter((p) => w.products[p] || w.subscriptions?.[p])
    .map((p) => {
      const s = w.subscriptions?.[p] || {};
      const d = describe(s.updated_at ? s : null);
      const sel = (v) => (s.vat === v ? ' selected' : '');
      return `<li><form method="post" action="${base}/subscription" class="sub-form">${csrfField(csrf)}<input type="hidden" name="product" value="${p}">
<span class="sub-name">${productMark(p)}<b>${esc(PRODUCT_NAMES[p])}</b>${d ? `<span class="muted">${esc(T.subStatus[d.status])}${d.status === 'active' ? `, ${esc(T.subLeft(d.bar.days - d.bar.day + 1))}` : ''}</span>` : `<span class="muted">${esc(T.subNone)}</span>`}</span>
${PLANS[p] ? `<label>${esc(T.subPlanLabel)}<select name="plan">${plansOf(p).map((k) => `<option value="${k}"${(s.plan || plansOf(p)[0]) === k ? ' selected' : ''}>${esc(`${PLAN_NAMES[k]} (${PLANS[p][k].slideshows})`)}</option>`).join('')}</select></label>` : ''}
<label>${esc(T.subMonthly)}<input name="monthly" inputmode="decimal" dir="ltr" value="${esc(s.monthly ?? '')}"></label>
<label>${esc(T.subSetupLabel)}<input name="setup" inputmode="decimal" dir="ltr" value="${esc(s.setup ?? '')}"></label>
<label>${esc(T.subVat)}<select name="vat"><option value=""></option><option value="excluded"${sel('excluded')}>${esc(T.vatExcluded)}</option><option value="included"${sel('included')}>${esc(T.vatIncluded)}</option></select></label>
<label>${esc(T.subStarted)}<input name="started_on" type="date" value="${esc(s.started_on ?? '')}"></label>
<label>${esc(T.subPaid)}<input name="paid_until" type="date" value="${esc(s.paid_until ?? '')}"></label>
<label>${esc(T.subEnds)}<input name="ends_on" type="date" value="${esc(s.ends_on ?? '')}"></label>
<button class="quiet">${esc(T.subSave)}</button></form>${button(`${base}/subscription/pay`, T.subPayMonth, csrf, { fields: { product: p, expect: s.paid_until ?? '' }, kind: 'quiet' })}
${accessRow(base, p, w.access?.[p], w.products[p], csrf)}
${invoiceForm(base, p, s, csrf)}</li>`;
    })
    .join('');
  const enabledProducts = Object.entries(w.products).filter(([, on]) => on).map(([p]) => p);
  const viewAs = `<form method="post" action="${base}/view-as" class="inline">${csrfField(csrf)}${
    enabledProducts.length
      ? `<select name="product" aria-label="${esc(T.viewIn)}">${enabledProducts.map((p) => `<option value="${p}">${esc(PRODUCT_NAMES[p])}</option>`).join('')}</select>`
      : ''
  }<button class="quiet">${esc(T.viewAs)}</button></form>`;
  return `
<article class="ws${w.disabled_at ? ' disabled' : ''}" id="ws-${esc(w.id)}">
<header><h3>${esc(w.name)}<span class="slug ltr">${esc(w.slug)}</span></h3><span class="tag">${esc(w.disabled_at ? T.statusDisabled : T.statusActive)}</span></header>
<p class="section-l">${esc(T.colProducts)}</p>
<ul class="toggles">${products}</ul>
${subs ? `<p class="section-l">${esc(T.subTitle)}</p><ul class="subs-admin">${subs}</ul>` : ''}
${w.invoices?.length ? `<p class="section-l">${esc(T.dashInvoices)}</p><ul class="people">${w.invoices
    .map((i) => `<li><a class="who" href="/admin/invoices/${esc(i.id)}">${esc(T.invAdminLine(i.number, dayHe(i.issued_on), ils(total(i))))}</a><span class="muted">${esc(PRODUCT_NAMES[i.product])}</span><span class="end">${button(`/admin/invoices/${i.id}/remove`, T.invRemove, csrf, { kind: 'quiet' })}</span></li>`)
    .join('')}</ul>` : ''}
<p class="section-l">${esc(T.colMembers)}</p>
<ul class="people">${people.length ? people.join('') : `<li class="muted">${esc(T.noMembers)}</li>`}</ul>
<div class="actions">
<form method="post" action="${base}/invite" class="inline">${csrfField(csrf)}<input name="email" type="email" dir="ltr" required placeholder="${esc(T.inviteEmailPlaceholder)}" aria-label="${esc(T.adminEmail)}">${roleSelect('role')}<button class="quiet">${esc(T.inviteMore)}</button></form>
${viewAs}
<span class="end">${w.disabled_at ? button(`${base}/enable`, T.enableWs, csrf, { kind: 'quiet' }) : button(`${base}/disable`, T.disableWs, csrf, { kind: 'danger' })}</span>
</div>
<details class="ws-delete"><summary>${esc(T.wsDelete)}</summary>
<form method="post" action="${base}/delete" class="inline">${csrfField(csrf)}<small>${esc(T.wsDeleteHint)}</small>
<label>${esc(T.wsDeleteLabel)}<input name="name" required maxlength="200" autocomplete="off" placeholder="${esc(w.name)}"></label>
<button class="danger">${esc(T.wsDeleteButton)}</button></form></details>
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
${adminTop({ csrf, tab: 'accounts' })}
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

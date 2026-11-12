import { LEADS, OPS, PRODUCT_NAMES, agoHe, stampHe } from './copy.js';
import { adminTop, button, csrfField, esc, productMark } from './html.js';
import { LOST_REASONS, WHERE } from './toran.js';

// The shared lead dashboard, /admin/leads (the owner, 2026-11-08: "make the shared lead dashboard be in the admin
// dashboard, not in one of the products"): one list of the stores we may sell to, with what Toran and Teder each have
// for them, and one page a lead where both demos are built and the message goes, as one with both demos or one each.
// Toran gives the data and does every action (GET/POST /internal/leads, docs/contracts/admin-leads.json; its
// src/ops/leadsAdmin.ts). Every button is a plain form that comes back to the lead's page with Toran's line at the top.
//
// The owner, 2026-11-11: "make the leads dashboard functional on mobile. also, if something misses it should be red,
// not purple or green. each leads should have a button for generating a demo for teder/toran/both. the message that is
// suggested being sent to the phone number on whatsapp should be according to that." So: a row wraps on a phone (the
// name and the button on top, the tags under them), a demo that is missing is red and only one that is there has its
// product's colour, each row and each lead has one button for what the lead goes on with, and the lead's message is
// the one for the demo the operator chose (Toran keeps the choice), with the others one press away.
//
// The owner, 2026-11-12: "i dont see a button for going on with teder/toran/both for each lead". The button offered
// only what was missing, so a lead whose Toran page was up had Teder alone, or nothing. It now offers Toran, Teder and
// both whenever Toran says they can be chosen (build.go), whatever is built: choosing makes only what is missing, and
// a choice that makes nothing goes straight to the lead's message.
//
// The owner, the same day: "i want https://accounts.openfrequency.co.il/admin/leads to have everything i need for
// creating and doing leads. i want each store to have a short description, so that i will know if i should build
// toran/teder/both/neither for that store. it MUST not send me to old fronts like
// https://accounts.openfrequency.co.il/admin/teder/leads?tab=new#lead-40". So:
//   - each store is said in a few words, on its row and its page: its own line from its site, then what Toran found of
//     it (its platform, its products and prices, the kinds they are, its Instagram, TikTok and Facebook, a way to reach
//     it), nothing guessed;
//   - the button has a fourth choice, neither, under the three;
//   - the list adds a store by its address and finds more stores, and says which are still being read;
//   - Toran's page is checked and fixed on the lead's page (what holds it back, the name and the colour, the sample
//     chat), and Teder's demo is worked there (again, another topic, taken down);
//   - where it stands, a take-down and a delete are all here;
//   - nothing links to Toran's or Teder's own operator pages: only to the store's site, its profiles and the demos'
//     own pages.

const ext = (href, inner, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
const flashLine = (flash, bad) => (flash ? `<p class="flash${bad ? ' bad' : ''}" role="${bad ? 'alert' : 'status'}">${esc(flash)}</p>` : '');
const empty = (title, lead) => `<div class="card empty"><b>${esc(title)}</b><p>${esc(lead)}</p></div>`;
const arrow = '<bdi class="ltr">↗</bdi>';

/** A lead's demos as the operator picks them: both in one message, Toran's, Teder's. */
const PICKS = ['both', 'toran', 'teder'];

/** A demo that is not there: none yet, failed, or taken down. */
const missing = (d) => d.state === 'removed' || (!d.sentAt && ['none', 'failed'].includes(d.state));

/**
 * A product's demo in one short tag: "תורן: מוכן", "תדר: נשלח". The product's colour only for a demo that is there
 * (built, up, sent), red for one that is missing, grey while it is being built.
 */
function demoTag(product, d, { name = true } = {}) {
  const said = d.state === 'removed' ? LEADS.state.removed : d.sentAt ? LEADS.sentShort : LEADS.state[d.state] || LEADS.state.none;
  const look = missing(d) ? 'miss' : d.state === 'building' && !d.sentAt ? 'wait' : `p-${product}`;
  return `<span class="tag ${look}">${name ? `${esc(PRODUCT_NAMES[product])}: ` : ''}${esc(said)}</span>`;
}

/** Both demos of a row: one red tag when neither has any yet (most of a new list), else a tag each. */
const demoTags = (x) =>
  [x.toran, x.teder].every((d) => d.state === 'none' && !d.sentAt) ? `<span class="tag miss">${esc(LEADS.noDemo)}</span>` : `${demoTag('toran', x.toran)}${demoTag('teder', x.teder)}`;

const whereTag = (w) => `<span class="tag where">${esc(LEADS.where[w] || w)}</span>`;
/** A reminder that is due now, on either demo: what the row is waiting for. */
const dueTag = (x) => ([x.toran, x.teder].some((d) => d.reminderDue && !d.reminderSentAt) ? `<span class="tag due">${esc(LEADS.reminderDue)}</span>` : '');

/** A button of the lead's page: to /admin/leads/<id>/<action>, back to the page. */
const leadButton = (csrf, id, action, label, kind = '', fields = {}) => button(`/admin/leads/${id}/${action}`, label, csrf, { kind, fields });

/** A button that asks once more before it does what cannot be undone: it opens, and the second press does it. */
const sure = (csrf, id, action, label, yes, hint, fields = {}) =>
  `<details class="lost"><summary>${esc(label)}</summary><div class="sure"><p class="muted">${esc(hint)}</p>${leadButton(csrf, id, action, yes, 'danger', fields)}</div></details>`;

// ---- a store in a few words (the owner: "a short description, so that i will know if i should build
// toran/teder/both/neither for that store")

/** Its line in its own words, from its home page; nothing when its site says nothing more than its name. */
const aboutLine = (x) => (x.about ? `<p class="about" dir="auto">${esc(x.about)}</p>` : '');

/**
 * What Toran found of it, as short facts: the platform, the products and their prices (once read, else as counted when
 * it was found), the kinds most of them are, its own profiles (each opens on its network), and how it can be reached.
 */
function factsLine(x) {
  const f = x.facts || {};
  const parts = [];
  const platform = LEADS.platform[x.platform];
  if (platform) parts.push(`<span><bdi class="ltr">${esc(platform)}</bdi></span>`);
  if (f.products != null) parts.push(`<span>${esc(LEADS.products(f.products, f.productsAtLeast))}</span>`);
  if (f.priceMin != null && f.priceMax != null && f.currency === 'ILS') parts.push(`<span>${esc(LEADS.prices(f.priceMin, f.priceMax))}</span>`);
  if (f.kinds?.length) parts.push(`<span dir="auto">${esc(f.kinds.join(', '))}</span>`);
  const nets = ['instagram', 'tiktok', 'facebook'].filter((n) => f.social?.[n]);
  // None found is said only when its site was read for them: a store found before Toran read them may have some.
  if (nets.length) parts.push(`<span class="nets">${nets.map((n) => ext(f.social[n], esc(LEADS.social[n]))).join(', ')}</span>`);
  else if (f.socialRead) parts.push(`<span>${esc(LEADS.noSocial)}</span>`);
  const c = x.contact || {};
  parts.push(c.whatsapp ? `<span>${esc(LEADS.waOnSite)}</span>` : !c.email && !c.phone ? `<span class="bad">${esc(LEADS.noWay)}</span>` : '');
  return `<p class="facts">${parts.filter(Boolean).join('')}</p>`;
}

/**
 * The one button for what the lead goes on with: it opens Toran, Teder and both, both first, each that Toran says can
 * be chosen (build.go), whatever is built already, and neither under them. A choice may make a demo, which costs
 * money, so it takes a second press, on the choice; once one was made, the button says which. From the list, a choice
 * that makes something comes back to the list as it was, at the lead's row; one whose message can go now opens the
 * lead, at its message. A closed lead has none: its page brings it back to the list first.
 */
function goMenu(csrf, x, { fields = {}, main = false } = {}) {
  if (x.where === 'closed') return '';
  const go = x.build?.go || {};
  const can = PICKS.filter((p) => go[p]?.can);
  if (!can.length) return '';
  const picks = can.map((p, i) => leadButton(csrf, x.id, `go-${p}`, LEADS.pick[p], i ? '' : 'primary', fields)).join('');
  const label = x.chosen && can.includes(x.chosen) ? LEADS.goingWith(LEADS.pick[x.chosen]) : LEADS.goOn;
  return `<details class="make"><summary${main ? ' class="primary"' : ''}>${esc(label)}</summary><div class="make-pick">${picks}${leadButton(csrf, x.id, 'go-none', LEADS.none, 'danger', fields)}</div></details>`;
}

// ---- the list

/** Adding a store by its address, and finding more: the list's own buttons, with what is still being read. */
function creating(csrf, d, at) {
  const add = `<form class="row lead-add" method="post" action="/admin/leads/add">${csrfField(csrf)}<input type="text" name="url" required maxlength="300" dir="ltr" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${esc(LEADS.addPlaceholder)}" aria-label="${esc(LEADS.addLabel)}"><button class="quiet">${esc(LEADS.add)}</button></form>`;
  const disc = d.discovery || {};
  const last = disc.last ? `<p class="muted">${esc(LEADS.findLast(agoHe(disc.last.at, at), disc.last.looked, disc.last.fit))}</p>` : '';
  const find = disc.running
    ? `<p class="muted">${esc(LEADS.findRunning)}</p>`
    : disc.sources?.length
      ? `<details class="find"><summary>${esc(LEADS.find)}</summary><form class="row" method="post" action="/admin/leads/discover">${csrfField(csrf)}<select name="source" aria-label="${esc(LEADS.findFrom)}">${disc.sources.map((x) => `<option value="${esc(x)}">${esc(LEADS.sources[x] || x)}</option>`).join('')}</select><button class="quiet">${esc(LEADS.findGo)}</button></form>${last}</details>`
      : '';
  const adding = d.adding?.length
    ? `<ul class="adding">${d.adding.map((a) => `<li><bdi class="ltr">${esc(a.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</bdi> ${a.state === 'failed' ? `<span class="tag miss">${esc(LEADS.addFailed)}</span>${a.error ? ` <span class="muted">${esc(a.error)}</span>` : ''}` : `<span class="tag wait">${esc(LEADS.adding)}</span>`}</li>`).join('')}</ul>`
    : '';
  return `<div class="lead-create">${add}${find}</div>${adding}`;
}

/** The list: the tabs by where each lead stands, the search, the rows, and Teder's leads Toran no longer has. */
export function leadsPage({ csrf, flash = '', flashBad = false, result, where = '', q = '', all = false, at }) {
  const top = `${adminTop({ csrf, tab: 'leads' })}
${flashLine(flash, flashBad)}`;
  if (!result.ok) return `${top}${empty(LEADS.down, result.why === 'not_configured' ? LEADS.notConfigured : LEADS.downLead)}`;
  const d = result.data;
  const qs = (o) => {
    const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v));
    return `/admin/leads${p.size ? `?${p}` : ''}`;
  };
  const tab = (w) => `<a href="${esc(qs({ where: w, q, all: all ? '1' : '' }))}"${where === w ? ' aria-current="page"' : ''}>${esc(LEADS.where[w || 'all'])} <span class="muted">${esc(d.counts[w || 'all'] ?? 0)}</span></a>`;
  // Where a lead stands is said by the tab it is under; under "all", by a tag of its own.
  const stands = (w) => (where ? '' : whereTag(w));
  const fields = Object.fromEntries(Object.entries({ back: 'list', where, q, all: all ? '1' : '' }).filter(([, v]) => v));
  const rows = d.leads.length
    ? `<ul class="people leads-list">${d.leads
        .map(
          (x) =>
            `<li id="lead-${esc(x.id)}"><div class="lead-who"><a class="who" href="/admin/leads/${esc(x.id)}"><b>${esc(x.name)}</b></a><bdi class="ltr muted">${esc(x.domain)}</bdi></div><div class="lead-tags">${demoTags(x)}${dueTag(x)}${stands(x.where)}</div>${goMenu(csrf, x, { fields })}<div class="lead-about">${aboutLine(x)}${factsLine(x)}</div></li>`
        )
        .join('')}</ul>`
    : empty(LEADS.none, LEADS.noneLead);
  const only = d.tederOnly.length
    ? `<details class="card no-contact"><summary>${esc(LEADS.tederOnly(d.tederOnly.length))}</summary><p class="muted">${esc(LEADS.tederOnlyHint)}</p><ul class="people leads-list">${d.tederOnly
        .map(
          (x) =>
            `<li><div class="lead-who"><b class="who">${esc(x.name)}</b><bdi class="ltr muted">${esc(x.domain)}</bdi></div><div class="lead-tags">${demoTag('teder', x.teder)}${stands(x.where)}</div>${button('/admin/leads/add', LEADS.tederOnlyAdd, csrf, { kind: 'quiet', fields: { url: `https://${x.domain}/` } })}</li>`
        )
        .join('')}</ul></details>`
    : '';
  return `${top}
<section id="leads"><div class="list-h"><h2>${esc(LEADS.title)}</h2><p class="muted">${esc(LEADS.lead)}</p></div>
${creating(csrf, d, at)}
<nav class="tabs lead-tabs" aria-label="${esc(LEADS.title)}">${['', ...WHERE].map(tab).join('')}</nav>
<form class="row lead-search" method="get" action="/admin/leads" role="search">${where ? `<input type="hidden" name="where" value="${esc(where)}">` : ''}${all ? '<input type="hidden" name="all" value="1">' : ''}<input type="search" name="q" value="${esc(q)}" maxlength="100" placeholder="${esc(LEADS.search)}" aria-label="${esc(LEADS.search)}"><button class="quiet">${esc(LEADS.searchGo)}</button></form>
<p class="lead-all"><a href="${esc(qs({ where, q, all: all ? '' : '1' }))}">${esc(all ? LEADS.fitStores : LEADS.allStores)}</a></p>
${d.teder.ok ? '' : `<p class="muted note">${esc(LEADS.tederDown)}</p>`}
${rows}
${only}
</section>`;
}

/**
 * A chat or mail link with `text` written in it (wa.me's text, mailto's body), as static/admin.js writes in the box's
 * text when it copies, so the link opens with the message without script too.
 */
function withText(href, text) {
  const mail = /^mailto:/i.test(href);
  if (!mail && !/^https:\/\/wa\.me\//i.test(href)) return href;
  const at = href.indexOf('?');
  const key = mail ? 'body' : 'text';
  const keep = at < 0 ? [] : href.slice(at + 1).split('&').filter((p) => p && !p.startsWith(`${key}=`));
  if (text) keep.push(`${key}=${encodeURIComponent(text)}`);
  return `${at < 0 ? href : href.slice(0, at)}${keep.length ? `?${keep.join('&')}` : ''}`;
}

// ---- one lead

/**
 * What to send: the message for the demo the operator chose to make (else Toran's main one: both when both can go, as
 * before), as the store will read it, and its one button; the others are one press away on the switch above it, each
 * with its own text and button. From our number it is Meta's template with a button per demo; otherwise the text to
 * copy, with each demo's link in it, and "שלחתי" for the demo it was for.
 */
function sendCard(csrf, x) {
  const s = x.send;
  const card = (body) => `<article class="card" id="send"><h3>${esc(LEADS.sendTitle)}</h3>${body}</article>`;
  const textOf = { both: s.bothText, toran: s.toranText, teder: s.tederText };
  const ours = s.options.length > 0;
  const can = ours ? s.options : PICKS.filter((p) => textOf[p]);
  if (!can.length) {
    if (s.waitingUntil) return card(`<p>${esc(LEADS.waiting(stampHe(s.waitingUntil)))}</p>`);
    return card(`<p class="muted">${esc(x.toran.reminderSentAt ? LEADS.sendDone : LEADS.sendNothing)}</p>`);
  }
  const lead = [x.chosen, s.main].find((p) => can.includes(p)) || can[0];
  // The demo chosen cannot go yet: which one it waits for.
  const waits = !x.chosen || can.includes(x.chosen) ? null : x.chosen === 'both' ? ['toran', 'teder'].find((p) => x[p].state !== 'ready') : x[x.chosen].state !== 'ready' ? x.chosen : null;
  const stage = (p) => ((p === 'teder' ? x.teder : x.toran).sentAt ? 'reminder' : 'first');
  const panel = (p) => {
    const text = textOf[p] || '';
    let body;
    if (ours) {
      const links = (p === 'both' ? ['toran', 'teder'] : [p]).filter((q) => x[q].pageUrl).map((q) => ext(x[q].pageUrl, `${esc(LEADS.msgButton[q])} ${arrow}`, 'chip'));
      body = `${text ? `<blockquote class="msg">${esc(text)}</blockquote>` : ''}${links.length ? `<p class="msg-buttons" aria-label="${esc(LEADS.msgButtons)}">${links.join('')}</p>` : ''}
<div class="op-acts">${leadButton(csrf, x.id, `send-${p}`, LEADS.send[stage(p)][p], 'primary')}</div>`;
    } else {
      const id = `lead-msg-${x.id}-${p}`;
      const sent = (p === 'teder' ? x.teder : x.toran).sentAt;
      body = `<textarea id="${id}" rows="8" dir="rtl" aria-label="${esc(OPS.message)}">${esc(text)}</textarea>
<div class="op-acts">${s.copy ? `<a class="button primary" href="${esc(withText(s.copy.href, text))}" target="_blank" rel="noopener" data-copy="#${id}" data-done="${esc(OPS.copied)}" data-fail="${esc(OPS.copyFailed)}">${esc(s.copy.label || LEADS.copyOpen)}</a>` : ''}${leadButton(csrf, x.id, sent ? 'mark-reminded' : 'mark-sent', sent ? LEADS.markReminded : LEADS.markSent, s.copy ? '' : 'primary', { product: p })}</div>`;
    }
    return `<div class="pick${p === lead ? ' on' : ''}" data-pick="${p}">${body}</div>`;
  };
  const seg = can.length > 1
    ? `<fieldset class="seg"><legend>${esc(LEADS.sendWhich)}</legend>${can.map((p) => `<label><input type="radio" name="pick" value="${p}"${p === lead ? ' checked' : ''}><span>${esc(LEADS.pick[p])}</span></label>`).join('')}</fieldset>`
    : '';
  return card(`${waits ? `<p class="muted">${esc(LEADS.chosenWaits(PRODUCT_NAMES[waits], x.chosen === 'both'))}</p>` : ''}${seg}
${can.map(panel).join('\n')}
<p class="muted">${esc(ours ? LEADS.sendNote : LEADS.notPitchable)}</p>`);
}

function demoBox(product, d, body) {
  return `<div class="demo-box${missing(d) ? ' miss' : ''}" id="${product}"><header class="op-who">${productMark(product)}<div><h3>${esc(PRODUCT_NAMES[product])} ${demoTag(product, d, { name: false })}</h3>${d.reminderSentAt ? `<small>${esc(LEADS.reminded)}</small>` : ''}${d.error ? `<small class="bad">${esc(d.error)}</small>` : ''}</div></header>
${body}</div>`;
}

/** A colour drawn as an SVG swatch: a fill attribute, which the page's CSP lets through where a style would not be. */
const swatch = (c) => `<svg class="swatch" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="4" fill="${esc(c)}"/></svg>`;

/** The name and the colour Toran's page shows, fixed here over what the site said; the site's colours one press each. */
function brandForm(csrf, x, r, { open = false } = {}) {
  const color = r.color || r.colorsFound[0] || '#000000';
  const found = r.colorsFound.filter((c) => c !== r.color);
  return `<details class="brand"${open ? ' open' : ''}><summary>${esc(LEADS.brandTitle)}</summary>
<form method="post" action="/admin/leads/${esc(x.id)}/brand" class="brand-form">${csrfField(csrf)}<label>${esc(LEADS.brandName)}<input type="text" name="name" value="${esc(r.name || '')}" maxlength="80" dir="auto"></label><label>${esc(LEADS.brandColor)}<input type="color" name="color" value="${esc(color)}"></label><button class="quiet">${esc(LEADS.brandSave)}</button></form>
${found.length ? `<div class="row colors" aria-label="${esc(LEADS.colorsFound)}">${found.map((c) => `<form method="post" action="/admin/leads/${esc(x.id)}/brand" class="inline">${csrfField(csrf)}<input type="hidden" name="color" value="${esc(c)}"><button class="quiet swatch-b" aria-label="${esc(LEADS.useColor(c))}">${swatch(c)}<bdi class="ltr">${esc(c)}</bdi></button></form>`).join('')}</div>` : ''}</details>`;
}

const bubbles = (chat) => `<div class="chat">${chat.map((m) => `<p class="b ${m.role === 'agent' ? 'agent' : 'customer'}" dir="auto">${esc(m.text)}</p>`).join('')}</div>`;

/**
 * Toran's box: its page as it is checked here, not on Toran's own review page. What holds it back comes first, each with
 * its fix in place (the name and the colour, the sample chat made again, the site read again); then the one main button
 * for where it is (approve it, or open it); the sample chat and what its build turned down; the rest under "עוד".
 */
function toranBox(csrf, x) {
  const d = x.toran;
  const r = x.review;
  if (!r) {
    const body = d.state === 'building' ? `<p class="muted">${esc(LEADS.pageBuilding)}</p>` : x.build.toranWhyNot ? `<p class="muted">${esc(x.build.toranWhyNot)}</p>` : '';
    return demoBox('toran', d, body);
  }
  const gaps = r.gaps.filter((g) => ['name', 'color', 'products', 'sample'].includes(g.key));
  const other = r.gaps.filter((g) => !gaps.includes(g));
  const gapList = r.gaps.length
    ? `<div class="gaps" role="alert"><b>${esc(LEADS.gapsTitle)}</b><ul>${gaps.map((g) => `<li>${esc(LEADS.gap[g.key])}</li>`).join('')}${other.map((g) => `<li>${esc(g.he)}</li>`).join('')}</ul></div>`
    : '';
  const fixes = [
    gaps.some((g) => g.key === 'name' || g.key === 'color') ? brandForm(csrf, x, r, { open: true }) : '',
    gaps.some((g) => g.key === 'sample') && !r.building ? `<div class="op-acts">${leadButton(csrf, x.id, 'sample', LEADS.sampleAgain, 'primary')}</div>` : '',
    gaps.some((g) => g.key === 'products') && !r.building && x.build.toran ? `<div class="op-acts">${leadButton(csrf, x.id, 'build-toran', LEADS.reread, 'primary')}</div>` : '',
  ].join('');
  const page = d.pageUrl ? ext(r.approved ? d.pageUrl : `${d.pageUrl}?preview=1`, `${esc(r.approved ? LEADS.pageOpen : LEADS.pagePreview)} ${arrow}`, 'button') : '';
  const state = r.building
    ? `<p class="muted">${esc(LEADS.pageBuilding)}</p>`
    : !r.approved && !r.gaps.length
      ? `<p class="muted">${esc(r.held ? LEADS.pageHeld : LEADS.pageWaits)}</p><div class="op-acts">${leadButton(csrf, x.id, 'approve-toran', LEADS.approve, 'primary')}${page}</div>`
      : page
        ? `<div class="op-acts">${page}</div>`
        : '';
  const stats = x.stats ? `<p class="muted">${esc(LEADS.stats(x.stats))}</p>` : '';
  const chat = `<details class="sample"><summary>${esc(LEADS.sampleTitle)}</summary>${r.chat.length ? bubbles(r.chat) : `<p class="muted">${esc(LEADS.sampleNone)}</p>`}${
    r.turnedDown.length ? `<details class="turned"><summary>${esc(LEADS.turnedDown(r.turnedDown.length))}</summary><ul>${r.turnedDown.map((t) => `<li><b dir="auto">${esc(t.product)}</b>: <span dir="auto">${esc(t.why)}</span></li>`).join('')}</ul></details>` : ''
  }</details>`;
  const more = [
    !r.building && !gaps.some((g) => g.key === 'sample') && d.state !== 'removed' ? leadButton(csrf, x.id, 'sample', LEADS.sampleAgain, 'quiet') : '',
    !r.building && x.build.toran ? leadButton(csrf, x.id, 'build-toran', LEADS.reread, 'quiet') : '',
    r.approved ? leadButton(csrf, x.id, 'hold-toran', LEADS.hold, 'quiet') : '',
  ].join('');
  const brand = gaps.some((g) => g.key === 'name' || g.key === 'color') ? '' : brandForm(csrf, x, r);
  return demoBox('toran', d, `${gapList}${fixes}${state}${stats}${chat}${more || brand ? `<details class="more"><summary>${esc(LEADS.more)}</summary>${brand}${more ? `<div class="op-acts">${more}</div>` : ''}${r.approved ? `<p class="muted">${esc(LEADS.holdHint)}</p>` : ''}</details>` : ''}`);
}

/** Teder's box: the idea its demo is about, its page, and its own buttons (again, another topic, taken down). */
function tederBox(csrf, x) {
  const d = x.teder;
  if (!x.tederOk) return demoBox('teder', d, `<p class="muted">${esc(LEADS.tederUnknown)}</p>`);
  const idea = d.idea ? `<p dir="auto">${esc(LEADS.idea(d.idea))}</p>` : '';
  const page = d.pageUrl ? `<div class="op-acts">${ext(d.pageUrl, `${esc(LEADS.pageOpen)} ${arrow}`, 'button')}</div>` : '';
  const main =
    d.state === 'failed' && x.build.teder
      ? `<div class="op-acts">${leadButton(csrf, x.id, 'build-teder', LEADS.tederTry, 'primary')}</div>`
      : d.state === 'review'
        ? `<div class="op-acts">${leadButton(csrf, x.id, 'teder-approve', LEADS.tederApprove, 'primary')}</div>`
        : d.state === 'building'
          ? ''
          : page;
  // Written again, on another topic, or taken down: a demo that is there, up or waiting for its look.
  const more = ['ready', 'review'].includes(d.state)
    ? `<details class="more"><summary>${esc(LEADS.more)}</summary><div class="op-acts">${leadButton(csrf, x.id, 'teder-redo', LEADS.tederRedo, 'quiet')}${leadButton(csrf, x.id, 'teder-other', LEADS.tederOther, 'quiet')}</div>${sure(csrf, x.id, 'teder-remove', LEADS.tederRemove, LEADS.takedownSure, LEADS.tederRemoveHint)}</details>`
    : '';
  return demoBox('teder', d, `${idea}${main}${more}`);
}

/** The two demos: the one button for what the lead goes on with, then each one's box. */
function demosCard(csrf, x) {
  const make = goMenu(csrf, x, { main: missing(x.toran) && missing(x.teder) });
  return `<article class="card" id="demos"><h3>${esc(LEADS.demosTitle)}</h3>
${make ? `<div class="make-row">${make}</div>` : ''}
<div class="demo-pair">${toranBox(csrf, x)}${tederBox(csrf, x)}</div></article>`;
}

/** Where it stands: they answered, later, not interested, skipped, back on the list; and the notes. */
function standsCard(csrf, x) {
  const ops = (action, label, fields = {}) => leadButton(csrf, x.id, action, label, 'quiet', fields);
  const lost = `<details class="lost"><summary>${esc(OPS.lost)}</summary><form method="post" action="/admin/leads/${x.id}/lost" class="inline">${csrfField(csrf)}<select name="reason" aria-label="${esc(OPS.lostWhy)}">${LOST_REASONS.map(
    (k) => `<option value="${k}">${esc(OPS.lostReasons[k])}</option>`
  ).join('')}</select><button class="danger">${esc(OPS.lostSave)}</button></form></details>`;
  const skip = `<details class="lost"><summary>${esc(LEADS.skip)}</summary><form method="post" action="/admin/leads/${x.id}/skip" class="inline">${csrfField(csrf)}<input type="text" name="reason" maxlength="300" placeholder="${esc(LEADS.skipReason)}" aria-label="${esc(LEADS.skipReason)}"><button class="danger">${esc(LEADS.skip)}</button></form></details>`;
  const acts = x.where === 'closed' ? ops('reopen', LEADS.reopen) : `${ops('replied', LEADS.replied)}${ops('later', LEADS.tomorrow, { days: 1 })}${ops('later', LEADS.inAWeek, { days: 7 })}${lost}${skip}`;
  return `<article class="card" id="stands"><h3>${esc(LEADS.standsTitle)} ${whereTag(x.where)}</h3>
<div class="op-more">${acts}</div>
<form method="post" action="/admin/leads/${x.id}/notes" class="notes-form">${csrfField(csrf)}<label>${esc(LEADS.notesTitle)}<textarea name="notes" rows="3" dir="auto" maxlength="4000">${esc(x.notes)}</textarea></label><button class="quiet">${esc(LEADS.notesSave)}</button></form></article>`;
}

function contactCard(x, at) {
  const c = x.contact;
  const lines = [
    c.whatsapp ? `<li>${esc(LEADS.contact.whatsapp)}: ${ext(`https://wa.me/${c.whatsapp}`, `<bdi class="ltr">+${esc(c.whatsapp)}</bdi>`)}</li>` : '',
    c.email ? `<li>${esc(LEADS.contact.email)}: ${ext(`mailto:${c.email}`, `<bdi class="ltr">${esc(c.email)}</bdi>`)}</li>` : '',
    c.phone ? `<li>${esc(LEADS.contact.phone)}: <a href="tel:+${esc(c.phone)}"><bdi class="ltr">+${esc(c.phone)}</bdi></a></li>` : '',
  ].join('');
  const parts = x.scoreParts?.length
    ? `<details class="score"><summary>${esc(LEADS.scoreTitle(Math.round(x.score)))}</summary><ul>${x.scoreParts.map((f) => `<li class="${f.points < 0 ? 'bad' : ''}"><b>${esc(f.he)}</b> <bdi class="ltr">${esc(f.max ? `${f.points}/${f.max}` : String(f.points))}</bdi>${f.evidence ? ` <span class="muted" dir="auto">${esc(f.evidence)}</span>` : ''}</li>`).join('')}</ul></details>`
    : '';
  return `<article class="card" id="contact"><h3>${esc(LEADS.contactTitle)}</h3>
<ul class="people">${lines || `<li class="bad">${esc(LEADS.noContact)}</li>`}</ul>
<p class="muted">${esc(LEADS.opens(x.opens))}${x.demoStartedAt ? ` · ${esc(LEADS.demoStarted)} ${esc(agoHe(x.demoStartedAt, at))}` : ''}</p>${parts}</article>`;
}

/** The end of the road, apart and quiet: the page taken down when they ask, and the store deleted. Each asks twice. */
function endCard(csrf, x) {
  const down = x.toran.state !== 'removed' && (x.review || x.teder.pageUrl) ? sure(csrf, x.id, 'takedown', LEADS.takedown, LEADS.takedownSure, LEADS.takedownHint) : '';
  return `<article class="card end" id="end"><h3>${esc(LEADS.endTitle)}</h3><div class="op-more">${down}${sure(csrf, x.id, 'delete', LEADS.remove, LEADS.removeSure, LEADS.removeHint)}</div></article>`;
}

/** One lead's page: who the store is, what to send (the main action), the two demos, where it stands, the details. */
export function leadPage({ csrf, flash = '', flashBad = false, result, at }) {
  const top = `${adminTop({ csrf, tab: 'leads' })}
${flashLine(flash, flashBad)}
<p><a href="/admin/leads">← ${esc(LEADS.back)}</a></p>`;
  if (!result.ok) return `${top}${result.why === 'none' ? empty(LEADS.notFound, '') : empty(LEADS.down, result.why === 'not_configured' ? LEADS.notConfigured : LEADS.downLead)}`;
  const x = result.lead;
  const asked = x.takedownAskedAt && x.toran.state !== 'removed' ? `<p class="flash bad" role="alert">${esc(LEADS.takedownAsked(agoHe(x.takedownAskedAt, at)))}</p>` : '';
  return `${top}
<section id="lead"><div class="list-h"><h2>${esc(x.name)}</h2><p class="muted">${x.url ? ext(x.url, `<bdi class="ltr">${esc(x.domain)}</bdi>`) : `<bdi class="ltr">${esc(x.domain)}</bdi>`} ${demoTag('toran', x.toran)} ${demoTag('teder', x.teder)}${dueTag(x)}</p><div class="lead-about">${aboutLine(x)}${factsLine(x)}</div></div>
${asked}
<div class="ops-cards lead-cards">
${sendCard(csrf, x)}
${demosCard(csrf, x)}
${standsCard(csrf, x)}
${contactCard(x, at)}
${endCard(csrf, x)}
</div>
</section>`;
}

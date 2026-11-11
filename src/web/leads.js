import { LEADS, OPS, PRODUCT_NAMES, agoHe, stampHe } from './copy.js';
import { adminTop, button, csrfField, esc, productMark } from './html.js';
import { LOST_REASONS, WHERE } from './toran.js';

// The shared lead dashboard, /admin/leads (the owner, 2026-11-08: "make the shared lead dashboard be in the admin
// dashboard, not in one of the products"): one list of the stores we may sell to, with what Toran and Teder each have
// for them, and one page a lead where both demos are built and the message goes, as one with both demos or one each.
// Toran gives the data and does every action (GET/POST /internal/leads, docs/contracts/admin-leads.json; its
// src/ops/leadsAdmin.ts); the status buttons are the dashboard's own (/internal/ops). Every button is a plain form that
// comes back to the lead's page with Toran's line at the top.
//
// The owner, 2026-11-11: "make the leads dashboard functional on mobile. also, if something misses it should be red,
// not purple or green. each leads should have a button for generating a demo for teder/toran/both. the message that is
// suggested being sent to the phone number on whatsapp should be according to that." So: a row wraps on a phone (the
// name and the button on top, the tags under them), a demo that is missing is red and only one that is there has its
// product's colour, each row and each lead has one "ליצור דמו" that opens what can be made, and the lead's message is
// the one for the demo the operator chose (Toran keeps the choice), with the others one press away.

const ext = (href, inner, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
const flashLine = (flash, bad) => (flash ? `<p class="flash${bad ? ' bad' : ''}" role="${bad ? 'alert' : 'status'}">${esc(flash)}</p>` : '');
const empty = (title, lead) => `<div class="card empty"><b>${esc(title)}</b><p>${esc(lead)}</p></div>`;

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

/** A button of the lead's page: to /admin/leads/<id>/<action>, back to the page. */
const leadButton = (csrf, id, action, label, kind = '', fields = {}) => button(`/admin/leads/${id}/${action}`, label, csrf, { kind, fields });

/** What the operator can make for the lead now, both first: what Toran says can be built, and is not there yet. */
const makeable = (x) => PICKS.filter((p) => (p === 'both' ? x.build.both : p === 'toran' ? x.build.toran && x.toran.state === 'none' : x.build.teder));

/**
 * The one button that makes a demo: it opens what can be made now, both first. Making one costs money, so it takes a
 * second press, on what to make. From the list, the choice comes back to the list as it was, at the lead's row.
 */
function makeDemo(csrf, x, { fields = {}, main = false } = {}) {
  const can = makeable(x);
  if (!can.length) return '';
  const picks = can.map((p, i) => leadButton(csrf, x.id, `build-${p}`, LEADS.pick[p], i ? '' : 'primary', fields)).join('');
  return `<details class="make"><summary${main ? ' class="primary"' : ''}>${esc(LEADS.make)}</summary><div class="make-pick">${picks}</div></details>`;
}

/** The list: the tabs by where each lead stands, the search, the rows, and Teder's leads Toran has no store for. */
export function leadsPage({ csrf, flash = '', flashBad = false, result, where = '', q = '', at }) {
  const top = `${adminTop({ csrf, tab: 'leads' })}
${flashLine(flash, flashBad)}`;
  if (!result.ok) return `${top}${empty(LEADS.down, result.why === 'not_configured' ? LEADS.notConfigured : LEADS.downLead)}`;
  const d = result.data;
  const tab = (w) => {
    const href = `/admin/leads${w || q ? `?${new URLSearchParams(Object.entries({ where: w, q }).filter(([, v]) => v))}` : ''}`;
    return `<a href="${esc(href)}"${where === w ? ' aria-current="page"' : ''}>${esc(LEADS.where[w || 'all'])} <span class="muted">${esc(d.counts[w || 'all'] ?? 0)}</span></a>`;
  };
  // Where a lead stands is said by the tab it is under; under "all", by a tag of its own.
  const stands = (w) => (where ? '' : whereTag(w));
  const fields = Object.fromEntries(Object.entries({ back: 'list', where, q }).filter(([, v]) => v));
  const rows = d.leads.length
    ? `<ul class="people leads-list">${d.leads
        .map(
          (x) => `<li id="lead-${esc(x.id)}"><div class="lead-who"><a class="who" href="/admin/leads/${esc(x.id)}"><b>${esc(x.name)}</b></a><bdi class="ltr muted">${esc(x.domain)}</bdi></div><div class="lead-tags">${demoTags(x)}${stands(x.where)}</div>${makeDemo(csrf, x, { fields })}</li>`
        )
        .join('')}</ul>`
    : empty(LEADS.none, LEADS.noneLead);
  const only = d.tederOnly.length
    ? `<details class="card no-contact"><summary>${esc(LEADS.tederOnly(d.tederOnly.length))}</summary><ul class="people leads-list">${d.tederOnly
        .map((x) => `<li><div class="lead-who">${x.leadUrl ? ext(x.leadUrl, `<b>${esc(x.name)}</b>`, 'who') : `<b class="who">${esc(x.name)}</b>`}<bdi class="ltr muted">${esc(x.domain)}</bdi></div><div class="lead-tags">${demoTag('teder', x.teder)}${stands(x.where)}</div></li>`)
        .join('')}</ul><p class="muted">${esc(LEADS.tederOnlyHint)}</p></details>`
    : '';
  return `${top}
<section id="leads"><div class="list-h"><h2>${esc(LEADS.title)}</h2><p class="muted">${esc(LEADS.lead)}</p></div>
<nav class="tabs lead-tabs" aria-label="${esc(LEADS.title)}">${['', ...WHERE].map(tab).join('')}</nav>
<form class="row lead-search" method="get" action="/admin/leads" role="search">${where ? `<input type="hidden" name="where" value="${esc(where)}">` : ''}<input type="search" name="q" value="${esc(q)}" maxlength="100" placeholder="${esc(LEADS.search)}" aria-label="${esc(LEADS.search)}"><button class="quiet">${esc(LEADS.searchGo)}</button></form>
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
      const links = (p === 'both' ? ['toran', 'teder'] : [p]).filter((q) => x[q].pageUrl).map((q) => ext(x[q].pageUrl, `${esc(LEADS.msgButton[q])} <bdi class="ltr">↗</bdi>`, 'chip'));
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

function demoBox(product, d, acts) {
  return `<div class="demo-box${missing(d) ? ' miss' : ''}"><header class="op-who">${productMark(product)}<div><h3>${esc(PRODUCT_NAMES[product])} ${demoTag(product, d, { name: false })}</h3>${d.reminderSentAt ? `<small>${esc(LEADS.reminded)}</small>` : ''}${d.error ? `<small class="bad">${esc(d.error)}</small>` : ''}</div></header>
${d.pageUrl ? `<p>${ext(d.pageUrl, `${esc(LEADS.openPage)} <bdi class="ltr">↗</bdi>`)}</p>` : ''}
<div class="op-acts">${acts}</div></div>`;
}

/** The two demos: the one button to make what is missing, then each one's state, its page and its own buttons. */
function demosCard(csrf, x) {
  const make = makeDemo(csrf, x, { main: missing(x.toran) && missing(x.teder) });
  const toranActs = [
    x.toran.state === 'review' && x.links.toranReview ? `<a class="button primary" href="${esc(x.links.toranReview)}">${esc(LEADS.review)}</a>` : '',
    x.build.toran && !['none', 'building'].includes(x.toran.state) ? leadButton(csrf, x.id, 'build-toran', LEADS.reread) : '',
    x.links.toranPage ? `<a class="button" href="${esc(x.links.toranPage)}">${esc(LEADS.openToranLead)}</a>` : '',
  ].join('');
  const tederActs = !x.tederOk ? `<p class="muted">${esc(LEADS.tederUnknown)}</p>` : x.links.tederLead ? ext(x.links.tederLead, esc(LEADS.openTederLead), 'button') : '';
  return `<article class="card" id="demos"><h3>${esc(LEADS.demosTitle)}</h3>
${make ? `<div class="make-row">${make}</div>` : ''}
<div class="demo-pair">${demoBox('toran', x.toran, toranActs)}${demoBox('teder', x.teder, tederActs)}</div>
${x.build.toranWhyNot ? `<p class="muted">${esc(x.build.toranWhyNot)}</p>` : ''}</article>`;
}

/** Where it stands: the dashboard's own buttons, for Toran's lead; skip; and the notes. */
function standsCard(csrf, x) {
  const ops = (action, label, fields = {}) => leadButton(csrf, x.id, action, label, 'quiet', fields);
  const lost = `<details class="lost"><summary>${esc(OPS.lost)}</summary><form method="post" action="/admin/leads/${x.id}/lost" class="inline">${csrfField(csrf)}<select name="reason" aria-label="${esc(OPS.lostWhy)}">${LOST_REASONS.map(
    (k) => `<option value="${k}">${esc(OPS.lostReasons[k])}</option>`
  ).join('')}</select><button class="danger">${esc(OPS.lostSave)}</button></form></details>`;
  const skip = `<details class="lost"><summary>${esc(LEADS.skip)}</summary><form method="post" action="/admin/leads/${x.id}/skip" class="inline">${csrfField(csrf)}<input type="text" name="reason" maxlength="300" placeholder="${esc(LEADS.skipReason)}" aria-label="${esc(LEADS.skipReason)}"><button class="danger">${esc(LEADS.skip)}</button></form></details>`;
  return `<article class="card" id="stands"><h3>${esc(LEADS.standsTitle)} ${whereTag(x.where)}</h3>
<div class="op-more">${ops('replied', LEADS.replied)}${ops('later', LEADS.tomorrow, { days: 1 })}${ops('later', LEADS.inAWeek, { days: 7 })}${lost}${skip}</div>
<form method="post" action="/admin/leads/${x.id}/notes" class="notes-form">${csrfField(csrf)}<label>${esc(LEADS.notesTitle)}<textarea name="notes" rows="3" dir="auto" maxlength="4000">${esc(x.notes)}</textarea></label><button class="quiet">${esc(LEADS.notesSave)}</button></form></article>`;
}

function contactCard(x, at) {
  const c = x.contact;
  const lines = [
    c.whatsapp ? `<li>${esc(LEADS.contact.whatsapp)}: ${ext(`https://wa.me/${c.whatsapp}`, `<bdi class="ltr">+${esc(c.whatsapp)}</bdi>`)}</li>` : '',
    c.email ? `<li>${esc(LEADS.contact.email)}: ${ext(`mailto:${c.email}`, `<bdi class="ltr">${esc(c.email)}</bdi>`)}</li>` : '',
    c.phone ? `<li>${esc(LEADS.contact.phone)}: <a href="tel:+${esc(c.phone)}"><bdi class="ltr">+${esc(c.phone)}</bdi></a></li>` : '',
  ].join('');
  return `<article class="card" id="contact"><h3>${esc(LEADS.contactTitle)}</h3>
<ul class="people">${lines || `<li class="bad">${esc(LEADS.noContact)}</li>`}</ul>
<p class="muted">${esc(LEADS.opens(x.opens))}${x.demoStartedAt ? ` · ${esc(LEADS.demoStarted)} ${esc(agoHe(x.demoStartedAt, at))}` : ''}</p></article>`;
}

/** One lead's page: what to send (the main action), the two demos, where it stands, the details. */
export function leadPage({ csrf, flash = '', flashBad = false, result, at }) {
  const top = `${adminTop({ csrf, tab: 'leads' })}
${flashLine(flash, flashBad)}
<p><a href="/admin/leads">← ${esc(LEADS.back)}</a></p>`;
  if (!result.ok) return `${top}${result.why === 'none' ? empty(LEADS.notFound, '') : empty(LEADS.down, result.why === 'not_configured' ? LEADS.notConfigured : LEADS.downLead)}`;
  const x = result.lead;
  return `${top}
<section id="lead"><div class="list-h"><h2>${esc(x.name)}</h2><p class="muted">${x.url ? ext(x.url, `<bdi class="ltr">${esc(x.domain)}</bdi>`) : `<bdi class="ltr">${esc(x.domain)}</bdi>`} ${demoTag('toran', x.toran)} ${demoTag('teder', x.teder)}</p></div>
<div class="ops-cards lead-cards">
${sendCard(csrf, x)}
${demosCard(csrf, x)}
${standsCard(csrf, x)}
${contactCard(x, at)}
</div>
</section>`;
}

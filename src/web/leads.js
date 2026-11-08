import { LEADS, OPS, PRODUCT_NAMES, agoHe, stampHe } from './copy.js';
import { adminTop, button, csrfField, esc, productMark } from './html.js';
import { LOST_REASONS, WHERE } from './toran.js';

// The shared lead dashboard, /admin/leads (the owner, 2026-11-08: "make the shared lead dashboard be in the admin
// dashboard, not in one of the products"): one list of the stores we may sell to, with what Toran and Teder each have
// for them, and one page a lead where both demos are built and the message goes, as one with both demos or one each.
// Toran gives the data and does every action (GET/POST /internal/leads, docs/contracts/admin-leads.json; its
// src/ops/leadsAdmin.ts); the status buttons are the dashboard's own (/internal/ops). Every button is a plain form that
// comes back to the lead's page with Toran's line at the top.

const ext = (href, inner, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
const flashLine = (flash, bad) => (flash ? `<p class="flash${bad ? ' bad' : ''}" role="${bad ? 'alert' : 'status'}">${esc(flash)}</p>` : '');
const empty = (title, lead) => `<div class="card empty"><b>${esc(title)}</b><p>${esc(lead)}</p></div>`;

/** A product's demo in one short tag: "תורן: מוכן", "תדר: נשלח". */
function demoTag(product, d) {
  const said = d.sentAt ? LEADS.sentShort : LEADS.state[d.state] || LEADS.state.none;
  return `<span class="tag p-${product}${d.state === 'none' ? ' muted' : ''}">${esc(PRODUCT_NAMES[product])}: ${esc(said)}</span>`;
}

const whereTag = (w) => `<span class="tag">${esc(LEADS.where[w] || w)}</span>`;

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
  const rows = d.leads.length
    ? `<ul class="people leads-list">${d.leads
        .map(
          (x) => `<li><a class="who" href="/admin/leads/${esc(x.id)}"><b>${esc(x.name)}</b></a><bdi class="ltr muted">${esc(x.domain)}</bdi>${demoTag('toran', x.toran)}${demoTag('teder', x.teder)}<span class="end">${whereTag(x.where)}</span></li>`
        )
        .join('')}</ul>`
    : empty(LEADS.none, LEADS.noneLead);
  const only = d.tederOnly.length
    ? `<details class="card no-contact"><summary>${esc(LEADS.tederOnly(d.tederOnly.length))}</summary><ul class="people">${d.tederOnly
        .map((x) => `<li>${x.leadUrl ? ext(x.leadUrl, `<b>${esc(x.name)}</b>`, 'who') : `<b class="who">${esc(x.name)}</b>`}<bdi class="ltr muted">${esc(x.domain)}</bdi>${demoTag('teder', x.teder)}<span class="end">${whereTag(x.where)}</span></li>`)
        .join('')}</ul><p class="muted">${esc(LEADS.tederOnlyHint)}</p></details>`
    : '';
  return `${top}
<section id="leads"><div class="list-h"><h2>${esc(LEADS.title)}</h2><p class="muted">${esc(LEADS.lead)}</p></div>
<nav class="tabs lead-tabs" aria-label="${esc(LEADS.title)}">${['', ...WHERE].map(tab).join('')}</nav>
<form class="row lead-search" method="get" action="/admin/leads">${where ? `<input type="hidden" name="where" value="${esc(where)}">` : ''}<input type="search" name="q" value="${esc(q)}" maxlength="100" placeholder="${esc(LEADS.search)}" aria-label="${esc(LEADS.search)}"><button class="quiet">${esc(LEADS.searchGo)}</button></form>
${d.teder.ok ? '' : `<p class="muted note">${esc(LEADS.tederDown)}</p>`}
${rows}
${only}
</section>`;
}

/** A button of the lead's page: to /admin/leads/<id>/<action>, back to the page. */
const leadButton = (csrf, id, action, label, kind = '', fields = {}) => button(`/admin/leads/${id}/${action}`, label, csrf, { kind, fields });

function sendCard(csrf, x, at) {
  const s = x.send;
  let body;
  if (s.options.length) {
    // One main button (the message with both demos when both can go), the others quiet beside it.
    const label = (o) => (o === 'both' ? (s.stage === 'reminder' ? LEADS.sendBothReminder : LEADS.sendBoth) : o === 'toran' ? LEADS.sendToran(s.options.includes('both')) : LEADS.sendTeder(s.options.includes('both')));
    const text = s.main === 'both' ? s.bothText : s.main === 'toran' ? s.toranText : null;
    body = `${text ? `<blockquote class="msg">${esc(text)}</blockquote>` : ''}
<div class="op-acts">${s.options.map((o) => leadButton(csrf, x.id, `send-${o}`, label(o), o === s.main ? 'primary' : '')).join('')}</div>
<p class="muted">${esc(LEADS.sendNote)}</p>`;
  } else if (s.waitingUntil) {
    body = `<p>${esc(LEADS.waiting(stampHe(s.waitingUntil)))}</p>`;
  } else if (s.toranText) {
    // Our number cannot send to them: the text to copy, the chat to open, and then "sent" marked by hand.
    const id = `lead-msg-${x.id}`;
    body = `<p class="muted">${esc(LEADS.notPitchable)}</p><textarea id="${id}" rows="6" dir="rtl" aria-label="${esc(OPS.message)}">${esc(s.toranText)}</textarea>
<div class="op-acts">${s.copy ? `<a class="button primary" href="${esc(s.copy.href)}" target="_blank" rel="noopener" data-copy="#${id}" data-done="${esc(OPS.copied)}" data-fail="${esc(OPS.copyFailed)}">${esc(s.copy.label || LEADS.copyOpen)}</a>` : ''}${leadButton(csrf, x.id, x.toran.sentAt ? 'mark-reminded' : 'mark-sent', x.toran.sentAt ? LEADS.markReminded : LEADS.markSent, s.copy ? '' : 'primary')}</div>`;
  } else {
    body = `<p class="muted">${esc(x.toran.reminderSentAt ? LEADS.sendDone : LEADS.sendNothing)}</p>`;
  }
  return `<article class="card" id="send"><h3>${esc(LEADS.sendTitle)}</h3>${body}</article>`;
}

function demoBox(product, d, extra) {
  const state = d.sentAt ? `${LEADS.sentShort}${d.reminderSentAt ? ' · ' : ''}${d.reminderSentAt ? esc(LEADS.markReminded) : ''}` : LEADS.state[d.state];
  return `<div class="demo-box"><header class="op-who">${productMark(product)}<div><h3>${esc(PRODUCT_NAMES[product])}</h3><small>${esc(state)}${d.error ? ` · ${esc(d.error)}` : ''}</small></div></header>
${d.pageUrl ? `<p>${ext(d.pageUrl, `${esc(LEADS.openPage)} <bdi class="ltr">↗</bdi>`)}</p>` : ''}
<div class="op-acts">${extra}</div></div>`;
}

function demosCard(csrf, x) {
  const b = x.build;
  const both = b.both ? leadButton(csrf, x.id, 'build-both', LEADS.buildBoth, 'primary') : '';
  const toranActs = [
    x.toran.state === 'review' && x.links.toranReview ? `<a class="button${both ? '' : ' primary'}" href="${esc(x.links.toranReview)}">${esc(LEADS.review)}</a>` : '',
    b.toran && x.toran.state !== 'building' ? leadButton(csrf, x.id, 'build-toran', LEADS.buildToran(x.toran.state !== 'none'), both || x.toran.state !== 'none' ? 'quiet' : 'primary') : '',
    x.links.toranPage ? `<a class="button quiet" href="${esc(x.links.toranPage)}">${esc(LEADS.openToranLead)}</a>` : '',
  ].join('');
  const tederActs = !x.tederOk
    ? `<p class="muted">${esc(LEADS.tederUnknown)}</p>`
    : [
        b.teder ? leadButton(csrf, x.id, 'build-teder', x.teder.state === 'failed' ? LEADS.buildTederAgain : LEADS.buildTeder, both ? 'quiet' : x.toran.state === 'none' ? '' : 'primary') : '',
        x.links.tederLead ? ext(x.links.tederLead, esc(LEADS.openTederLead), 'button quiet') : '',
      ].join('');
  return `<article class="card" id="demos"><h3>${esc(LEADS.demosTitle)}</h3>
${both ? `<div class="op-acts">${both}</div>` : ''}
<div class="demo-pair">${demoBox('toran', x.toran, toranActs)}${demoBox('teder', x.teder, tederActs)}</div>
${b.toranWhyNot ? `<p class="muted">${esc(b.toranWhyNot)}</p>` : ''}</article>`;
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
    c.phone ? `<li>${esc(LEADS.contact.phone)}: <bdi class="ltr">+${esc(c.phone)}</bdi></li>` : '',
  ].join('');
  return `<article class="card" id="contact"><h3>${esc(LEADS.contactTitle)}</h3>
<ul class="people">${lines || `<li class="muted">${esc(LEADS.noContact)}</li>`}</ul>
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
${sendCard(csrf, x, at)}
${demosCard(csrf, x)}
${standsCard(csrf, x)}
${contactCard(x, at)}
</div>
</section>`;
}

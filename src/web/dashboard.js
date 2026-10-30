import { opsCustomersStage, opsMoney } from '../accounts/ops.js';
import { OPS, PRODUCT_NAMES, agoHe, dayHe, ils, stampHe } from './copy.js';
import { adminTop, csrfField, esc, productMark } from './html.js';
import { LOST_REASONS } from './toran.js';

// The operator's dashboard, /admin: who to write to today about Toran or Teder, with the message ready; who asked
// for a demo and has nothing to send yet; who is in a conversation; each product's funnel; the customers and the
// money. Toran gives the first four (GET /internal/ops, src/web/toran.js); the money and the funnels' last stage are
// ours, from the subscriptions (src/accounts/ops.js). Ported from Toran's src/web/pages/ops.ts, in accounts' look.
//
// Every button is a plain form that posts to /admin/ops/... and comes back here with a line at the top. With
// static/admin.js, "copy and open" copies the message first, and the forms marked data-ajax post in the background:
// the card goes away and the line shows at the bottom of the screen.

const SHOWN = 25;

const productTag = (p) => `<span class="tag p-${p}">${esc(PRODUCT_NAMES[p])}</span>`;
const ext = (href, inner, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;

/** One action, as a one-button form: to /admin/ops/<kind>/<id>/<action>, back to `back` without script. */
function act(csrf, x, action, label, { kind = '', fields = {}, ajax = 'remove', back = 'contact' } = {}) {
  return `<form method="post" action="/admin/ops/${x.product}/${encodeURIComponent(x.id)}/${action}" class="inline" data-ajax="${ajax}">${csrfField(csrf)}<input type="hidden" name="back" value="${back}">${Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')}<button${kind ? ` class="${kind}"` : ''}>${esc(label)}</button></form>`;
}

// "Not interested" asks why first: the reasons open under its own button, and the choice is saved beside them.
const lostForm = (csrf, x, back) =>
  `<details class="lost"><summary>${esc(OPS.lost)}</summary><form method="post" action="/admin/ops/${x.product}/${encodeURIComponent(x.id)}/lost" class="inline" data-ajax="remove">${csrfField(csrf)}<input type="hidden" name="back" value="${back}"><select name="reason" aria-label="${esc(OPS.lostWhy)}">${LOST_REASONS.map(
    (k) => `<option value="${k}">${esc(OPS.lostReasons[k])}</option>`
  ).join('')}</select><button class="danger">${esc(OPS.lostSave)}</button></form></details>`;

/** The next step: what, and when; it reloads the page, where the card moves to its new place. */
const nextForm = (csrf, x, text, back) =>
  `<form method="post" action="/admin/ops/${x.product}/${encodeURIComponent(x.id)}/next" class="next-form" data-ajax="reload">${csrfField(csrf)}<input type="hidden" name="back" value="${back}"><input type="text" name="text" maxlength="300" required value="${esc(text || '')}" placeholder="${esc(OPS.nextPlaceholder)}" aria-label="${esc(OPS.nextLabel)}"><select name="days" aria-label="${esc(OPS.nextWhen)}">${Object.entries(
    OPS.nextDays
  )
    .map(([d, label]) => `<option value="${d}">${esc(label)}</option>`)
    .join('')}</select><button>${esc(OPS.nextSave)}</button></form>`;

const who = (x, sub, extra = '') => {
  const href = x.leadUrl || x.page;
  const name = href ? ext(href, esc(x.name)) : esc(x.name);
  return `<header class="op-who">${productMark(x.product)}<div><h3>${name} ${productTag(x.product)}${extra}</h3><small>${sub}</small></div></header>`;
};

function card(csrf, it, at) {
  const msgId = `msg-${it.product}-${it.id.replace(/[^\w-]/g, '_')}`;
  const sub = [esc(it.why), it.at ? esc(agoHe(it.at, at)) : '', it.domain ? `<bdi class="ltr">${esc(it.domain)}</bdi>` : ''].filter(Boolean).join(' · ');
  const body = it.message ? `<textarea id="${msgId}" rows="6" dir="rtl" aria-label="${esc(OPS.message)}">${esc(it.message)}</textarea>` : '';
  let buttons;
  if (it.mark === 'next') {
    buttons = `<div class="op-acts">${it.target.href ? ext(it.target.href, esc(OPS.openChat), 'button') : ''}</div>${nextForm(csrf, it, null, 'contact')}<div class="op-more">${lostForm(csrf, it, 'contact')}</div>`;
  } else {
    const label = esc(it.target.label || (it.target.href ? OPS.copyOpen : OPS.copy));
    const kind = it.direct ? '' : ' primary';
    // Without script the link still opens the chat; with it, the message is copied first.
    const copy = it.message
      ? it.target.href
        ? `<a class="button${kind}" href="${esc(it.target.href)}" target="_blank" rel="noopener" data-copy="#${msgId}" data-done="${esc(OPS.copied)}" data-fail="${esc(OPS.copyFailed)}">${label}</a>`
        : `<button type="button" class="js-only${kind}" data-copy="#${msgId}" data-done="${esc(OPS.copied)}" data-fail="${esc(OPS.copyFailed)}">${label}</button>`
      : it.target.href
        ? ext(it.target.href, esc(OPS.openChat), `button${kind}`)
        : '';
    buttons = `<div class="op-acts">${it.direct ? act(csrf, it, 'direct', OPS.direct, { kind: 'primary' }) : ''}${copy}${act(csrf, it, it.mark, OPS.sent)}</div>
<div class="op-more">${act(csrf, it, 'replied', OPS.replied, { kind: 'quiet' })}${act(csrf, it, 'later', OPS.tomorrow, { kind: 'quiet', fields: { days: 1 } })}${act(csrf, it, 'later', OPS.inAWeek, { kind: 'quiet', fields: { days: 7 } })}${lostForm(csrf, it, 'contact')}</div>`;
  }
  return `<article class="op" data-item>
${who(it, sub)}
${body}
${buttons}
</article>`;
}

/**
 * Someone who asked for a demo on the website and has no link to get yet: a request with nothing to send (stuck), or a
 * Teder demo that failed. Why, since when, and Toran's message for it, to copy and send to the number that asked. No
 * "sent" here: it is a request, not a lead with an outreach. `name` is the escaped title, `note` a line under it.
 */
function askedCard(x, at, msgId, { name, phone, note = '' }) {
  const sub = [esc(x.why), x.at ? esc(OPS.stuckAsked(agoHe(x.at, at))) : '', phone ? `<bdi class="ltr">+${esc(phone)}</bdi>` : ''].filter(Boolean).join(' · ');
  const head = `<header class="op-who">${x.product ? productMark(x.product) : ''}<div><h3>${x.leadUrl ? ext(x.leadUrl, name) : name}${x.product ? ` ${productTag(x.product)}` : ''}</h3><small>${sub}</small></div></header>`;
  const chat = x.target.href || (phone ? `https://wa.me/${phone}` : null);
  const button = x.message
    ? chat
      ? `<a class="button primary" href="${esc(chat)}" target="_blank" rel="noopener" data-copy="#${msgId}" data-done="${esc(OPS.copied)}" data-fail="${esc(OPS.copyFailed)}">${esc(x.target.label || OPS.copyOpen)}</a>`
      : `<button type="button" class="js-only primary" data-copy="#${msgId}" data-done="${esc(OPS.copied)}" data-fail="${esc(OPS.copyFailed)}">${esc(OPS.copy)}</button>`
    : chat
      ? ext(chat, esc(OPS.openChat), 'button')
      : '';
  return `<article class="op" data-item>
${head}
${note ? `<p class="muted op-note">${esc(note)}</p>` : ''}
${x.message ? `<textarea id="${msgId}" rows="4" dir="rtl" aria-label="${esc(OPS.message)}">${esc(x.message)}</textarea>` : ''}
<div class="op-acts">${button}</div>
</article>`;
}

const stuckCard = (x, at, i) => askedCard(x, at, `stuck-${i}`, { name: `<bdi class="ltr">${esc(x.domain)}</bdi>`, phone: x.phone });

/**
 * Teder's demos that are not up yet: a failed one is a card with Teder's reason and the message to the number that asked;
 * the rest (building, waiting for the check in Teder) one line each. Every name opens the demo in Teder.
 */
function tederSection(list, at) {
  if (!list.length) return '';
  const nameOf = (x) => `${esc(x.name)}${x.name !== x.domain ? ` <bdi class="ltr muted">${esc(x.domain)}</bdi>` : ''}`;
  const failed = list.filter((x) => x.status === 'failed');
  const rest = list.filter((x) => x.status !== 'failed');
  const row = (x) =>
    `<li>${x.leadUrl ? ext(x.leadUrl, `<b>${esc(x.name)}</b>`, 'who') : `<b class="who">${esc(x.name)}</b>`}<span class="tag">${esc(x.why)}</span><span class="muted">${x.at ? esc(OPS.stuckAsked(agoHe(x.at, at))) : ''}${x.whatsapp ? ` · <bdi class="ltr">+${esc(x.whatsapp)}</bdi>` : ''}</span></li>`;
  return `<section id="teder-demos"><div class="list-h"><h2>${esc(OPS.tederDemosTitle)}</h2><p class="muted">${esc(OPS.tederDemosHint)}</p></div>
${failed.length ? `<div class="ops-cards">${failed.map((x, i) => askedCard({ ...x, product: 'teder' }, at, `teder-demo-${i}`, { name: nameOf(x), phone: x.whatsapp, note: x.error || '' })).join('')}</div>` : ''}
${rest.length ? `<ul class="people teder-demos">${rest.map(row).join('')}</ul>` : ''}
</section>`;
}

function conversation(csrf, c, at) {
  const due = c.next_step_at && Date.parse(c.next_step_at) <= at;
  const step = c.next_step_at ? `${due ? '<b>' : ''}${esc(OPS.nextAt(stampHe(c.next_step_at), c.next_step))}${due ? '</b>' : ''}` : c.next_step ? esc(c.next_step) : '';
  const sub = [c.replied_at ? esc(OPS.repliedAgo(agoHe(c.replied_at, at))) : '', step].filter(Boolean).join(' · ');
  const won =
    c.product === 'toran'
      ? `${c.status !== 'pilot' ? act(csrf, c, 'pilot', OPS.pilot, { ajax: 'reload', back: 'talking' }) : ''}${act(csrf, c, 'paid', OPS.paid, { back: 'talking' })}`
      : act(csrf, c, 'won', OPS.won, { back: 'talking' });
  return `<article class="op" data-item>
${who(c, sub, c.status === 'pilot' ? ` <span class="tag">${esc(OPS.inPilot)}</span>` : '')}
${c.target.href ? `<div class="op-acts">${ext(c.target.href, esc(OPS.openChat), 'button')}</div>` : ''}
${nextForm(csrf, c, c.next_step, 'talking')}
<div class="op-more">${won}${lostForm(csrf, c, 'talking')}</div>
</article>`;
}

/** The rate from the stage before, as a whole percent, or null when the stage before is empty (Toran's rate()). */
export const rate = (stages, i, k) => (i > 0 && stages[i - 1][k] ? Math.round((100 * stages[i][k]) / stages[i - 1][k]) : null);

/** Toran's stages, with the last one, the customers, counted here. */
export function withCustomers(stages, product, customers) {
  return stages.map((s) => (s.key === 'customers' ? { ...s, ...(customers ? opsCustomersStage(customers.workspaces, product, customers.today) : { all: s.all ?? 0, month: s.month ?? 0 }) } : { ...s, all: s.all ?? 0, month: s.month ?? 0 }));
}

function funnelTable(product, stages) {
  const pct = (n) => (n == null ? '' : ` <small class="pct">${n}%</small>`);
  return `<section class="card funnel"><header class="op-who">${productMark(product)}<h3>${esc(PRODUCT_NAMES[product])}</h3></header>
<table><thead><tr><th scope="col">${esc(OPS.funnelStage)}</th><th scope="col">${esc(OPS.funnelAll)}</th><th scope="col">${esc(OPS.funnelMonth)}</th></tr></thead><tbody>${stages
    .map((s, i) => `<tr><th scope="row">${esc(s.label)}</th><td><b>${s.all}</b>${pct(rate(stages, i, 'all'))}</td><td><b>${s.month}</b>${pct(rate(stages, i, 'month'))}</td></tr>`)
    .join('')}</tbody></table></section>`;
}

/**
 * One line on our number (Toran's demoLine): connected, and through what; or not yet, and then sending from it and the
 * links that go by themselves wait. Nothing from a Toran that does not say.
 */
function numberLine(line) {
  if (!line) return '';
  if (!line.live) return `<p class="number-line off" role="note">${esc(OPS.numberOff)}</p>`;
  if (line.via === 'sim') return `<p class="number-line" role="note">${esc(OPS.numberSim)}</p>`;
  return `<p class="number-line ok" role="note">${esc(OPS.numberLive({ meta: 'Meta', twilio: 'Twilio' }[line.via]))}${line.number ? ` <bdi class="ltr">+${esc(line.number)}</bdi>` : ''}</p>`;
}

const down = (toran) =>
  `<div class="card empty" role="note"><b>${esc(OPS.toranDown)}</b><p>${esc(toran.why === 'not_configured' ? OPS.toranNotConfigured : OPS.toranDownLead(toran.base))}</p></div>`;
const empty = (title, lead) => `<div class="card empty"><b>${esc(title)}</b><p>${esc(lead)}</p></div>`;
const wsLink = (w) => `<a href="/admin/accounts#ws-${esc(w.id)}">${esc(w.name)}</a>`;

function moneyPanel(m) {
  const list = (title, rows, none) =>
    `<section class="card money-list"><h3>${esc(title)}</h3>${rows.length ? `<ul class="people">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` : `<p class="muted">${esc(none)}</p>`}</section>`;
  // The lines are built from the escaped pieces: a name is a link, the rest is text.
  const line = (fn, ...args) => fn(...args.map((a) => (a && a.html ? a.html : esc(a))));
  const P = (p) => PRODUCT_NAMES[p] || p;
  return `<div class="kpis money">
<div class="kpi"><span class="l">${esc(OPS.mrr)}</span><span class="v">${esc(ils(m.mrr))}</span><span class="s">${esc(OPS.mrrSub)}</span></div>
<div class="kpi"><span class="l">${esc(OPS.paying)}</span><span class="v">${m.paying.toran + m.paying.teder}</span><span class="s">${esc(OPS.payingSub(m.paying.toran, m.paying.teder))}</span></div>
<div class="kpi${m.late.length ? ' bad' : ''}"><span class="l">${esc(OPS.late)}</span><span class="v">${m.late.length}</span><span class="s">${esc(OPS.lateSub)}</span></div>
</div>
<div class="money-lists">
${list(OPS.lateTitle, m.late.map((x) => line(OPS.lateLine, { html: wsLink(x.w) }, P(x.product), ils(x.monthly), x.since ? dayHe(x.since) : '')), OPS.lateNone)}
${list(OPS.waitingTitle, m.waiting.map((x) => line(OPS.waitingLine, { html: wsLink(x.w) }, P(x.product), ils(x.monthly), x.setup ? ils(x.setup) : '')), OPS.waitingNone)}
${list(OPS.renewTitle, m.renewals.map((x) => line(OPS.renewLine, dayHe(x.on), { html: wsLink(x.w) }, P(x.product), ils(x.monthly))), OPS.renewNone)}
</div>
<p class="muted">${esc(OPS.moneyNote)} <a href="/admin/accounts">${esc(OPS.moneyManage)}</a></p>`;
}

/**
 * The page. `toran` is toranClient().ops() with its base: { ok, data } or { ok: false, why, base }. `customers` is
 * opsCustomers(db). `at` is now, in ms.
 */
export function dashboardPage({ csrf, flash = '', flashBad = false, toran, customers, at, viewAs = false }) {
  const top = `${adminTop({ csrf, tab: 'today' })}
${flash ? `<p class="flash${flashBad ? ' bad' : ''}" role="${flashBad ? 'alert' : 'status'}">${esc(flash)}</p>` : ''}
<p class="toast" id="toast" role="status" aria-live="polite" data-offline="${esc(OPS.offline)}" data-unexpected="${esc(OPS.unexpected)}"></p>`;
  if (viewAs) return `${top}${empty(OPS.viewAsClosed, '')}`;

  const d = toran.ok ? toran.data : null;
  const m = opsMoney(customers.workspaces, customers.today);
  const funnels = d ? { toran: withCustomers(d.funnels.toran, 'toran', customers), teder: withCustomers(d.funnels.teder, 'teder', customers) } : null;
  const replied = funnels ? ['toran', 'teder'].reduce((n, p) => n + (funnels[p].find((s) => s.key === 'replied')?.month || 0), 0) : null;
  const items = d ? d.items : [];
  const shown = items.slice(0, SHOWN);
  // A count in its colour when it is not zero; a question mark when Toran did not answer.
  const cnt = (n, cls, shown = n) => (n == null ? `<span class="cnt">${esc(OPS.unknown)}</span>` : `<span class="cnt${n ? ` ${cls}` : ''}">${esc(shown)}</span>`);

  const kpis = `<div class="kpis top-kpis">
<a class="kpi lead" href="#contact"><span class="l">${esc(OPS.kpiContact)}</span><span class="v">${d ? items.length : esc(OPS.unknown)}</span><span class="s">${esc(d ? OPS.kpiContactSub(items.length) : OPS.toranDown)}</span></a>
<a class="kpi" href="#talking"><span class="l">${esc(OPS.kpiTalking)}</span>${cnt(d ? d.conversations.length : null, 'sig')}</a>
<a class="kpi" href="#money"><span class="l">${esc(OPS.kpiMrr)}</span>${cnt(m.mrr, 'ok', ils(m.mrr))}</a>
<a class="kpi" href="#money"><span class="l">${esc(OPS.kpiLate)}</span>${cnt(m.late.length, 'bad')}</a>
<a class="kpi" href="#funnel"><span class="l">${esc(OPS.kpiReplied)}</span>${cnt(replied, 'ok')}</a>
</div>`;

  const contact = !d
    ? down(toran)
    : `${shown.length ? `<div class="ops-cards">${shown.map((it) => card(csrf, it, at)).join('')}</div>${items.length > SHOWN ? `<p class="muted more">${esc(OPS.contactMore(items.length - SHOWN))}</p>` : ''}` : empty(OPS.contactEmpty, OPS.contactEmptyLead)}
${d.noContact.length ? `<details class="card no-contact"><summary>${esc(OPS.noContact(d.noContact.length))}</summary><ul class="people">${d.noContact
          .slice(0, 30)
          .map((s) => `<li>${s.leadUrl ? ext(s.leadUrl, `<b>${esc(s.name)}</b>`, 'who') : `<b class="who">${esc(s.name)}</b>`}<bdi class="ltr muted">${esc(s.domain)}</bdi>${s.score != null ? `<span class="muted end">${esc(OPS.score(s.score))}</span>` : ''}</li>`)
          .join('')}</ul><p class="muted">${esc(OPS.noContactHint)}</p></details>` : ''}`;

  const stuck = d?.stuck.length
    ? `<section id="stuck"><div class="list-h"><h2>${esc(OPS.stuckTitle)}</h2><p class="muted">${esc(OPS.stuckHint)}</p></div><div class="ops-cards">${d.stuck.map((x, i) => stuckCard(x, at, i)).join('')}</div></section>`
    : '';

  const teder = d ? tederSection(d.tederDemos, at) : '';
  const talking = !d ? down(toran) : d.conversations.length ? `<div class="ops-cards">${d.conversations.map((c) => conversation(csrf, c, at)).join('')}</div>` : empty(OPS.talkingEmpty, OPS.talkingEmptyLead);
  const funnel = funnels ? `<div class="funnels">${funnelTable('toran', funnels.toran)}${funnelTable('teder', funnels.teder)}</div><p class="muted">${esc(OPS.funnelNote)}</p>` : down(toran);

  return `${top}
${d ? numberLine(d.demoLine) : ''}
${kpis}
${d && !d.teder.ok ? `<p class="muted note">${esc(OPS.tederStale)}</p>` : ''}
<section id="contact"><div class="list-h"><h2>${esc(OPS.contactTitle)}</h2><p class="muted">${esc(OPS.contactOrder)}</p></div>
${contact}
</section>
${stuck}
${teder}
<section id="talking"><div class="list-h"><h2>${esc(OPS.talkingTitle)}</h2></div>
${talking}
</section>
<section id="funnel"><div class="list-h"><h2>${esc(OPS.funnelTitle)}</h2></div>
${funnel}
</section>
<section id="money"><div class="list-h"><h2>${esc(OPS.moneyTitle)}</h2></div>
${moneyPanel(m)}
</section>`;
}

// /admin/waitlist: everyone on Toran's waitlist (the website's leads, openfrequency-web server/lead.mjs), and a message
// to them. The website keeps the list and sends the emails, each with its own link to leave the list; a phone can't
// be written to from here (WhatsApp needs an approved template for that), so after a message each phone gets a wa.me
// link with the same text, for the operator to send from their own WhatsApp.
//
//   GET  <OF_SITE_INTERNAL>/internal/waitlist        { waitlist: [{ id, contact, store, createdAt }] }
//   POST <OF_SITE_INTERNAL>/internal/waitlist/send   { subject, text } -> { emails, phones }
//
// The website's lead service is on this machine, at OF_SITE_INTERNAL (default http://127.0.0.1:4720), under the same
// OF_INTERNAL_TOKEN. It fails soft, as toran.js does.
import { WAIT, agoHe } from './copy.js';
import { PLANS } from '../accounts/subscriptions.js';
import { adminTop, csrfField, esc } from './html.js';

export const SITE_INTERNAL = 'http://127.0.0.1:4720';
const contactOf = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{10,15}$/.test(s) || (s.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:/]+\.[^\s@<>()",;:/]+$/.test(s)) ? s : null;
};

export function siteClient({ env = process.env, fetchImpl = globalThis.fetch, log = console.error } = {}) {
  const base = (String(env.OF_SITE_INTERNAL || '').trim() || SITE_INTERNAL).replace(/\/+$/, '');
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  async function call(method, path, body, ms) {
    if (token.length < 32) return { status: 0, json: null };
    try {
      const r = await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(ms),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch (e) {
      log(`[accounts] site ${method} ${path}: ${e?.name === 'TimeoutError' ? 'timed out' : e?.cause?.code || e?.message}`);
      return { status: 0, json: null };
    }
  }
  return {
    /** The list, newest first, or null when the website did not answer. */
    async waitlist() {
      const r = await call('GET', '/internal/waitlist', null, 3000);
      if (r.status !== 200 || !Array.isArray(r.json?.waitlist)) return null;
      return r.json.waitlist
        .map((x) => ({ contact: contactOf(x?.contact), store: typeof x?.store === 'string' ? x.store.slice(0, 253) : null, at: typeof x?.createdAt === 'string' ? x.createdAt : null }))
        .filter((x) => x.contact);
    },
    /** { ok: true, emails, phones } or { ok: false, error: 'again' | 'empty' | 'no_mail' | 'down' }. */
    async send(subject, text) {
      const r = await call('POST', '/internal/waitlist/send', { subject, text }, 10_000);
      if (r.status === 200 && r.json) return { ok: true, emails: Number(r.json.emails) || 0, phones: (Array.isArray(r.json.phones) ? r.json.phones : []).map(contactOf).filter(Boolean) };
      return { ok: false, error: ['again', 'empty', 'no_mail'].includes(r.json?.error) ? r.json.error : 'down' };
    },
  };
}

const waLink = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

/** The page. `list` is siteClient().waitlist(); `sent`, after a message, is { text, emails, phones }. */
export function waitlistPage({ csrf, list, at, flash = '', flashBad = false, sent = null, form = {} }) {
  const top = `${adminTop({ csrf, tab: 'waitlist' })}
${flash ? `<p class="flash${flashBad ? ' bad' : ''}" role="${flashBad ? 'alert' : 'status'}">${esc(flash)}</p>` : ''}`;
  const phonesAfter = sent?.phones.length
    ? `<section class="card"><h2>${esc(WAIT.phonesTitle(sent.phones.length))}</h2><p class="muted">${esc(WAIT.phonesLead)}</p><ul class="people">${sent.phones
        .map((p) => `<li><bdi class="ltr who">+${esc(p)}</bdi><a class="button end" href="${esc(waLink(p, sent.text))}" target="_blank" rel="noopener">${esc(WAIT.phoneSend)}</a></li>`)
        .join('')}</ul></section>`
    : '';
  if (!list) return `${top}${phonesAfter}<div class="card empty" role="note"><b>${esc(WAIT.down)}</b></div>`;
  const emails = list.filter((x) => x.contact.includes('@')).length;
  const people = list.length
    ? `<ul class="people">${list
        .map((x) => {
          const phone = !x.contact.includes('@');
          const href = phone ? `https://wa.me/${x.contact}` : `mailto:${x.contact}`;
          return `<li><a class="who" href="${esc(href)}" target="_blank" rel="noopener"><bdi class="ltr">${esc(phone ? `+${x.contact}` : x.contact)}</bdi></a>${x.store ? `<bdi class="ltr muted">${esc(x.store)}</bdi>` : ''}${x.at ? `<span class="muted end">${esc(WAIT.at(agoHe(x.at, at)))}</span>` : ''}</li>`;
        })
        .join('')}</ul>`
    : `<p class="muted">${esc(WAIT.none)}</p>`;
  const compose = list.length
    ? `<form class="card stack" method="post" action="/admin/waitlist/send">${csrfField(csrf)}
<h2>${esc(WAIT.composeTitle)}</h2>
<p class="muted">${esc(WAIT.composeLead(emails, list.length - emails))}</p>
<label for="w-subject">${esc(WAIT.subject)}</label>
<input id="w-subject" name="subject" required maxlength="150" value="${esc('subject' in form ? form.subject : sent ? '' : WAIT.draftSubject)}" aria-describedby="w-subject-hint">
<small id="w-subject-hint">${esc(WAIT.subjectHint)}</small>
<label for="w-text">${esc(WAIT.text)}</label>
<textarea id="w-text" name="text" required maxlength="5000" rows="7" aria-describedby="w-text-hint">${esc('text' in form ? form.text : sent ? '' : WAIT.draftText(PLANS.toran.store, PLANS.toran.big))}</textarea>
<small id="w-text-hint">${esc(WAIT.textHint)}</small>
<button class="primary">${esc(WAIT.send)}</button>
</form>`
    : '';
  return `${top}
${phonesAfter}
<section id="waitlist"><div class="list-h"><h2>${esc(WAIT.title(list.length))}</h2><p class="muted">${esc(WAIT.lead)}</p></div>
<div class="card">${people}</div>
</section>
${compose}`;
}

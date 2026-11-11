// What /admin reads from Toran and sends to it, for the operator's dashboard (Toran's docs/operator.md, section 4):
//
//   GET  /internal/ops                              who to write to today, who is in a conversation, the funnels
//   POST /internal/ops/<toran|teder>/<id>/<action>  what the operator did: sent, they answered, the next step...
//
// Toran is on this machine, at OF_TORAN_INTERNAL (default http://127.0.0.1:4710), under the same OF_INTERNAL_TOKEN
// as our own internal listener. It fails soft: a Toran that does not answer (down, slow, the token unset) leaves its
// sections of the page saying so, and the rest of /admin works without it.

export const TORAN_INTERNAL = 'http://127.0.0.1:4710';
const MIN_TOKEN = 32;
const GET_MS = 3000;
const POST_MS = 15_000;

export const KINDS = ['toran', 'teder'];
/**
 * Every action Toran takes, and which product each is for (null: both). "direct" is both: Toran's demo, or Teder's asked
 * for with a code, inside its hours; Toran refuses the rest in its own words.
 */
export const ACTIONS = { sent: null, reminded: null, direct: null, replied: null, next: null, later: null, lost: null, reopen: null, pilot: 'toran', paid: 'toran', won: 'teder' };
export const LOST_REASONS = ['not_interested', 'price', 'has_solution', 'no_answer', 'not_fit', 'other'];
/** A lead's id as Toran gives it, safe in our path and in Toran's. */
export const ID = /^[\w.:-]{1,100}$/;

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
/** A link from Toran, only when it is a web, WhatsApp or mail address: nothing else reaches an href. */
export const safeHref = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^(https?:\/\/|mailto:)/i.test(s) ? s : null;
};
const target = (t) => ({ kind: str(t?.kind, 20), href: safeHref(t?.href), label: str(t?.label, 80) || '' });
const kindOf = (v) => (KINDS.includes(v) ? v : null);
const idOf = (v) => (v != null && ID.test(String(v)) ? String(v) : null);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Toran's answer, kept to the documented fields and checked: an entry that does not fit is left out. */
export function readOps(b) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const items = list(b.items)
    .map((x) => ({
      key: str(x.key, 120),
      product: kindOf(x.product),
      id: idOf(x.id),
      reason: str(x.reason, 40),
      name: str(x.name, 200) || str(x.domain, 200) || '',
      domain: str(x.domain, 200) || '',
      why: str(x.why, 300) || '',
      message: str(x.message),
      target: target(x.target),
      direct: x.direct === true,
      mark: ['sent', 'reminded', 'next'].includes(x.mark) ? x.mark : 'sent',
      page: safeHref(x.page),
      at: str(x.at, 40),
      leadUrl: safeHref(x.leadUrl),
    }))
    .filter((x) => x.product && x.id);
  const conversations = list(b.conversations)
    .map((x) => ({
      key: str(x.key, 120),
      product: kindOf(x.product),
      id: idOf(x.id),
      name: str(x.name, 200) || str(x.domain, 200) || '',
      domain: str(x.domain, 200) || '',
      replied_at: str(x.replied_at, 40),
      next_step: str(x.next_step, 300),
      next_step_at: str(x.next_step_at, 40),
      target: target(x.target),
      page: safeHref(x.page),
      status: str(x.status, 40) || '',
      leadUrl: safeHref(x.leadUrl),
    }))
    .filter((x) => x.product && x.id);
  const stages = (v) => list(v).map((s) => ({ key: str(s.key, 40) || '', label: str(s.label, 80) || '', all: num(s.all), month: num(s.month) }));
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 15) || null;
  const one = obj(b.ourNumber);
  const line = obj(b.demoLine);
  const site = obj(b.leads);
  // A website lead's phone (international digits) or email; anything else is left out.
  const contactOf = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^\d{10,15}$/.test(s) || (s.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:/]+\.[^\s@<>()",;:/]+$/.test(s)) ? s : null;
  };
  const siteLead = (x) => ({ id: num(x.id), store: str(x.store, 253), contact: contactOf(x.contact), page: str(x.page, 80), at: str(x.at, 40) });
  return {
    teder: { ok: b.teder?.ok !== false },
    items,
    noContact: list(b.noContact).map((x) => ({ id: idOf(x.id), name: str(x.name, 200) || str(x.domain, 200) || '', domain: str(x.domain, 200) || '', score: num(x.score), leadUrl: safeHref(x.leadUrl) })),
    // A request with nothing to send yet, with Toran's message for its reason (null when there is nothing to say).
    stuck: list(b.stuck).map((x) => ({ product: kindOf(x.product), domain: str(x.domain, 200) || '', phone: String(x.phone ?? '').replace(/\D/g, '').slice(0, 15), at: str(x.at, 40), why: str(x.why, 300) || '', storeId: num(x.storeId), message: str(x.message), target: target(x.target), leadUrl: safeHref(x.leadUrl) })),
    // The website's leads that reached the owner only by email (Toran reads the website's GET /internal/leads): Toran's
    // waitlist, and those no product took. null from a Toran that does not give them; ok false when it could not read them.
    leads: site ? { ok: site.ok === true, waitlist: list(site.waitlist).map(siteLead), failed: list(site.failed).map((x) => ({ ...siteLead(x), product: kindOf(x.product), source: str(x.source, 20) || '' })) } : null,
    // Every Teder demo not up yet (building, waiting for the check in Teder, failed with Teder's reason), each with its
    // page in Teder; a failed one with Toran's message to the number that asked.
    tederDemos: list(b.tederDemos)
      .map((x) => ({ id: idOf(x.id), domain: str(x.domain, 200) || '', name: str(x.name, 200) || str(x.domain, 200) || '', status: str(x.status, 40) || '', why: str(x.why, 300) || '', error: str(x.error, 1000), whatsapp: digits(x.whatsapp), at: str(x.at, 40), message: str(x.message), target: target(x.target), leadUrl: safeHref(x.leadUrl) }))
      .filter((x) => x.id),
    conversations,
    funnels: { toran: stages(b.funnels?.toran), teder: stages(b.funnels?.teder) },
    // Our one WhatsApp number, once our company store connected it (null before), and the demo number as it sends now:
    // through Meta, Twilio or the simulator, and whether that reaches anyone. null from a Toran that does not say.
    ourNumber: one ? { number: digits(one.number), status: str(one.status, 40) || '', roles: list(one.roles).map((r) => ({ key: str(r.key, 40) || '', he: str(r.he, 300) || '' })), leadUrl: safeHref(one.leadUrl) } : null,
    demoLine: line ? { live: line.live === true, via: ['meta', 'twilio', 'sim'].includes(line.via) ? line.via : null, number: digits(line.number) } : null,
    // One health row a customer's store (Toran's src/ops/health.ts, since 2026-11-08): [] from a Toran that does not
    // give them. A value this reader does not know is left out, never trusted.
    customers: list(b.customers)
      .map((x) => {
        const alert = obj(x.lastAlert);
        return {
          storeId: idOf(x.storeId),
          name: str(x.name, 200) || '',
          workspace: num(x.workspace),
          paid: x.paid === true,
          live: ['never', 'live', 'paused'].includes(x.live) ? x.live : null,
          channels: list(x.channels).map((c) => ({ channel: str(c.channel, 20) || '', kind: str(c.kind, 20) || '', status: str(c.status, 20) || '' })),
          plan: str(x.plan, 20) || '',
          conversations: num(x.conversations),
          cap: num(x.cap),
          waitingOverDay: num(x.waitingOverDay),
          spendUsd: num(x.spendUsd),
          capUsd: num(x.capUsd),
          lastAlert: alert ? { at: str(alert.at, 40), title: str(alert.title, 300) || '' } : null,
        };
      })
      .filter((x) => x.storeId),
  };
}

// ---- the shared lead dashboard, /admin/leads (docs/contracts/admin-leads.json; Toran's src/ops/leadsAdmin.ts)

export const WHERE = ['new', 'ready', 'sent', 'talking', 'closed'];
const DEMO_STATES = ['none', 'building', 'review', 'ready', 'failed', 'removed'];
/** The lead's buttons Toran's /internal/leads takes; the rest (they answered, later, not interested...) are ACTIONS. */
export const LEAD_ACTIONS = ['build-toran', 'build-teder', 'build-both', 'send-both', 'send-toran', 'send-teder', 'mark-sent', 'mark-reminded', 'notes', 'skip'];
const SENDS = ['both', 'toran', 'teder'];

const demoOf = (d) => {
  const o = d && typeof d === 'object' ? d : {};
  return {
    state: DEMO_STATES.includes(o.state) ? o.state : 'none',
    pageUrl: safeHref(o.pageUrl),
    sentAt: str(o.sentAt, 40),
    reminderSentAt: str(o.reminderSentAt, 40),
    reminderDue: o.reminderDue === true,
    url: safeHref(o.url),
    error: str(o.error, 300),
  };
};
const whereOf = (v) => (WHERE.includes(v) ? v : 'new');
/** What can be built for the lead now, as Toran says; anything it does not say cannot. */
const buildOf = (b) => ({ toran: b?.toran === true, teder: b?.teder === true, both: b?.both === true, toranWhyNot: str(b?.toranWhyNot, 300) });
const rowOf = (x) => ({
  id: num(x.id),
  name: str(x.name, 200) || str(x.domain, 200) || '',
  domain: str(x.domain, 200) || '',
  url: safeHref(x.url),
  platform: str(x.platform, 40),
  score: num(x.score) ?? 0,
  qualified: x.qualified === true,
  where: whereOf(x.where),
  contact: { whatsapp: String(x.contact?.whatsapp ?? '').replace(/\D/g, '').slice(0, 15) || null, email: str(x.contact?.email, 254), phone: String(x.contact?.phone ?? '').replace(/\D/g, '').slice(0, 15) || null },
  toran: demoOf(x.toran),
  teder: demoOf(x.teder),
  build: buildOf(x.build),
  // Which demo the operator chose to make for it here: the lead's page leads with that one's message.
  chosen: SENDS.includes(x.chosen) ? x.chosen : null,
  updatedAt: str(x.updatedAt, 40),
});

/** Toran's list, kept to the documented fields; a row with no id is left out. */
export function readLeads(b) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const counts = Object.fromEntries(['all', ...WHERE].map((k) => [k, num(b.counts?.[k]) ?? 0]));
  return {
    teder: { ok: b.teder?.ok !== false },
    counts,
    leads: list(b.leads).map(rowOf).filter((x) => x.id != null),
    tederOnly: list(b.tederOnly)
      .map((x) => ({ tederId: num(x.tederId), name: str(x.name, 200) || str(x.domain, 200) || '', domain: str(x.domain, 200) || '', where: whereOf(x.where), teder: demoOf(x.teder), leadUrl: safeHref(x.leadUrl) }))
      .filter((x) => x.tederId != null),
  };
}

/** One lead's page from Toran, kept to the documented fields. */
export function readLead(b) {
  const x = b.lead && typeof b.lead === 'object' ? b.lead : {};
  const send = x.send && typeof x.send === 'object' ? x.send : {};
  const options = (Array.isArray(send.options) ? send.options : []).filter((o) => SENDS.includes(o));
  const copy = send.copy && typeof send.copy === 'object' ? { href: safeHref(send.copy.href), label: str(send.copy.label, 80) || '' } : null;
  return {
    ...rowOf(x),
    status: str(x.status, 40) || '',
    notes: str(x.notes, 4000) || '',
    demoCode: str(x.demoCode, 40),
    opens: num(x.opens) ?? 0,
    demoStartedAt: str(x.demoStartedAt, 40),
    tederOk: x.tederOk !== false,
    send: {
      stage: ['first', 'reminder'].includes(send.stage) ? send.stage : null,
      pitchable: send.pitchable === true,
      options,
      main: SENDS.includes(send.main) && options.includes(send.main) ? send.main : options[0] || null,
      waitingUntil: str(send.waitingUntil, 40),
      bothText: str(send.bothText, 2000),
      toranText: str(send.toranText, 2000),
      tederText: str(send.tederText, 2000),
      copy: copy?.href ? copy : null,
    },
    links: { toranPage: safeHref(x.links?.toranPage), toranReview: safeHref(x.links?.toranReview), tederLead: safeHref(x.links?.tederLead) },
  };
}

export function toranClient({ env = process.env, fetchImpl = globalThis.fetch, log = console.error } = {}) {
  const base = (String(env.OF_TORAN_INTERNAL || '').trim() || TORAN_INTERNAL).replace(/\/+$/, '');
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  const configured = token.length >= MIN_TOKEN;

  async function call(method, path, body, ms) {
    const r = await fetchImpl(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(ms),
    });
    const json = await r.json().catch(() => null);
    return { status: r.status, json };
  }
  const why = (e) => (e?.name === 'TimeoutError' ? 'timed out' : e?.cause?.code || e?.message);

  return {
    base,
    /** The dashboard's data: { ok: true, data } or { ok: false, why: 'not_configured' | 'down' }. */
    async ops() {
      if (!configured) return { ok: false, why: 'not_configured' };
      try {
        const r = await call('GET', '/internal/ops', null, GET_MS);
        if (r.status !== 200 || !r.json || typeof r.json !== 'object') {
          log(`[accounts] toran GET /internal/ops: ${r.status}`);
          return { ok: false, why: 'down' };
        }
        return { ok: true, data: readOps(r.json) };
      } catch (e) {
        log(`[accounts] toran GET /internal/ops: ${why(e)}`);
        return { ok: false, why: 'down' };
      }
    },
    /** The shared lead list: { ok: true, data } or { ok: false, why: 'not_configured' | 'down' }. */
    async leads({ where = '', q = '' } = {}) {
      if (!configured) return { ok: false, why: 'not_configured' };
      const qs = new URLSearchParams(Object.entries({ where: WHERE.includes(where) ? where : '', q: String(q || '').slice(0, 100) }).filter(([, v]) => v)).toString();
      try {
        const r = await call('GET', `/internal/leads${qs ? `?${qs}` : ''}`, null, POST_MS);
        if (r.status !== 200 || !r.json || typeof r.json !== 'object') {
          log(`[accounts] toran GET /internal/leads: ${r.status}`);
          return { ok: false, why: 'down' };
        }
        return { ok: true, data: readLeads(r.json) };
      } catch (e) {
        log(`[accounts] toran GET /internal/leads: ${why(e)}`);
        return { ok: false, why: 'down' };
      }
    },
    /** One lead: { ok: true, lead }, { ok: false, why: 'none' } when Toran has no such lead, or 'not_configured' | 'down'. */
    async lead(id) {
      if (!configured) return { ok: false, why: 'not_configured' };
      if (!/^\d{1,9}$/.test(String(id))) return { ok: false, why: 'none' };
      try {
        const r = await call('GET', `/internal/leads/${id}`, null, POST_MS);
        if (r.status === 404) return { ok: false, why: 'none' };
        if (r.status !== 200 || !r.json?.lead) {
          log(`[accounts] toran GET /internal/leads/${id}: ${r.status}`);
          return { ok: false, why: 'down' };
        }
        return { ok: true, lead: readLead(r.json) };
      } catch (e) {
        log(`[accounts] toran GET /internal/leads/${id}: ${why(e)}`);
        return { ok: false, why: 'down' };
      }
    },
    /** One of a lead's buttons, as act() answers: { ok, message } / { ok: false, error } / { ok: false, status }. */
    async leadAct(id, action, body) {
      if (!configured) return { ok: false, status: 0 };
      if (!/^\d{1,9}$/.test(String(id)) || !LEAD_ACTIONS.includes(action)) return { ok: false, status: 404 };
      const path = `/internal/leads/${id}/${action}`;
      try {
        const r = await call('POST', path, body, POST_MS * 2);
        if (r.status === 200 && r.json?.ok) return { ok: true, message: str(r.json.message, 400) || '' };
        if ((r.status === 400 || r.status === 404) && r.json?.ok === false && typeof r.json.error === 'string') return { ok: false, error: r.json.error.slice(0, 400), status: r.status };
        log(`[accounts] toran POST ${path}: ${r.status}`);
        return { ok: false, status: r.status };
      } catch (e) {
        log(`[accounts] toran POST ${path}: ${why(e)}`);
        return { ok: false, status: 0 };
      }
    },
    /**
     * One action, as Toran takes it: { ok: true, message } when it was recorded, { ok: false, error } with Toran's
     * own line when its rules refuse it, or { ok: false, status } when Toran did not answer (status 0) or failed.
     */
    async act(kind, id, action, body) {
      if (!configured) return { ok: false, status: 0 };
      const path = `/internal/ops/${kind}/${encodeURIComponent(id)}/${action}`;
      try {
        const r = await call('POST', path, body, POST_MS);
        if (r.status === 200 && r.json?.ok) return { ok: true, message: str(r.json.message, 280) || '' };
        if (r.status === 400 && r.json?.ok === false && typeof r.json.error === 'string') return { ok: false, error: r.json.error.slice(0, 280), status: r.status };
        log(`[accounts] toran POST ${path}: ${r.status}`);
        return { ok: false, status: r.status };
      } catch (e) {
        log(`[accounts] toran POST ${path}: ${why(e)}`);
        return { ok: false, status: 0 };
      }
    },
  };
}

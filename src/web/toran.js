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
/**
 * Every button of a lead, all Toran's /internal/leads (the owner, 2026-11-12: /admin/leads "to have everything i need for
 * creating and doing leads", and never "old fronts"): what it goes on with (go-none is neither), its demos built, sent
 * and marked, Toran's page checked and fixed, where it stands (with Teder's lead moved to match), Teder's demo worked,
 * and the page taken down or the store deleted. The dashboard's own list (/admin) keeps ACTIONS, on /internal/ops.
 */
export const LEAD_ACTIONS = [
  'go-both', 'go-toran', 'go-teder', 'go-none', 'build-toran', 'build-teder', 'build-both', 'send-both', 'send-toran', 'send-teder', 'mark-sent', 'mark-reminded', 'notes', 'skip',
  'approve-toran', 'hold-toran', 'brand', 'sample', 'replied', 'later', 'lost', 'reopen', 'teder-approve', 'teder-redo', 'teder-other', 'teder-remove', 'takedown', 'delete',
];
const SENDS = ['both', 'toran', 'teder'];
/** Where more stores are found (Toran's discovery sources), in the order offered. */
export const SOURCES = ['storecensus', 'crawl', 'brave', 'seeds'];
const GAPS = ['name', 'color', 'products', 'sample', 'price', 'of_number', 'demo_number'];

const demoOf = (d) => {
  const o = d && typeof d === 'object' ? d : {};
  return {
    state: DEMO_STATES.includes(o.state) ? o.state : 'none',
    pageUrl: safeHref(o.pageUrl),
    sentAt: str(o.sentAt, 40),
    reminderSentAt: str(o.reminderSentAt, 40),
    reminderDue: o.reminderDue === true,
    error: str(o.error, 300),
    // What Teder's demo is about, as Teder's own lead card said it.
    idea: str(o.idea, 120),
  };
};
/** A colour as #rrggbb, else null: it is drawn as an SVG fill, so nothing else reaches the page. */
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
/** A profile on a network, only an https address on that network's own site. */
const profile = (v, host) => {
  const h = safeHref(v);
  try {
    return h && h.startsWith('https://') && host.test(new URL(h).hostname) ? h : null;
  } catch {
    return null;
  }
};
/** A store in a few words, as Toran found it: its own line, and its facts (products, prices, kinds, profiles). */
const aboutOf = (x) => {
  const f = x.facts && typeof x.facts === 'object' ? x.facts : {};
  const so = f.social && typeof f.social === 'object' ? f.social : {};
  return {
    about: str(x.about, 200),
    facts: {
      products: num(f.products),
      productsAtLeast: f.productsAtLeast === true,
      priceMin: num(f.priceMin),
      priceMax: num(f.priceMax),
      currency: str(f.currency, 3) || 'ILS',
      kinds: (Array.isArray(f.kinds) ? f.kinds : []).map((k) => str(k, 40)).filter(Boolean).slice(0, 3),
      social: {
        instagram: profile(so.instagram, /(^|\.)instagram\.com$/),
        tiktok: profile(so.tiktok, /(^|\.)tiktok\.com$/),
        facebook: profile(so.facebook, /(^|\.)(facebook|fb)\.com$/),
      },
    },
  };
};
const whereOf = (v) => (WHERE.includes(v) ? v : 'new');
/** A choice of what the lead goes on with, as Toran says: whether it can be chosen, and the demos it would make now. */
const goOf = (g) => ({ can: g?.can === true, makes: Array.isArray(g?.makes) ? g.makes.filter((p) => p === 'toran' || p === 'teder') : [] });
/** What can be built for the lead now, as Toran says; anything it does not say cannot. */
const buildOf = (b) => ({
  toran: b?.toran === true,
  teder: b?.teder === true,
  both: b?.both === true,
  toranWhyNot: str(b?.toranWhyNot, 300),
  go: { both: goOf(b?.go?.both), toran: goOf(b?.go?.toran), teder: goOf(b?.go?.teder) },
});
const rowOf = (x) => ({
  id: num(x.id),
  name: str(x.name, 200) || str(x.domain, 200) || '',
  domain: str(x.domain, 200) || '',
  url: safeHref(x.url),
  platform: str(x.platform, 40),
  ...aboutOf(x),
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
      .map((x) => ({ tederId: num(x.tederId), name: str(x.name, 200) || str(x.domain, 200) || '', domain: str(x.domain, 200) || '', where: whereOf(x.where), teder: demoOf(x.teder) }))
      .filter((x) => x.tederId != null),
    // The stores added by their address that are not leads yet: being read, or refused with Toran's reason.
    adding: list(b.adding).map((x) => ({ url: safeHref(x.url) || '', state: x.state === 'failed' ? 'failed' : 'reading', error: str(x.error, 300), at: str(x.at, 40) })).filter((x) => x.url),
    discovery: discoveryOf(b.discovery),
  };
}

function discoveryOf(d) {
  const o = d && typeof d === 'object' ? d : {};
  const last = o.last && typeof o.last === 'object' ? o.last : null;
  return {
    running: SOURCES.includes(o.running) ? o.running : null,
    sources: (Array.isArray(o.sources) ? o.sources : []).filter((x) => SOURCES.includes(x)),
    last: last ? { source: SOURCES.includes(last.source) ? last.source : null, at: str(last.at, 40), found: num(last.found) ?? 0, fit: num(last.fit) ?? 0, looked: num(last.looked) ?? 0 } : null,
  };
}

/** Toran's page as it is checked on the lead's page; null before it is built. */
function reviewOf(r) {
  if (!r || typeof r !== 'object') return null;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  return {
    gaps: list(r.gaps).map((g) => ({ key: GAPS.includes(g.key) ? g.key : null, he: str(g.he, 300) || '' })).filter((g) => g.key),
    approved: r.approved === true,
    held: r.held === true,
    building: r.building === true,
    name: str(r.name, 80),
    color: hex(r.color),
    colorsFound: (Array.isArray(r.colorsFound) ? r.colorsFound : []).map(hex).filter(Boolean).slice(0, 6),
    chat: list(r.chat).map((m) => ({ role: m.role === 'agent' ? 'agent' : 'customer', text: str(m.text, 2000) || '' })).slice(0, 12),
    turnedDown: list(r.turnedDown).map((t) => ({ product: str(t.product, 200) || '', why: str(t.why, 400) || '' })).slice(0, 8),
    builtAt: str(r.builtAt, 40),
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
    stats: x.stats && typeof x.stats === 'object' ? { opens: num(x.stats.opens) ?? 0, visitors: num(x.stats.visitors) ?? 0, depth: num(x.stats.depth) ?? 0, clicks: num(x.stats.clicks) ?? 0, lastOpen: str(x.stats.lastOpen, 40) } : null,
    demoStartedAt: str(x.demoStartedAt, 40),
    tederOk: x.tederOk !== false,
    takedownAskedAt: str(x.takedownAskedAt, 40),
    scoreParts: (Array.isArray(x.scoreParts) ? x.scoreParts : [])
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({ factor: str(f.factor, 40) || '', he: str(f.he, 40) || '', points: num(f.points) ?? 0, max: num(f.max) ?? 0, evidence: str(f.evidence, 200) || '' }))
      .slice(0, 12),
    review: reviewOf(x.review),
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
    async leads({ where = '', q = '', all = false } = {}) {
      if (!configured) return { ok: false, why: 'not_configured' };
      const qs = new URLSearchParams(Object.entries({ where: WHERE.includes(where) ? where : '', q: String(q || '').slice(0, 100), all: all ? '1' : '' }).filter(([, v]) => v)).toString();
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
        if (r.status === 200 && r.json?.ok) return { ok: true, message: str(r.json.message, 400) || '', ready: r.json.ready === true, gone: r.json.gone === true };
        if ((r.status === 400 || r.status === 404) && r.json?.ok === false && typeof r.json.error === 'string') return { ok: false, error: r.json.error.slice(0, 400), status: r.status };
        log(`[accounts] toran POST ${path}: ${r.status}`);
        return { ok: false, status: r.status };
      } catch (e) {
        log(`[accounts] toran POST ${path}: ${why(e)}`);
        return { ok: false, status: 0 };
      }
    },
    /**
     * The list's own buttons: a store added by its address (add, { url, by }) or more stores found (discover, { source,
     * by }), as leadAct answers: { ok, message, id } (id: the lead, when the store was here already) / { ok: false, error }.
     */
    async leadsDo(what, body) {
      if (!configured) return { ok: false, status: 0 };
      if (what !== 'add' && what !== 'discover') return { ok: false, status: 404 };
      const path = `/internal/leads/${what}`;
      try {
        const r = await call('POST', path, body, POST_MS);
        if (r.status === 200 && r.json?.ok) return { ok: true, message: str(r.json.message, 400) || '', id: num(r.json.id) };
        if (r.status === 400 && r.json?.ok === false && typeof r.json.error === 'string') return { ok: false, error: r.json.error.slice(0, 400), status: r.status };
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

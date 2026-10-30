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
/** Every action Toran takes, and which product each is for (null: both). */
export const ACTIONS = { sent: null, reminded: null, direct: 'toran', replied: null, next: null, later: null, lost: null, reopen: null, pilot: 'toran', paid: 'toran', won: 'teder' };
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
  return {
    teder: { ok: b.teder?.ok !== false },
    items,
    noContact: list(b.noContact).map((x) => ({ id: idOf(x.id), name: str(x.name, 200) || str(x.domain, 200) || '', domain: str(x.domain, 200) || '', score: num(x.score), leadUrl: safeHref(x.leadUrl) })),
    stuck: list(b.stuck).map((x) => ({ domain: str(x.domain, 200) || '', phone: String(x.phone ?? '').replace(/\D/g, '').slice(0, 15), at: str(x.at, 40), why: str(x.why, 300) || '', storeId: num(x.storeId), leadUrl: safeHref(x.leadUrl) })),
    conversations,
    funnels: { toran: stages(b.funnels?.toran), teder: stages(b.funnels?.teder) },
    // Our one WhatsApp number, once our company store connected it (null before), and the demo number as it sends now:
    // through Meta, Twilio or the simulator, and whether that reaches anyone. null from a Toran that does not say.
    ourNumber: one ? { number: digits(one.number), status: str(one.status, 40) || '', roles: list(one.roles).map((r) => ({ key: str(r.key, 40) || '', he: str(r.he, 300) || '' })), leadUrl: safeHref(one.leadUrl) } : null,
    demoLine: line ? { live: line.live === true, via: ['meta', 'twilio', 'sim'].includes(line.via) ? line.via : null, number: digits(line.number) } : null,
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

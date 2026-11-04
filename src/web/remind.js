import { setupBases } from './setup.js';

// The payment reminders on WhatsApp (the owner, 2026-11-03: "add a reminder to pay for the new month, whatsapp, email
// and dashboard. A user has 72 hours to pay for a new month once their subscription has ended"): the daily run
// (src/web/daily.js) hands each one to Toran on this machine, and Toran sends it from our number as the approved
// template payment_reminder. docs/setup.md, "The daily job"; docs/contracts/pay-remind.json.
//
//   POST <OF_TORAN_INTERNAL>/internal/pay/remind
//   Authorization: Bearer OF_INTERNAL_TOKEN
//   { "workspace", "phone", "kind", "business", "products", "paidUntil", "graceUntil", "code" }
//
//   200 { ok: true, sent, why }   sent, or not: why is already (it went before), held (Toran's limits for a phone),
//                                 stopped (the number wrote "הפסק" after a reminder) or failed (Meta refused it or did
//                                 not answer)
//   anything else                 (another status, no answer in REMIND_MS, no token configured): Toran did not take it
//
// Never throws: every answer is an outcome, and the caller logs it. Nothing is ever sent again: the email beside it is
// what the customer always gets.

export const REMIND_MS = 20_000;
export const REMIND_PATH = '/internal/pay/remind';
/** The billing emails that also go on WhatsApp: the last paid day, the first day after it, the last day of the grace. */
export const REMIND_KINDS = ['soon1', 'due', 'last'];
const MIN_TOKEN = 32;
const WHY = ['already', 'held', 'stopped', 'failed'];

export function remindClient({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = REMIND_MS } = {}) {
  const base = setupBases(env).toran;
  const token = String(env.OF_INTERNAL_TOKEN || '').trim();
  return {
    /**
     * One reminder, as the contract's request has it. Resolves { taken: true, sent, why } when Toran answered as the
     * contract says, else { taken: false, why } with what went wrong, for the log.
     */
    async remind(reminder) {
      if (token.length < MIN_TOKEN) return { taken: false, why: 'OF_INTERNAL_TOKEN is not set' };
      try {
        const r = await fetchImpl(`${base}${REMIND_PATH}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(reminder),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await r.json().catch(() => null);
        if (r.status === 200 && body?.ok === true && body.sent === true) return { taken: true, sent: true, why: null };
        if (r.status === 200 && body?.ok === true && body.sent === false && WHY.includes(body.why)) return { taken: true, sent: false, why: body.why };
        return { taken: false, why: `${r.status}${body?.error ? ` ${body.error}` : ''}` };
      } catch (e) {
        return { taken: false, why: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `no answer in ${timeoutMs / 1000} seconds` : e?.cause?.code || e?.message || String(e) };
      }
    },
  };
}

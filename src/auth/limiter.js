import { now, MINUTE, HOUR, DAY } from '../core/clock.js';

// Rate limits, counted per key: an IP address, an email, anything. Generalised
// from Teder's per-address login limiter.
//
// A limiter holds one list of event times per key and any number of rules
// ({ max, windowMs }); a key is held back while any rule is full. A `global` rule
// counts every key together: past it (an attack from many addresses), each key
// gets `squeezeTo` events per rule instead of its usual max. That throttles the
// attack without ever locking everyone out, so a stranger cannot lock the
// superadmin out of their own login.
//
// The counts live in memory. A restart forgets them, which only an attacker who
// can already restart the server could use.

export function createLimiter({ rules, global = null, maxKeys = 50_000 }) {
  if (!rules?.length) throw new Error('a limiter needs at least one rule');
  const longest = Math.max(...rules.map((r) => r.windowMs));
  const events = new Map();
  let all = [];

  const recent = (key, t) => {
    const list = (events.get(key) || []).filter((x) => t - x < longest);
    if (list.length) events.set(key, list);
    else events.delete(key);
    return list;
  };

  return {
    /** Seconds until `key` may go again, or null if it may go now. */
    check(key, t = now()) {
      key = String(key);
      const squeezed = global && (all = all.filter((x) => t - x < global.windowMs)).length >= global.max;
      const list = recent(key, t);
      let wait = 0;
      for (const { max: usual, windowMs } of rules) {
        const max = squeezed ? Math.min(usual, global.squeezeTo ?? 1) : usual;
        const inWindow = list.filter((x) => t - x < windowMs);
        if (inWindow.length >= max) wait = Math.max(wait, windowMs - (t - inWindow[inWindow.length - max]));
      }
      return wait > 0 ? Math.ceil(wait / 1000) : null;
    },
    /** Count one event (a failure, a request) against `key`. */
    hit(key, t = now()) {
      key = String(key);
      events.set(key, [...recent(key, t), t]);
      if (global) all = [...all.filter((x) => t - x < global.windowMs), t];
      // A flood of distinct keys: forget the oldest rather than grow without bound.
      for (const k of events.keys()) {
        if (events.size <= maxKeys) break;
        events.delete(k);
      }
    },
    /** Forget `key` (a successful sign-in clears its failures). */
    clear(key) {
      events.delete(String(key));
    },
  };
}

/** The limits this service uses. */
export const LIMITS = {
  // Superadmin password + TOTP failures, per address (Teder's numbers).
  adminLogin: { rules: [{ max: 5, windowMs: 15 * MINUTE }], global: { max: 20, windowMs: HOUR, squeezeTo: 1 } },
  // Magic-link requests, counted whether or not the address is a user.
  magicPerEmail: { rules: [{ max: 3, windowMs: 15 * MINUTE }, { max: 10, windowMs: DAY }] },
  magicPerIp: { rules: [{ max: 10, windowMs: 15 * MINUTE }, { max: 50, windowMs: DAY }] },
  // Public sign-up (/signup): every form sent is counted, the honeypot's and an address that has an account included.
  signupPerEmail: { rules: [{ max: 3, windowMs: 15 * MINUTE }, { max: 10, windowMs: DAY }] },
  signupPerIp: { rules: [{ max: 5, windowMs: HOUR }, { max: 20, windowMs: DAY }] },
};

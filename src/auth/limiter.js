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

/**
 * The key an address is counted under: an IPv4 address as it is (an IPv4-mapped IPv6 one too), an IPv6 address by its
 * /64. One home or phone connection is handed a whole /64 and can use a new address in it for every request, so a
 * limit per IPv6 address would limit nothing. Anything that is not an address is its own key.
 */
export function ipKey(ip) {
  const s = String(ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) return v4[1];
  if (!s.includes(':')) return s;
  const parts = s.split('::');
  if (parts.length > 2) return s;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const groups = parts.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  const net = groups.slice(0, 4);
  if (net.length < 4 || net.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${net.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
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

/**
 * Every sign-up email sent in a day, from every address together (OF_SIGNUP_DAILY_EMAILS, 200 by default): the form
 * sends an email to any address typed into it, so many addresses at once must not turn it into a mailer for anyone.
 */
export const signupMailDaily = (env = process.env) => ({ rules: [{ max: Math.max(1, Number(env.OF_SIGNUP_DAILY_EMAILS) || 200), windowMs: DAY }] });

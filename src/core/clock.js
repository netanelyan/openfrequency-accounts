// Time. Injectable so expiry (15-minute links, 72-hour invites, idle sessions)
// can be tested without waiting.

let fixed = null;

export const now = () => (fixed != null ? fixed : Date.now());
export const nowIso = () => new Date(now()).toISOString();
export const isoIn = (ms) => new Date(now() + ms).toISOString();

/** For tests: pin the clock (a Date, an ISO string or ms), or null to release it. */
export function setNow(t) {
  fixed = t == null ? null : typeof t === 'number' ? t : Date.parse(t instanceof Date ? t.toISOString() : t);
}

/** For tests: move a pinned clock forward. */
export function advance(ms) {
  if (fixed == null) throw new Error('advance() needs a pinned clock: call setNow() first');
  fixed += ms;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

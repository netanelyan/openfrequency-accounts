import { proxyToToran } from './admin-toran.js';

// /admin/teder: Teder's operator pages (the demos, its leads, every workspace's accounts and their health, the server's
// settings: when posts are written, the stop for everything, the month's costs and every customer's quotas), served on
// our /admin and rendered by Teder on this machine, as /admin/toran is Toran's (admin-toran.js). Teder's own subdomain
// shows the product only. The owner, 2026-11-10: "Make teder and toran of natikyan153@gmail.com regular, just like a
// customer's. Everything else, leads etc should be in other places. The admin dashboard is for that"
// (docs/admin-split.md).
//
// Everything admin-toran.js says holds here, with Teder's names: app.js checks the superadmin first (outside view-as)
// and refuses /internal under the prefix; the rest goes to Teder at OF_TEDER_INTERNAL with the prefix kept,
// X-OF-Admin-Prefix: /admin/teder, X-OF-Admin-Origin and the same signed X-OF-Operator
// (docs/contracts/admin-toran-operator.json). Teder strips the prefix, answers as the operator, and puts the prefix back
// on its links, forms, redirects and polls.
//
// Teder's own cookies on our host are named td_* (Teder renames them both ways under the prefix and sets them for the
// prefix's path), so they never meet ours: accounts has an of_flash too, and of_session is the session itself. Of the
// browser's cookies only td_* and of-theme go to Teder. Teder's script marks a background form with X-OF-Ajax: 1; that
// one header of the X-OF-* family is passed on, and only as "1".

export const TEDER_PREFIX = '/admin/teder';
export const TEDER_INTERNAL = 'http://127.0.0.1:4700';

/** Is this path ours to hand to Teder? /admin/teder and everything under it. */
export const isAdminTeder = (p) => p === TEDER_PREFIX || p.startsWith(`${TEDER_PREFIX}/`);

/** The browser's cookies that are Teder's own (td_*) and of-theme, as one Cookie header, or null when there are none. */
export function tederCookies(header) {
  const kept = String(header || '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => /^(?:td_[A-Za-z0-9_-]*|of-theme)=/.test(c));
  return kept.length ? kept.join('; ') : null;
}

/** Where Teder is: OF_TEDER_INTERNAL, the same address /setup reads Teder's checklist from. */
export const tederAt = (env = process.env) => new URL((String(env.OF_TEDER_INTERNAL || '').trim() || TEDER_INTERNAL).replace(/\/+$/, ''));

/** Hand one request to Teder, as proxyToToran hands one to Toran (the same options). */
export function proxyToTeder(req, res, opts) {
  const more = req.headers['x-of-ajax'] === '1' ? { 'x-of-ajax': '1' } : {};
  return proxyToToran(req, res, { ...opts, prefix: TEDER_PREFIX, keep: tederCookies, more, name: 'teder' });
}

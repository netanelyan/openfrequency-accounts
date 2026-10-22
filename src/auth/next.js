// Where to send someone after they sign in: ?next=.
//
// Allowed:
//   - an https:// address on one subdomain of openfrequency.co.il
//     (teder.openfrequency.co.il, toran.openfrequency.co.il, ...), default port,
//     no user:password@
//   - a path on this site: /something, but never //something or /\something,
//     which a browser reads as another host
//   - in development only (allowLocal), http://localhost and http://127.0.0.1
//
// Anything else is null and the caller uses its default. The check runs on the
// raw string before the URL parser sees it, because the parser quietly removes
// tabs and newlines and turns backslashes into slashes, which is how most
// open-redirect bypasses get through.

export const PARENT = 'openfrequency.co.il';
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX = 2048;

/** C0 and C1 control characters, DEL, and the zero-width ones a link can hide. */
function invisible(ch) {
  const n = ch.codePointAt(0);
  return n < 0x20 || (n >= 0x7f && n <= 0x9f) || (n >= 0x200b && n <= 0x200f) || n === 0x2060 || n === 0xfeff;
}

/** The safe absolute form of `raw`, or null. Paths come back as paths. */
export function safeNext(raw, { allowLocal = false } = {}) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX) return null;
  // Any whitespace (\s covers the Unicode spaces too), any backslash, and any
  // invisible character are refused outright.
  if (/[\s\\]/.test(raw) || [...raw].some(invisible)) return null;

  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) return null;
    let u;
    try {
      u = new URL(raw, 'https://accounts.invalid');
    } catch {
      return null;
    }
    // Still on this site after parsing (catches anything the parser re-reads as a host).
    if (u.origin !== 'https://accounts.invalid') return null;
    return u.pathname + u.search + u.hash;
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;

  if (allowLocal && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.href;

  if (u.protocol !== 'https:' || u.port !== '') return null;
  const host = u.hostname;
  if (!host.endsWith(`.${PARENT}`)) return null;
  const sub = host.slice(0, -PARENT.length - 1);
  // Exactly one label in front: teder.openfrequency.co.il, not a.b.openfrequency.co.il.
  if (!LABEL.test(sub)) return null;
  return u.href;
}

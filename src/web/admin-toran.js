import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { TORAN_INTERNAL } from './toran.js';

// /admin/toran: Toran's operator pages (the leads, a lead's page, the review queue, the follow-ups, the chats, the
// settings, the pitch pages' previews), served on our /admin and rendered by Toran on this machine. Toran's own
// subdomain shows the product only.
//
// app.js checks the superadmin first (outside view-as, as for /admin) and refuses anything with /internal under the
// prefix; what is left goes to Toran at OF_TORAN_INTERNAL as it came: the method, the path with the /admin/toran
// prefix kept, the query and the body (up to BODY_MAX). Toran knows the prefix from X-OF-Admin-Prefix, strips it,
// writes it back into its links, forms and redirects, and builds absolute addresses on X-OF-Admin-Origin.
//
// Only the headers in PASS go to Toran. Never Authorization, X-Forwarded-For, Forwarded, X-Real-IP or any X-OF-*
// the browser sent: X-Forwarded-Proto and the X-OF-* are ours, set here. Toran's answer comes back as it is (its
// status, its cookies, its CSP, its compressed body), without the hop-by-hop headers and without ours.

export const PREFIX = '/admin/toran';
export const BODY_MAX = 2 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;

/** The browser's headers that go to Toran, and nothing else. */
export const PASS = ['cookie', 'content-type', 'accept', 'accept-language', 'accept-encoding', 'origin', 'referer', 'user-agent', 'x-tn-ajax', 'content-length'];
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

/** Is this path ours to hand to Toran? /admin/toran and everything under it. */
export const isAdminToran = (p) => p === PREFIX || p.startsWith(`${PREFIX}/`);

/** /internal anywhere under the prefix, after decoding (internal%2Fops too): never asked of Toran. */
export function touchesInternal(p) {
  let decoded = p;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    return true;
  }
  return [p, decoded].some((s) => /\/internal(?:[/\\]|$)/i.test(s));
}

/** Where Toran is: OF_TORAN_INTERNAL, the same address the dashboard reads /internal/ops from. */
export const toranBase = (env = process.env) => new URL((String(env.OF_TORAN_INTERNAL || '').trim() || TORAN_INTERNAL).replace(/\/+$/, ''));

/**
 * Hand one request to Toran and stream its answer back. `path` is the path and query to ask for (prefix kept),
 * `secure` whether the browser reached us over HTTPS, `origin` our public origin. Calls `failed(status)` before
 * anything was written when Toran cannot be asked (413: the body is too large; 502: Toran is down or slow).
 */
export function proxyToToran(req, res, { base, path, secure, origin, failed, timeoutMs = TIMEOUT_MS, log = console.error }) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > BODY_MAX) {
    req.resume();
    return failed(413);
  }

  const headers = {};
  for (const k of PASS) if (req.headers[k] != null) headers[k] = req.headers[k];
  Object.assign(headers, {
    host: base.host,
    'x-of-admin-prefix': PREFIX,
    'x-forwarded-proto': secure ? 'https' : 'http',
    'x-of-admin-origin': origin,
  });

  let finished = false;
  const fail = (status, why) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    log(`[accounts] toran ${req.method} ${path.split('?')[0]}: ${why}`);
    upstream.destroy();
    if (!res.headersSent) failed(status);
    else res.destroy();
  };

  const request = base.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = request({ protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method: req.method, path, headers });
  // Toran has 30 seconds to start answering, and the connection may sit idle no longer than that afterwards.
  const timer = setTimeout(() => fail(502, 'timed out'), timeoutMs);
  upstream.setTimeout(timeoutMs, () => fail(502, 'timed out'));
  upstream.on('error', (e) => fail(502, e.code || e.message));

  upstream.on('response', (r) => {
    if (finished) return r.resume();
    clearTimeout(timer);
    const raw = [];
    for (let i = 0; i < r.rawHeaders.length; i += 2) {
      if (!HOP.has(r.rawHeaders[i].toLowerCase())) raw.push(r.rawHeaders[i], r.rawHeaders[i + 1]);
    }
    res.writeHead(r.statusCode, r.statusMessage, raw);
    r.pipe(res);
    r.on('end', () => (finished = true));
    r.on('error', () => res.destroy());
  });

  // The browser's body, streamed, cut at BODY_MAX.
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > BODY_MAX) {
      req.unpipe(upstream);
      req.resume();
      fail(413, 'body too large');
    }
  });
  // The browser went away: so does the request to Toran.
  res.on('close', () => {
    if (res.writableFinished) return;
    finished = true;
    clearTimeout(timer);
    upstream.destroy();
  });
  req.pipe(upstream);
}

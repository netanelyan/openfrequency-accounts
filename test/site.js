import { request } from 'node:http';
import { listen } from '../src/web/server.js';
import { createLimiter, LIMITS } from '../src/auth/limiter.js';
import { createSession } from '../src/auth/sessions.js';

// The site over real HTTP, with a pretend browser: it keeps cookies, remembers
// the last CSRF token it was shown, and can pretend to arrive through Caddy over
// HTTPS (the socket is loopback, so X-Forwarded-Proto is believed), which is how
// the production cookie names and Domain get tested.

export const TOKEN = 'internal-token-for-tests-only-0123456789';
export const PUBLIC = 'accounts.openfrequency.co.il';

export async function startSite(db, { env = {}, limiters } = {}) {
  const mails = [];
  const mailer = { sending: 'test', send: (m) => mails.push(m), flush: async () => {} };
  const fullEnv = { OF_INTERNAL_TOKEN: TOKEN, PUBLIC_HOST: PUBLIC, SESSION_SECRET: 's'.repeat(40), ...env };
  const lim = limiters || { magicEmail: createLimiter(LIMITS.magicPerEmail), magicIp: createLimiter(LIMITS.magicPerIp), adminLogin: createLimiter(LIMITS.adminLogin) };
  const s = await listen(db, { env: fullEnv, port: 0, internalPort: 0, mailer, failDelayMs: 0, limiters: lim, log: () => {} });
  const browser = (opts) => makeBrowser(s.port, { host: fullEnv.PUBLIC_HOST ? PUBLIC : `127.0.0.1:${s.port}`, secure: Boolean(fullEnv.PUBLIC_HOST), ...opts });
  const internal = (sid, product) => call(s.internalPort, 'GET', `/internal/session${product ? `?product=${product}` : ''}`, { authorization: `Bearer ${TOKEN}`, 'x-of-session': sid || '' }).then((r) => ({ ...r, json: JSON.parse(r.body) }));
  // The owner-line routes, as Toran calls them: JSON in and out. A body that is a string is sent as it is.
  const owners = (method, path, body = null, headers = {}) =>
    call(s.internalPort, method, path, { authorization: `Bearer ${TOKEN}`, ...(body != null ? { 'content-type': 'application/json' } : {}), ...headers }, body == null ? null : typeof body === 'string' ? body : JSON.stringify(body)).then((r) => ({
      ...r,
      json: r.body ? JSON.parse(r.body) : null,
    }));
  return { s, mails, browser, internal, owners, close: () => s.close() };
}

function call(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body != null ? { 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

export function makeBrowser(port, { host, secure = true, ip = '203.0.113.10', origin = undefined } = {}) {
  const jar = new Map();
  let csrf = null;
  const b = {
    jar,
    get csrf() {
      return csrf;
    },
    cookie: (name) => jar.get(name)?.value,
    setCookies: [],
    async go(method, path, fields = null, extra = {}, files = null) {
      const headers = {
        host,
        'x-forwarded-for': ip,
        ...(secure ? { 'x-forwarded-proto': 'https' } : {}),
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v.value}`).join('; ') } : {}),
        ...extra,
      };
      let body = null;
      if (fields && files) {
        // multipart/form-data, as a browser sends a form with a file: { name: { filename, data, type } }.
        const boundary = `----of-test-${Math.random().toString(36).slice(2)}`;
        const parts = [];
        for (const [k, v] of Object.entries({ _csrf: csrf ?? '', ...fields })) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
        for (const [k, f] of Object.entries(files)) {
          parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${f.filename}"\r\nContent-Type: ${f.type || 'application/pdf'}\r\n\r\n`), f.data, Buffer.from('\r\n'));
        }
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        body = Buffer.concat(parts);
        headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
        const o = origin === undefined ? `${secure ? 'https' : 'http'}://${host}` : origin;
        if (o) headers.origin = o;
      } else if (fields) {
        const params = new URLSearchParams();
        const all = { _csrf: csrf ?? '', ...fields };
        for (const [k, v] of Object.entries(all)) for (const x of [].concat(v)) if (x !== undefined) params.append(k, x);
        body = params.toString();
        headers['content-type'] = 'application/x-www-form-urlencoded';
        const o = origin === undefined ? `${secure ? 'https' : 'http'}://${host}` : origin;
        if (o) headers.origin = o;
      }
      const r = await call(port, method, path, headers, body);
      b.setCookies = [].concat(r.headers['set-cookie'] || []);
      for (const c of b.setCookies) {
        const [pair, ...attrs] = c.split(';').map((x) => x.trim());
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (attrs.some((a) => /^max-age=0$/i.test(a)) || value === '') jar.delete(name);
        else jar.set(name, { value, attrs });
      }
      const m = /name="_csrf" value="([^"]+)"/.exec(r.body);
      if (m) csrf = m[1];
      return { ...r, setCookies: b.setCookies };
    },
    get: (path, extra) => b.go('GET', path, null, extra),
    post: (path, fields = {}, extra) => b.go('POST', path, fields, extra),
    upload: (path, fields, files, extra) => b.go('POST', path, fields, extra, files),
  };
  return b;
}

/** A pretend browser already signed in as a user, through a session made directly. */
export function signedIn(site, db, user, opts = {}) {
  const b = site.browser(opts);
  const secure = opts.secure ?? true;
  b.jar.set(secure ? '__Secure-of_session' : 'of_session', { value: createSession(db, user).id, attrs: [] });
  return b;
}

/** The token from a link in an email. */
export const tokenOf = (link) => new URL(link).searchParams.get('t');
/** The path and query of a link in an email (the test browser talks to the port directly). */
export const pathOf = (link) => {
  const u = new URL(link);
  return u.pathname + u.search;
};

import { now, nowIso, DAY } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { enabledProducts } from '../auth/sessions.js';

// Product emails: Teder and Toran ask us to email a workspace's people (POST /internal/notify, docs/setup.md), and
// each person chooses which of them they get, per product and per kind, on /notifications. By default an owner gets
// every kind and a member none; a choice saved on the page is kept as a row in notify_prefs and wins over that.
//
// What a product sends is checked and made plain here (checkNotify): one line for the subject, plain text for the
// body, no control characters or bidi overrides, sizes capped, the link https on openfrequency.co.il only. At most
// NOTIFY_PER_DAY emails of one kind, for one product, to one workspace in 24 hours.

export const KINDS = ['posts_waiting', 'weekly', 'monthly', 'connect_needed', 'publish_failed'];
export const NOTIFY_PER_DAY = 3;
export const LIMITS = { subject: 200, text: 5000, html: 50_000, link: 2000 };
export const SUBJECT_MAX = 150;

export class NotifyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// C0 controls (a line break is kept in the body), DEL, C1, and the bidi marks and overrides.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** A subject: one line, no control characters or bidi overrides, at most SUBJECT_MAX characters. */
export const oneLine = (v, max = SUBJECT_MAX) =>
  String(v ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(CONTROLS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** A body: plain text with its line breaks, no other control characters, no more than one empty line in a row. */
export const plainText = (v, max = LIMITS.text) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROLS, '')
    .split('\n')
    .map((l) => l.replace(/[  ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

/** An https link on openfrequency.co.il or one of its subdomains, default port, no user name or password; else null. */
export function ourLink(v) {
  if (typeof v !== 'string' || !v || v.length > LIMITS.link || /[\s\u0000-\u001f\u007f\\]/.test(v)) return null;
  let u;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  return host === 'openfrequency.co.il' || host.endsWith('.openfrequency.co.il') ? u.href : null;
}

/**
 * A product's request, checked: { workspace, product, kind, subject, text, link } or NotifyError (bad_workspace,
 * bad_product, bad_kind, bad_subject, bad_text, bad_html, bad_link). `html` is checked and not used: the email's HTML
 * is made here from the text, so nothing a product sends reaches an inbox as markup.
 */
export function checkNotify(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new NotifyError('bad');
  if (!Number.isSafeInteger(body.workspace) || body.workspace < 1) throw new NotifyError('bad_workspace');
  if (!PRODUCTS.includes(body.product)) throw new NotifyError('bad_product');
  if (!KINDS.includes(body.kind)) throw new NotifyError('bad_kind');
  if (typeof body.subject !== 'string' || body.subject.length > LIMITS.subject) throw new NotifyError('bad_subject');
  const subject = oneLine(body.subject);
  if (!subject) throw new NotifyError('bad_subject');
  if (typeof body.text !== 'string' || body.text.length > LIMITS.text) throw new NotifyError('bad_text');
  const text = plainText(body.text);
  if (!text) throw new NotifyError('bad_text');
  if (body.html != null && (typeof body.html !== 'string' || body.html.length > LIMITS.html)) throw new NotifyError('bad_html');
  const link = ourLink(body.link);
  if (!link) throw new NotifyError('bad_link');
  return { workspace: body.workspace, product: body.product, kind: body.kind, subject, text, link };
}

/** The default, with no choice saved: an owner gets everything, a member nothing. */
export const byDefault = (role) => role === 'client_owner';

/** One person's choices in a workspace: { [product]: { [kind]: boolean } }, for the products it has on. */
export function prefsOf(db, { userId, workspaceId, role }) {
  const saved = db.all('SELECT product, kind, enabled FROM notify_prefs WHERE user_id = ? AND workspace_id = ?', userId, workspaceId);
  const get = (p, k) => {
    const r = saved.find((x) => x.product === p && x.kind === k);
    return r ? Boolean(r.enabled) : byDefault(role);
  };
  return Object.fromEntries(enabledProducts(db, workspaceId).map((p) => [p, Object.fromEntries(KINDS.map((k) => [k, get(p, k)]))]));
}

/** Save the page: `on` is the set of "product:kind" that are ticked; every other kind of those products is off. */
export function savePrefs(db, { userId, workspaceId, on }, { by, ip = null } = {}) {
  const products = enabledProducts(db, workspaceId);
  const t = nowIso();
  db.tx(() => {
    for (const p of products)
      for (const k of KINDS)
        db.run(
          'INSERT INTO notify_prefs (user_id, workspace_id, product, kind, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, workspace_id, product, kind) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at',
          userId,
          workspaceId,
          p,
          k,
          on.has(`${p}:${k}`) ? 1 : 0,
          t
        );
    audit(db, { actor: by, action: 'notify_prefs_saved', workspaceId, ip, detail: { on: [...on].filter((x) => products.some((p) => x.startsWith(`${p}:`))) } });
  });
}

/** Who gets one kind of email from one product: the workspace's people (not disabled) who have it on. */
export function recipients(db, workspaceId, product, kind) {
  const people = db.all(
    `SELECT u.id, u.email, u.name, m.role, np.enabled AS chosen
       FROM memberships m JOIN users u ON u.id = m.user_id
       LEFT JOIN notify_prefs np ON np.user_id = u.id AND np.workspace_id = m.workspace_id AND np.product = ? AND np.kind = ?
      WHERE m.workspace_id = ? AND u.disabled_at IS NULL ORDER BY m.created_at, u.id`,
    product,
    kind,
    workspaceId
  );
  return people.filter((p) => (p.chosen == null ? byDefault(p.role) : Boolean(p.chosen)));
}

/** How many of this kind went to this workspace for this product in the last 24 hours. */
export const sentToday = (db, workspaceId, product, kind) =>
  db.get('SELECT COUNT(*) AS n FROM notify_log WHERE workspace_id = ? AND product = ? AND kind = ? AND at > ?', workspaceId, product, kind, new Date(now() - DAY).toISOString()).n;

/** Keep one that went out (or found nobody who wants it), for the limit and the audit log. */
export function logNotify(db, { workspace, product, kind }, count) {
  db.insert('notify_log', { workspace_id: workspace, product, kind, at: nowIso(), recipients: count });
  audit(db, { action: 'notify_sent', workspaceId: workspace, detail: { product, kind, recipients: count } });
}

import { randomBytes } from 'node:crypto';
import { isoIn, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { hashToken, looksLikeToken, newToken } from '../auth/tokens.js';
import { MAGIC_TTL, normEmail, validEmail } from './links.js';
import { openWorkspace } from './workspaces.js';

// Public sign-up: a business opens its own account, without the superadmin. Open only while OF_SIGNUP=1.
//
//   1. The form (/signup): their full name, the business's name, the products they want (Toran, Teder or both), the
//      terms and privacy policy accepted, and their email. Its answers wait in `signups` (migration 6).
//   2. The address is confirmed, one of two ways:
//        email   a link in an email, like a magic link: one use, 15 minutes, a button before it is used (mail scanners
//                open links). The token is in the email only; the row has its SHA-256.
//        google  "continue with Google": the row's token goes into the signed Google flow cookie (never a URL), and the
//                address is the one Google has verified.
//   3. completeSignup() opens it all in one transaction: the user, the workspace with only the products chosen
//      (openWorkspace(), the same path the console uses: each turned on, with its subscription at the list price and
//      nothing paid yet), and the user as its client_owner. No invite is sent. The caller signs them in.
//
// An address that already has a user never gets a second workspace this way: the form sends that address a sign-in
// link instead (the page says the same thing either way), and a confirmation that finds the address taken by then
// opens nothing.

/** The terms and privacy policy the form links to, by the date they were last updated (openfrequency.co.il). */
export const TERMS_VERSION = '2026-10-27';
export const TERMS_URL = 'https://openfrequency.co.il/terms';
export const PRIVACY_URL = 'https://openfrequency.co.il/privacy';
/** The website's page for leaving details, where a closed sign-up sends people. */
export const CONTACT_URL = 'https://openfrequency.co.il/join';

export const SIGNUP_TTL = MAGIC_TTL;
export const NAME_LIMITS = { min: 2, max: 80 };
export const BUSINESS_LIMITS = { min: 2, max: 80 };

/** Is sign-up open? Only when OF_SIGNUP is exactly "1". */
export const signupOpen = (env = process.env) => String(env.OF_SIGNUP ?? '').trim() === '1';

/** Who hears of each confirmed sign-up: OF_SIGNUP_NOTIFY, comma-separated addresses (a bad one is left out). */
export const signupNotify = (env = process.env) => [...new Set(String(env.OF_SIGNUP_NOTIFY || '').split(',').map(normEmail).filter(validEmail))];

export class SignupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Control characters and bidi overrides out, runs of spaces to one.
const clean = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The products a business may sign up for on its own: OF_SIGNUP_PRODUCTS, comma-separated, unknown names left out;
 * unset or blank, every product. (Toran waits for Meta's approval of WhatsApp: OF_SIGNUP_PRODUCTS=teder.) The others
 * show on the form as coming soon and are refused. The superadmin's console opens any product, whatever this says.
 */
export function signupProducts(env = process.env) {
  const raw = String(env.OF_SIGNUP_PRODUCTS ?? '').trim();
  if (!raw) return [...PRODUCTS];
  const named = raw.split(',').map((s) => s.trim().toLowerCase());
  return PRODUCTS.filter((p) => named.includes(p));
}

/**
 * The form, checked. Returns { name, business, email, products } or throws SignupError: bad_name, bad_business,
 * no_products, product_closed (one chosen that is not in `open`), no_terms, bad_email (only when `needEmail`: Google
 * brings its own).
 */
export function checkSignup({ name, business, email, products = [], terms }, { needEmail = true, open = PRODUCTS } = {}) {
  const n = clean(name);
  const b = clean(business);
  if (n.length < NAME_LIMITS.min || n.length > NAME_LIMITS.max) throw new SignupError('bad_name');
  if (b.length < BUSINESS_LIMITS.min || b.length > BUSINESS_LIMITS.max) throw new SignupError('bad_business');
  const chosen = PRODUCTS.filter((p) => [].concat(products).includes(p));
  if (!chosen.length) throw new SignupError('no_products');
  if (chosen.some((p) => !open.includes(p))) throw new SignupError('product_closed');
  if (!terms) throw new SignupError('no_terms');
  const e = normEmail(email);
  if (needEmail && !validEmail(e)) throw new SignupError('bad_email');
  return { name: n, business: b, email: needEmail ? e : null, products: chosen };
}

/**
 * Keep a checked form until its address is confirmed. `kind` 'email' or 'google'. Returns { token, row }, or, for an
 * email that already has a user, { exists: user } and keeps nothing (the caller sends that address a sign-in link).
 */
export function requestSignup(db, form, { kind = 'email', ip = null } = {}) {
  if (kind === 'email') {
    const user = db.get('SELECT * FROM users WHERE email = ?', form.email);
    if (user) {
      audit(db, { actor: null, action: 'signup_requested', ip, detail: { email: form.email, existing: true } });
      return { exists: user };
    }
  }
  const token = newToken();
  const at = nowIso();
  const id = db.insert('signups', {
    token_hash: hashToken(token),
    kind,
    email: kind === 'email' ? form.email : null,
    name: form.name,
    business: form.business,
    products_json: form.products,
    terms_version: TERMS_VERSION,
    terms_accepted_at: at,
    created_at: at,
    expires_at: isoIn(SIGNUP_TTL),
    ip,
  });
  audit(db, { actor: null, action: 'signup_requested', ip, detail: { ...(form.email ? { email: form.email } : {}), kind, products: form.products } });
  return { token, row: rowOut(db.get('SELECT * FROM signups WHERE id = ?', id)) };
}

const rowOut = (r) => (r ? { ...r, products: JSON.parse(r.products_json).filter((p) => PRODUCTS.includes(p)) } : null);
const LIVE = 'used_at IS NULL AND expires_at > ?';

/** The waiting sign-up for a token, if it still works, without using it up. */
export function peekSignup(db, token, kind = 'email') {
  if (!looksLikeToken(token)) return null;
  return rowOut(db.get(`SELECT * FROM signups WHERE token_hash = ? AND kind = ? AND ${LIVE}`, hashToken(token), kind, nowIso()));
}

/** Use a waiting sign-up up without opening anything (Google found an account the address already has). */
export function dropSignup(db, token, kind = 'google') {
  if (!looksLikeToken(token)) return false;
  const t = nowIso();
  return Number(db.run(`UPDATE signups SET used_at = ? WHERE token_hash = ? AND kind = ? AND ${LIVE}`, t, hashToken(token), kind, t).changes) === 1;
}

/** A slug for a new workspace: the business's name when it is written in Latin letters, else "ws", made unique. */
function slugFor(db, business) {
  const ascii = business
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  const base = ascii.length >= 3 ? ascii : 'ws';
  const free = (s) => !db.get('SELECT 1 FROM workspaces WHERE slug = ?', s);
  if (base !== 'ws' && free(base)) return base;
  for (;;) {
    const s = `${base}-${randomBytes(3).toString('hex')}`;
    if (free(s)) return s;
  }
}

/**
 * Confirm a sign-up and open it: the user, the workspace with the chosen products, the user as its owner. Once.
 *   kind 'email'  the address is the one the form gave
 *   kind 'google' `email` is the address Google verified (and `name` fills an empty one)
 * Returns { user, workspace }; { exists: user } when the address has a user by now (nothing is opened, the sign-up
 * is used up); or null when the token is unknown, used or expired.
 */
export function completeSignup(db, token, { kind = 'email', email = null, ip = null } = {}) {
  if (!looksLikeToken(token)) return null;
  return db.tx(() => {
    const t = nowIso();
    const r = db.run(`UPDATE signups SET used_at = ? WHERE token_hash = ? AND kind = ? AND ${LIVE}`, t, hashToken(token), kind, t);
    if (Number(r.changes) !== 1) return null;
    const row = rowOut(db.get('SELECT * FROM signups WHERE token_hash = ?', hashToken(token)));
    const address = normEmail(kind === 'google' ? email : row.email);
    if (!validEmail(address)) return null;
    const existing = db.get('SELECT * FROM users WHERE email = ?', address);
    if (existing) {
      audit(db, { actor: null, action: 'signup_refused', ip, detail: { email: address, reason: 'existing_user' } });
      return { exists: existing };
    }
    const userId = db.insert('users', { email: address, name: row.name, created_at: t, terms_version: row.terms_version, terms_accepted_at: row.terms_accepted_at });
    const user = db.get('SELECT * FROM users WHERE id = ?', userId);
    const workspace = openWorkspace(
      db,
      { name: row.business, slug: slugFor(db, row.business), products: row.products, terms: { version: row.terms_version, at: row.terms_accepted_at } },
      { by: user, ip, source: 'signup' }
    );
    db.insert('memberships', { user_id: user.id, workspace_id: workspace.id, role: 'client_owner', created_at: t });
    db.update('signups', row.id, { user_id: user.id, workspace_id: workspace.id, email: address });
    audit(db, { actor: user, action: 'signed_up', workspaceId: workspace.id, ip, detail: { method: kind, products: row.products, terms: row.terms_version } });
    return { user, workspace };
  });
}

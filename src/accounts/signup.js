import { randomBytes } from 'node:crypto';
import { isoIn, nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';
import { PRODUCTS } from '../db/schema.js';
import { hashToken, looksLikeToken, newToken } from '../auth/tokens.js';
import { MAGIC_TTL, normEmail, validEmail } from './links.js';
import { openWorkspace } from './workspaces.js';
import { PLANS, defaultPlan, ensureSubscription } from './subscriptions.js';
import { foundersSpots, spotOf, takeFoundersSpot } from './founders.js';

// Public sign-up: a business opens its own account, without the superadmin. Open only while OF_SIGNUP=1.
//
//   1. The form (/signup): their full name, the business's name, the products they want (Toran, Teder or both), Teder's
//      plan (full or small) and Toran's (store or big, PLANS), the terms and privacy policy accepted, and their email.
//      Its answers wait in
//      `signups` (migrations 6 and 8).
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

/**
 * What the form asks a business to accept, by the date it was last updated: the website's legal.signupUpdated
 * (openfrequency.co.il/terms), which since 2026-11-01 also names each product's short contract (CONTRACT_URLS, dated
 * legal.contractsUpdated) as part of the deal, and since 2026-11-03 gives a new month's payment 72 hours after the
 * paid month ends (subscriptions.js GRACE_HOURS) instead of 14 days. Stored on the user and the workspace at sign-up.
 * 2026-11-12: the pre-launch audit's terms (sign-in with Google, cancelling in the account, Toran's bot line, a pause
 * of the AI part on very unusual use, the business as an עוסק מורשה).
 */
export const TERMS_VERSION = '2026-11-12';
export const TERMS_URL = 'https://openfrequency.co.il/terms';
/** Each product's short contract on the website (openfrequency-web src/pages/legal.mjs), linked beside the terms. */
export const CONTRACT_URLS = { teder: 'https://openfrequency.co.il/teder/contract', toran: 'https://openfrequency.co.il/toran/contract' };
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
 * unset or blank, every product (both are on sale since 2026-11-08: OF_SIGNUP_PRODUCTS=teder,toran on the server). The
 * others show on the form as coming soon and are refused, and an account cannot add them (addProduct). The
 * superadmin's console opens any product, whatever this says.
 */
export function signupProducts(env = process.env) {
  const raw = String(env.OF_SIGNUP_PRODUCTS ?? '').trim();
  if (!raw) return [...PRODUCTS];
  const named = raw.split(',').map((s) => s.trim().toLowerCase());
  return PRODUCTS.filter((p) => named.includes(p));
}

/**
 * The products the form starts with ticked (the owner, 2026-11-02): with only one open, that one, and the form does not
 * ask; else the one the visitor came from (`want`, ?p=teder or ?p=toran, the website's and Teder's buttons) when it is
 * open; else none. Only where the form starts: what it sends is checked against `open` all the same (checkSignup).
 */
export function startProducts(want, open = PRODUCTS) {
  if (open.length === 1) return [...open];
  const p = String(want ?? '').trim().toLowerCase();
  return open.filter((o) => o === p);
}

/**
 * The form, checked. Returns { name, business, email, products, plan, plan_toran } or throws SignupError: bad_name,
 * bad_business, no_products, product_closed (one chosen that is not in `open`), bad_plan (a Teder plan that does not
 * exist), bad_plan_toran (a Toran one), no_terms, bad_email (only when `needEmail`: Google brings its own). `plan` is
 * Teder's, the full one when none is given, and null without Teder; `plan_toran` is Toran's, store when none is given,
 * null without Toran.
 */
export function checkSignup({ name, business, email, products = [], terms, plan = '', plan_toran = '' }, { needEmail = true, open = PRODUCTS } = {}) {
  const n = clean(name);
  const b = clean(business);
  if (n.length < NAME_LIMITS.min || n.length > NAME_LIMITS.max) throw new SignupError('bad_name');
  if (b.length < BUSINESS_LIMITS.min || b.length > BUSINESS_LIMITS.max) throw new SignupError('bad_business');
  const chosen = PRODUCTS.filter((p) => [].concat(products).includes(p));
  if (!chosen.length) throw new SignupError('no_products');
  if (chosen.some((p) => !open.includes(p))) throw new SignupError('product_closed');
  if (plan && !Object.hasOwn(PLANS.teder, plan)) throw new SignupError('bad_plan');
  // Its own error: "צריך לבחור אחת מהחבילות של תדר" for a Toran plan was the wrong product (the audit of 2026-11-11).
  if (plan_toran && !Object.hasOwn(PLANS.toran, plan_toran)) throw new SignupError('bad_plan_toran');
  if (!terms) throw new SignupError('no_terms');
  const e = normEmail(email);
  if (needEmail && !validEmail(e)) throw new SignupError('bad_email');
  return { name: n, business: b, email: needEmail ? e : null, products: chosen, plan: chosen.includes('teder') ? plan || defaultPlan('teder') : null, plan_toran: chosen.includes('toran') ? plan_toran || defaultPlan('toran') : null };
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
    plan: form.plan ?? null,
    plan_toran: form.plan_toran ?? null,
    terms_version: TERMS_VERSION,
    terms_accepted_at: at,
    created_at: at,
    expires_at: isoIn(SIGNUP_TTL),
    ip,
  });
  audit(db, { actor: null, action: 'signup_requested', ip, detail: { ...(form.email ? { email: form.email } : {}), kind, products: form.products, ...(form.plan ? { plan: form.plan } : {}), ...(form.plan_toran ? { plan_toran: form.plan_toran } : {}) } });
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
export function completeSignup(db, token, { kind = 'email', email = null, ip = null, env = process.env } = {}) {
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
      { name: row.business, slug: slugFor(db, row.business), products: row.products, plans: { teder: row.plan, toran: row.plan_toran }, terms: { version: row.terms_version, at: row.terms_accepted_at } },
      { by: user, ip, source: 'signup' }
    );
    db.insert('memberships', { user_id: user.id, workspace_id: workspace.id, role: 'client_owner', created_at: t });
    // One of the founders' spots, while any is left: no setup fee for what this sign-up chose (src/accounts/founders.js).
    const founder = takeFoundersSpot(db, workspace.id, { env, by: user, ip });
    db.update('signups', row.id, { user_id: user.id, workspace_id: workspace.id, email: address });
    audit(db, { actor: user, action: 'signed_up', workspaceId: workspace.id, ip, detail: { method: kind, products: row.products, ...(row.plan ? { plan: row.plan } : {}), ...(row.plan_toran ? { plan_toran: row.plan_toran } : {}), terms: row.terms_version, ...(founder ? { founder } : {}) } });
    return { user, workspace, founder };
  });
}

// ---- a product added to an account that is open already
//
// The owner, 2026-11-11, before the launch: a customer of one product adds the other from their own account (the home
// page's "עוד מאיתנו", and /signup while signed in), in the same workspace: the same sign-in and people, one bill. Until
// now only the operator could turn a product on, and "sign out and use another address" made a second workspace.

/**
 * An owner adds a product their workspace does not have, the sign-up's way: the product turned on, its subscription at
 * the list price of the plan chosen with nothing paid (ensureSubscription), today's terms (TERMS_VERSION) recorded as
 * accepted by them and by the workspace, as a sign-up records them, and the founders' offer by the sign-up's rule
 * (src/accounts/founders.js): a workspace holding a spot adds it with no setup fee (its products together are one
 * spot), and one that does not takes a spot while any is left, for this product. One transaction. Returns { product,
 * plan, founder: { spot, spots, already } | null }, or throws SignupError:
 *   product_closed  sign-up does not sell it (`open`: OF_SIGNUP and OF_SIGNUP_PRODUCTS)
 *   bad_plan, bad_plan_toran, no_terms
 *   not_owner       `by` is not an owner of the workspace, or the workspace is closed
 *   already         it is on in the workspace already
 *   had_before      the workspace had it before (its subscription is kept): the operator brings it back on /admin,
 *                   where what was paid and agreed for it is
 * The terms accepted here move a workspace on the terms from before 2026-11-03 to today's (the 72 hours,
 * subscriptions.js graceChange()), as a sign-up today would be: the box names today's terms, and its owner ticked it.
 */
export function addProduct(db, { workspaceId, product, plan = '', terms = false, by, ip = null, env = process.env, open = PRODUCTS }) {
  if (!PRODUCTS.includes(product) || !open.includes(product)) throw new SignupError('product_closed');
  if (plan && !Object.hasOwn(PLANS[product] || {}, plan)) throw new SignupError(product === 'toran' ? 'bad_plan_toran' : 'bad_plan');
  if (!terms) throw new SignupError('no_terms');
  return db.tx(() => {
    const w = db.get("SELECT w.* FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ? AND m.role = 'client_owner' WHERE w.id = ?", by.id, Number(workspaceId));
    if (!w || w.disabled_at || w.deleted_at) throw new SignupError('not_owner');
    if (db.get('SELECT 1 FROM workspace_products WHERE workspace_id = ? AND product = ? AND enabled = 1', w.id, product)) throw new SignupError('already');
    if (db.get('SELECT 1 FROM subscriptions WHERE workspace_id = ? AND product = ?', w.id, product)) throw new SignupError('had_before');
    const t = nowIso();
    const chosen = plan || defaultPlan(product);
    db.run(
      'INSERT INTO workspace_products (workspace_id, product, enabled, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(workspace_id, product) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at',
      w.id,
      product,
      t
    );
    ensureSubscription(db, w.id, product, undefined, chosen);
    let founder = null;
    const held = spotOf(db, w.id);
    if (held != null) {
      db.run('UPDATE subscriptions SET setup = 0, updated_at = ? WHERE workspace_id = ? AND product = ?', t, w.id, product);
      founder = { spot: held, spots: foundersSpots(env), already: true };
    } else {
      const spot = takeFoundersSpot(db, w.id, { env, by, ip, product });
      if (spot) founder = { spot, spots: foundersSpots(env), already: false };
    }
    db.update('users', by.id, { terms_version: TERMS_VERSION, terms_accepted_at: t });
    db.update('workspaces', w.id, { terms_version: TERMS_VERSION, terms_accepted_at: t });
    audit(db, { actor: by, action: 'product_added', workspaceId: w.id, ip, detail: { product, plan: chosen, terms: TERMS_VERSION, ...(founder ? { founder: founder.spot } : {}) } });
    return { product, plan: chosen, founder };
  });
}

/** Whether a workspace held `product` before (its subscription is kept, turned off or ended): addProduct() refuses it. */
export const hadProduct = (db, workspaceId, product) => Boolean(db.get('SELECT 1 FROM subscriptions WHERE workspace_id = ? AND product = ?', Number(workspaceId), product));

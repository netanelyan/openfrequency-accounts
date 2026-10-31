import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { setNow } from '../src/core/clock.js';
import { claimPhone, createLinkCode } from '../src/accounts/phones.js';

// Every test runs against a throwaway OF_HOME and a fresh database, never
// against ./private/. No key is ever set, so no email can leave the machine.

delete process.env.RESEND_API_KEY;

/** Databases opened by a test, closed before its folder is removed (Windows will not delete an open file). */
const opened = [];

const T0 = '2026-10-22T10:00:00.000Z';

/** A customer, or the superadmin with { superadmin: true }. Returns the row. */
export function makeUser(db, email, { superadmin = false, name = '' } = {}) {
  const id = db.insert('users', {
    email,
    name,
    is_superadmin: superadmin ? 1 : 0,
    password_hash: superadmin ? 'scrypt$00$00' : null,
    totp_secret: superadmin ? 'JBSWY3DPEHPK3PXP' : null,
    created_at: T0,
  });
  return db.get('SELECT * FROM users WHERE id = ?', id);
}

/**
 * A workspace with its products turned on, and members as { email: role }. Returns the row. Made after the paywall's
 * migration, it is unpaid, as a new sign-up is; `comp: true` marks its products complimentary (free), as every
 * workspace that existed before the paywall is, for the tests that are not about paying.
 */
export function makeWorkspace(db, slug, { products = ['teder'], members = {}, name = slug, comp = false } = {}) {
  const id = db.insert('workspaces', { slug, name, created_at: T0 });
  for (const p of products) db.insert('workspace_products', { workspace_id: id, product: p, enabled: 1, comp: comp ? 1 : 0, updated_at: T0 });
  for (const [email, role] of Object.entries(members)) {
    const u = db.get('SELECT id FROM users WHERE email = ?', email) || makeUser(db, email);
    db.insert('memberships', { user_id: u.id, workspace_id: id, role, created_at: T0 });
  }
  return db.get('SELECT * FROM workspaces WHERE id = ?', id);
}

/** A WhatsApp number linked to a user in a workspace, the way it really happens: a code, then the claim. Returns the owner. */
export function linkPhone(db, phone, user, workspace, { optIn = true } = {}) {
  const { code } = createLinkCode(db, { user, workspaceId: workspace.id, optIn });
  return claimPhone(db, { code, phone });
}

/** A fresh private folder with an empty, migrated database. */
export function tempHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'of-accounts-test-'));
  process.env.OF_HOME = home;
  const db = new Db(path.join(home, 'data', 'accounts.db'));
  opened.push(db);
  return {
    home,
    db,
    cleanup: () => {
      setNow(null);
      while (opened.length) {
        try {
          opened.pop().close();
        } catch {
          /* already closed */
        }
      }
      try {
        rmSync(home, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* a leftover temp folder is harmless */
      }
    },
  };
}

/**
 * A page without our own two script files (layout() puts a11y.js, the accessibility panel, and load.js, the loading
 * state, on every page): what is left must hold no script at all.
 */
export const withoutLoadJs = (html) =>
  String(html)
    .replace(/<script src="\/static\/a11y\.js\?v=[^"]+"><\/script>\n?/, '')
    .replace(/<script src="\/static\/load\.js\?v=[^"]+" defer><\/script>\n?/, '');

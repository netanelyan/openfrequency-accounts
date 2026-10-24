import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';
import { MIGRATIONS } from '../src/db/schema.js';
import { audit } from '../src/core/audit.js';
import { j } from '../src/db/index.js';

const t0 = '2026-10-22T10:00:00.000Z';

test('a fresh database runs every migration and records how many', () => {
  const h = tempHome();
  try {
    assert.equal(h.db.get('PRAGMA user_version').user_version, MIGRATIONS.length);
    const tables = h.db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const t of ['users', 'recovery_codes', 'workspaces', 'memberships', 'workspace_products', 'subscriptions', 'sessions', 'tokens', 'audit', 'phone_links', 'user_phones', 'invoices']) assert.ok(tables.includes(t), t);
  } finally {
    h.cleanup();
  }
});

test('emails are unique without regard to case', () => {
  const h = tempHome();
  try {
    h.db.insert('users', { email: 'dana@example.com', created_at: t0 });
    assert.throws(() => h.db.insert('users', { email: 'Dana@Example.com', created_at: t0 }), /UNIQUE/);
    assert.equal(h.db.get('SELECT id FROM users WHERE email = ?', 'DANA@example.COM').id, 1);
  } finally {
    h.cleanup();
  }
});

test('a superadmin cannot exist without a password and a TOTP secret', () => {
  const h = tempHome();
  try {
    assert.throws(() => h.db.insert('users', { email: 'a@example.com', is_superadmin: 1, created_at: t0 }), /CHECK/);
    assert.throws(() => h.db.insert('users', { email: 'a@example.com', is_superadmin: 1, password_hash: 'x', created_at: t0 }), /CHECK/);
    h.db.insert('users', { email: 'a@example.com', is_superadmin: 1, password_hash: 'x', totp_secret: 'y', created_at: t0 });
  } finally {
    h.cleanup();
  }
});

test('roles, products and slugs are limited to the known values', () => {
  const h = tempHome();
  try {
    const u = h.db.insert('users', { email: 'dana@example.com', created_at: t0 });
    const w = h.db.insert('workspaces', { slug: 'dana-shop', name: 'Dana Shop', created_at: t0 });
    for (const slug of ['Dana', '-dana', 'dana shop', 'דנה', '']) assert.throws(() => h.db.insert('workspaces', { slug, name: 'x', created_at: t0 }), /CHECK/, slug);
    assert.throws(() => h.db.insert('memberships', { user_id: u, workspace_id: w, role: 'superadmin', created_at: t0 }), /CHECK/);
    h.db.insert('memberships', { user_id: u, workspace_id: w, role: 'client_owner', created_at: t0 });
    assert.throws(() => h.db.insert('workspace_products', { workspace_id: w, product: 'other', enabled: 1, updated_at: t0 }), /CHECK/);
    h.db.insert('workspace_products', { workspace_id: w, product: 'teder', enabled: 1, updated_at: t0 });
  } finally {
    h.cleanup();
  }
});

test('a linked number is international digits, nothing else', () => {
  const h = tempHome();
  try {
    const u = h.db.insert('users', { email: 'dana@example.com', created_at: t0 });
    const w = h.db.insert('workspaces', { slug: 'dana-shop', name: 'Dana Shop', created_at: t0 });
    const row = (phone) => ({ phone, user_id: u, workspace_id: w, verified_at: t0, created_at: t0 });
    for (const phone of ['+972500000123', '0500000123', '972-50000012', '1234567', '1234567890123456', '97250000012a']) assert.throws(() => h.db.insert('user_phones', row(phone)), /CHECK/, phone);
    h.db.insert('user_phones', row('972500000123'));
    assert.throws(() => h.db.insert('user_phones', row('972500000123')), /UNIQUE|PRIMARY/);
  } finally {
    h.cleanup();
  }
});

test('an invite needs a workspace and a role; a magic link does not', () => {
  const h = tempHome();
  try {
    const base = { email: 'dana@example.com', created_at: t0, expires_at: t0 };
    h.db.insert('tokens', { ...base, token_hash: 'a', kind: 'magic' });
    assert.throws(() => h.db.insert('tokens', { ...base, token_hash: 'b', kind: 'invite' }), /CHECK/);
  } finally {
    h.cleanup();
  }
});

test('removing a workspace removes its memberships and products, and leaves its sessions signed out of it', () => {
  const h = tempHome();
  try {
    const u = h.db.insert('users', { email: 'dana@example.com', created_at: t0 });
    const w = h.db.insert('workspaces', { slug: 'dana-shop', name: 'Dana Shop', created_at: t0 });
    h.db.insert('memberships', { user_id: u, workspace_id: w, role: 'client_owner', created_at: t0 });
    h.db.insert('workspace_products', { workspace_id: w, product: 'toran', enabled: 1, updated_at: t0 });
    h.db.insert('sessions', { id_hash: 'h', user_id: u, workspace_id: w, created_at: t0, last_seen_at: t0, expires_at: t0 });
    h.db.run('DELETE FROM workspaces WHERE id = ?', w);
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM memberships').n, 0);
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM workspace_products').n, 0);
    assert.equal(h.db.get('SELECT workspace_id FROM sessions').workspace_id, null);
  } finally {
    h.cleanup();
  }
});

test('the audit log records who, what and where, with the detail as JSON', () => {
  const h = tempHome();
  try {
    audit(h.db, { action: 'boot' });
    audit(h.db, { actor: { id: 7, email: 'admin@example.com' }, action: 'workspace_created', workspaceId: 3, ip: '203.0.113.9', detail: { slug: 'dana-shop' } });
    const [a, b] = h.db.all('SELECT * FROM audit ORDER BY id');
    assert.equal(a.actor, 'system');
    assert.equal(a.actor_id, null);
    assert.equal(b.actor, 'admin@example.com');
    assert.equal(b.workspace_id, 3);
    assert.deepEqual(j(b.detail_json), { slug: 'dana-shop' });
  } finally {
    h.cleanup();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { advance, setNow, DAY, HOUR, MINUTE } from '../src/core/clock.js';
import { hashToken } from '../src/auth/tokens.js';
import { chooseWorkspace, createSession, describeSession, findSession, LIFETIME, revokeAllSessions, revokeSession, sessionCookie, sessionFromJar } from '../src/auth/sessions.js';

const T = '2026-10-22T10:00:00.000Z';

function setup() {
  const h = tempHome();
  setNow(T);
  const dana = makeUser(h.db, 'dana@example.com', { name: 'Dana' });
  const shop = makeWorkspace(h.db, 'dana-shop', { name: 'Dana Shop', products: ['toran', 'teder'], members: { 'dana@example.com': 'client_owner' } });
  return { ...h, dana, shop };
}

test('the cookie holds a random id; the database holds only its hash', () => {
  const h = setup();
  try {
    const { id, row } = createSession(h.db, h.dana, { ip: '203.0.113.5', userAgent: 'Firefox' });
    assert.match(id, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(row.id_hash, hashToken(id));
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?', id).n, 0);
    assert.notEqual(createSession(h.db, h.dana).id, id);
    assert.equal(findSession(h.db, id).user.email, 'dana@example.com');
  } finally {
    h.cleanup();
  }
});

test('a customer session answers with the user, the workspace, the role and the products', () => {
  const h = setup();
  try {
    const { id } = createSession(h.db, h.dana);
    assert.deepEqual(describeSession(h.db, id), {
      status: 200,
      body: {
        user: { id: h.dana.id, email: 'dana@example.com', name: 'Dana', superadmin: false },
        workspace: { id: h.shop.id, slug: 'dana-shop', name: 'Dana Shop', disabled: false },
        role: 'client_owner',
        products: ['teder', 'toran'],
        readOnly: false,
        viewAs: null,
        expiresAt: new Date(Date.parse(T) + 30 * DAY).toISOString(),
      },
    });
  } finally {
    h.cleanup();
  }
});

test('unknown, malformed and missing ids are no session, without a lookup error', () => {
  const h = setup();
  try {
    for (const bad of ['', null, undefined, 'x', 'A'.repeat(43), `${'A'.repeat(42)}=`, "' OR 1=1 --"]) {
      assert.deepEqual(describeSession(h.db, bad), { status: 401, body: { error: 'no_session' } }, String(bad));
    }
  } finally {
    h.cleanup();
  }
});

test('signing out ends that session only', () => {
  const h = setup();
  try {
    const phone = createSession(h.db, h.dana).id;
    const laptop = createSession(h.db, h.dana).id;
    assert.ok(revokeSession(h.db, phone, { ip: '203.0.113.5' }));
    assert.equal(describeSession(h.db, phone).status, 401);
    assert.equal(describeSession(h.db, laptop).status, 200);
    // A second sign-out of the same session is a no-op.
    assert.equal(revokeSession(h.db, phone), false);
    const a = h.db.get("SELECT * FROM audit WHERE action = 'sign_out'");
    assert.equal(a.actor, 'dana@example.com');
    assert.equal(a.ip, '203.0.113.5');
  } finally {
    h.cleanup();
  }
});

test('"sign out on all devices" ends every session of that user and no one else\'s', () => {
  const h = setup();
  try {
    const mine = [createSession(h.db, h.dana).id, createSession(h.db, h.dana).id, createSession(h.db, h.dana).id];
    const other = makeUser(h.db, 'noa@example.com');
    h.db.insert('memberships', { user_id: other.id, workspace_id: h.shop.id, role: 'client_member', created_at: T });
    const theirs = createSession(h.db, other).id;
    assert.equal(revokeAllSessions(h.db, h.dana.id), 3);
    for (const id of mine) assert.equal(describeSession(h.db, id).status, 401);
    assert.equal(describeSession(h.db, theirs).status, 200);
    assert.equal(h.db.get("SELECT COUNT(*) AS n FROM sessions WHERE revoked_reason = 'sign_out_all'").n, 3);
    assert.match(h.db.get("SELECT detail_json FROM audit WHERE action = 'sign_out_all'").detail_json, /"sessions":3/);
  } finally {
    h.cleanup();
  }
});

test('a customer session ends after 14 idle days, and use keeps it alive up to 30 days', () => {
  const h = setup();
  try {
    const { id } = createSession(h.db, h.dana);
    advance(13 * DAY);
    assert.equal(describeSession(h.db, id).status, 200); // used: the idle clock restarts
    advance(14 * DAY - MINUTE);
    assert.equal(describeSession(h.db, id).status, 200, '27 days in, never idle 14');
    // Day 27 + 14 idle days would be past 30 anyway; check idleness alone on a fresh one.
    const idle = createSession(h.db, h.dana).id;
    advance(14 * DAY);
    assert.equal(describeSession(h.db, idle).status, 401, 'idle 14 days');

    const start = Date.parse(T) + 60 * DAY;
    setNow(start);
    const busy = createSession(h.db, h.dana).id;
    for (let d = 1; d < 30; d++) {
      setNow(start + d * DAY);
      assert.equal(describeSession(h.db, busy).status, 200, `day ${d}`);
    }
    setNow(start + 30 * DAY);
    assert.equal(describeSession(h.db, busy).status, 401, 'past the absolute end');
  } finally {
    h.cleanup();
  }
});

test("the superadmin's session lasts 12 hours, used or not", () => {
  const h = setup();
  try {
    const me = makeUser(h.db, 'admin@example.com', { superadmin: true });
    const { id } = createSession(h.db, me);
    for (let i = 0; i < 11; i++) {
      advance(HOUR);
      assert.equal(describeSession(h.db, id).status, 200);
    }
    advance(HOUR);
    assert.equal(describeSession(h.db, id).status, 401);
    assert.equal(LIFETIME.superadmin.maxMs, 12 * HOUR);
  } finally {
    h.cleanup();
  }
});

test('last_seen_at is written at most once a minute, not on every request', () => {
  const h = setup();
  try {
    const { id, row } = createSession(h.db, h.dana);
    advance(10_000);
    findSession(h.db, id);
    assert.equal(h.db.get('SELECT last_seen_at FROM sessions WHERE id = ?', row.id).last_seen_at, T);
    advance(MINUTE);
    findSession(h.db, id);
    assert.notEqual(h.db.get('SELECT last_seen_at FROM sessions WHERE id = ?', row.id).last_seen_at, T);
  } finally {
    h.cleanup();
  }
});

test('disabling a user ends their sessions at once', () => {
  const h = setup();
  try {
    const { id } = createSession(h.db, h.dana);
    h.db.update('users', h.dana.id, { disabled_at: T });
    assert.equal(describeSession(h.db, id).status, 401);
  } finally {
    h.cleanup();
  }
});

test('the role, the products and the workspace state are read fresh on every call', () => {
  const h = setup();
  try {
    const { id } = createSession(h.db, h.dana);
    h.db.run("UPDATE memberships SET role = 'client_member'");
    assert.equal(describeSession(h.db, id).body.role, 'client_member');
    h.db.run("UPDATE workspace_products SET enabled = 0 WHERE product = 'toran'");
    assert.deepEqual(describeSession(h.db, id).body.products, ['teder']);
    h.db.update('workspaces', h.shop.id, { disabled_at: T });
    assert.deepEqual(describeSession(h.db, id), { status: 403, body: { error: 'workspace_disabled' } });
    h.db.update('workspaces', h.shop.id, { disabled_at: null });
    h.db.run('DELETE FROM memberships');
    assert.deepEqual(describeSession(h.db, id), { status: 403, body: { error: 'no_membership' } });
  } finally {
    h.cleanup();
  }
});

test('a member of several workspaces chooses one, and only one of their own', () => {
  const h = setup();
  try {
    const second = makeWorkspace(h.db, 'dana-studio', { products: ['teder'], members: { 'dana@example.com': 'client_member' } });
    const stranger = makeWorkspace(h.db, 'other-shop', { products: ['teder'] });
    const { id, row } = createSession(h.db, h.dana);
    assert.equal(row.workspace_id, null);
    assert.deepEqual(describeSession(h.db, id), { status: 409, body: { error: 'choose_workspace' } });
    assert.equal(chooseWorkspace(h.db, row, stranger.id), false);
    assert.equal(chooseWorkspace(h.db, row, second.id), true);
    const out = describeSession(h.db, id).body;
    assert.equal(out.workspace.slug, 'dana-studio');
    assert.equal(out.role, 'client_member');
  } finally {
    h.cleanup();
  }
});

test('a disabled workspace does not count when picking the only one', () => {
  const h = setup();
  try {
    const closed = makeWorkspace(h.db, 'closed-shop', { members: { 'dana@example.com': 'client_owner' } });
    h.db.update('workspaces', closed.id, { disabled_at: T });
    assert.equal(createSession(h.db, h.dana).row.workspace_id, h.shop.id);
  } finally {
    h.cleanup();
  }
});

test('the superadmin outside view-as: every product, no workspace', () => {
  const h = setup();
  try {
    const me = makeUser(h.db, 'admin@example.com', { superadmin: true });
    const b = describeSession(h.db, createSession(h.db, me).id).body;
    assert.equal(b.role, 'superadmin');
    assert.equal(b.workspace, null);
    assert.deepEqual(b.products, ['teder', 'toran']);
    assert.equal(b.readOnly, false);
    assert.equal(b.user.superadmin, true);
  } finally {
    h.cleanup();
  }
});

test('view-as is read-only, names who is looking, and shows even a disabled workspace', () => {
  const h = setup();
  try {
    const me = makeUser(h.db, 'admin@example.com', { superadmin: true });
    const { id, row } = createSession(h.db, me);
    h.db.update('sessions', row.id, { view_as_workspace_id: h.shop.id, view_as_since: T });
    h.db.update('workspaces', h.shop.id, { disabled_at: T });
    const b = describeSession(h.db, id).body;
    assert.equal(b.readOnly, true);
    assert.deepEqual(b.viewAs, { by: { id: me.id, email: 'admin@example.com' }, since: T });
    assert.deepEqual(b.workspace, { id: h.shop.id, slug: 'dana-shop', name: 'Dana Shop', disabled: true });
    assert.deepEqual(b.products, ['teder', 'toran']);
    assert.equal(b.role, 'superadmin');
  } finally {
    h.cleanup();
  }
});

test('the cookie: shared with every subdomain behind HTTPS, host-only in development', () => {
  const v = 'A'.repeat(43);
  assert.equal(sessionCookie(v, { secure: true }), `__Secure-of_session=${v}; Path=/; Domain=.openfrequency.co.il; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`);
  assert.equal(sessionCookie(v, { secure: false }), `of_session=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  assert.equal(sessionCookie(v, { secure: true, maxAgeMs: 12 * HOUR }).includes('Max-Age=43200'), true);
  // Clearing must name the same Domain and Path, or the browser keeps the cookie.
  assert.equal(sessionCookie('', { secure: true, clear: true }), '__Secure-of_session=; Path=/; Domain=.openfrequency.co.il; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  // The secure name is read only behind HTTPS, so a cookie set over http cannot pose as it.
  assert.equal(sessionFromJar({ of_session: 'a', '__Secure-of_session': 'b' }, true), 'b');
  assert.equal(sessionFromJar({ of_session: 'a', '__Secure-of_session': 'b' }, false), 'a');
  assert.equal(sessionFromJar({ of_session: 'a' }, true), null);
});

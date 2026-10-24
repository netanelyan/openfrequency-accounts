import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkPhone, makeUser, makeWorkspace, tempHome } from './helpers.js';
import { startSite, TOKEN } from './site.js';
import { advance, nowIso, setNow, HOUR, MINUTE } from '../src/core/clock.js';
import { CODE, CODE_ALPHABET, createLinkCode } from '../src/accounts/phones.js';
import { setDisabled, setProduct } from '../src/accounts/workspaces.js';
import { j } from '../src/db/index.js';

// The owner line's side of accounts, over real HTTP, as Toran calls it (docs/internal-owner-phone.md): who a
// WhatsApp number is, a workspace's numbers, the claim of a link code, and consent. Every number here is fictional
// (050-000-0xxx).

const T0 = '2026-10-24T09:00:00.000Z';
const DANA = '972500000123';
const NOA = '972500000124';

async function setup(env) {
  const h = tempHome();
  setNow(T0);
  const shop = makeWorkspace(h.db, 'dana-shop', { name: 'Dana Shop', products: ['toran', 'teder'], members: { 'dana@example.com': 'client_owner', 'noa@example.com': 'client_member' } });
  const other = makeWorkspace(h.db, 'other-shop', { products: ['toran'], members: { 'gil@example.com': 'client_owner' } });
  h.db.run("UPDATE users SET name = 'Dana' WHERE email = 'dana@example.com'");
  const user = (email) => h.db.get('SELECT * FROM users WHERE email = ?', email);
  const site = await startSite(h.db, { env });
  const claim = (code, phone) => site.owners('POST', '/internal/owner-phone/claim', { code, phone });
  const lookup = (phone) => site.owners('GET', `/internal/owner-phone?phone=${encodeURIComponent(phone)}`);
  const consent = (phone, optIn, source = 'whatsapp') => site.owners('POST', '/internal/owner-phone/consent', { phone, optIn, source });
  return { ...h, ...site, shop, other, dana: user('dana@example.com'), noa: user('noa@example.com'), gil: user('gil@example.com'), claim, lookup, consent, done: async () => (await site.close(), h.cleanup()) };
}

const actions = (db) => db.all("SELECT action, actor, workspace_id, detail_json FROM audit WHERE action LIKE 'phone_%' ORDER BY id");

test('a code sent from a number links it: the owner, exactly as documented, never cached', async () => {
  const t = await setup();
  try {
    const { code, expiresAt } = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id, optIn: true });
    assert.match(code, CODE);
    assert.equal(expiresAt, '2026-10-24T09:30:00.000Z');
    advance(2 * MINUTE);
    const r = await t.claim(code, DANA);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /^application\/json/);
    const owner = {
      phone: DANA,
      verifiedAt: '2026-10-24T09:02:00.000Z',
      user: { id: t.dana.id, name: 'Dana', email: 'dana@example.com' },
      workspace: { id: t.shop.id, slug: 'dana-shop', name: 'Dana Shop', disabled: false },
      role: 'client_owner',
      products: ['teder', 'toran'],
      optIn: { at: T0, source: 'accounts' },
      optOut: null,
    };
    assert.deepEqual(r.json, owner);
    assert.deepEqual(Object.keys(r.json), Object.keys(owner), 'in the documented order');

    const again = await t.lookup(DANA);
    assert.equal(again.status, 200);
    assert.equal(again.headers['cache-control'], 'no-store');
    assert.deepEqual(again.json, owner);

    const row = t.db.get('SELECT * FROM phone_links WHERE code = ?', code);
    assert.deepEqual([row.used_at, row.used_phone], ['2026-10-24T09:02:00.000Z', DANA]);
    // The audit log: the code made, the link, the opt-in. Never the code itself.
    assert.deepEqual(
      actions(t.db).map((a) => [a.action, a.actor, a.workspace_id]),
      [
        ['phone_link_created', 'dana@example.com', t.shop.id],
        ['phone_linked', 'dana@example.com', t.shop.id],
        ['phone_opt_in', 'dana@example.com', t.shop.id],
      ]
    );
    assert.ok(!t.db.all('SELECT detail_json FROM audit').some((a) => String(a.detail_json).includes(code)));
    assert.deepEqual(j(actions(t.db)[2].detail_json), { phone: DANA, at: T0, source: 'accounts' });
  } finally {
    await t.done();
  }
});

test('a code made without the box ticked links the number with no consent at all', async () => {
  const t = await setup();
  try {
    const owner = linkPhone(t.db, NOA, t.noa, t.shop, { optIn: false });
    assert.equal(owner.role, 'client_member');
    assert.equal(owner.user.name, '');
    assert.deepEqual([owner.optIn, owner.optOut], [null, null]);
    assert.deepEqual(actions(t.db).map((a) => a.action), ['phone_link_created', 'phone_linked']);
  } finally {
    await t.done();
  }
});

test('a number nobody linked is not_linked; anything but international digits is bad_phone', async () => {
  const t = await setup();
  try {
    assert.deepEqual(await t.lookup('972500000199').then((r) => [r.status, r.json]), [404, { error: 'not_linked' }]);
    for (const phone of ['', '+972500000123', '0500000123', '050-000-0123', '97250000012a', '1234567', '1234567890123456', ' 972500000123', '972 500000123']) {
      const r = await t.lookup(phone);
      assert.deepEqual([r.status, r.json], [400, { error: 'bad_phone' }], JSON.stringify(phone));
    }
    const none = await t.owners('GET', '/internal/owner-phone');
    assert.deepEqual([none.status, none.json], [400, { error: 'bad_phone' }]);
    // The shortest and the longest that are numbers.
    for (const phone of ['12345678', '123456789012345']) assert.equal((await t.lookup(phone)).status, 404, phone);
  } finally {
    await t.done();
  }
});

test("a workspace's numbers: verified ones only, its own, possibly none", async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    linkPhone(t.db, NOA, t.noa, t.shop, { optIn: false });
    linkPhone(t.db, '972500000125', t.gil, t.other);
    createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id }); // a code not sent yet is no number
    const r = await t.owners('GET', `/internal/owner-phones?workspace=${t.shop.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(r.json.phones.map((o) => [o.phone, o.user.email, o.role]), [
      [DANA, 'dana@example.com', 'client_owner'],
      [NOA, 'noa@example.com', 'client_member'],
    ]);
    assert.deepEqual((await t.owners('GET', `/internal/owner-phones?workspace=${t.other.id}`)).json.phones.map((o) => o.phone), ['972500000125']);
    assert.deepEqual((await t.owners('GET', '/internal/owner-phones?workspace=999')).json, { phones: [] });
    for (const q of ['', '?workspace=', '?workspace=abc', '?workspace=0', '?workspace=-1', '?workspace=1.5'])
      assert.deepEqual(await t.owners('GET', `/internal/owner-phones${q}`).then((x) => [x.status, x.json]), [400, { error: 'bad_workspace' }], q);
  } finally {
    await t.done();
  }
});

test('what the superadmin changes is in the next answer: products, a disabled workspace, a member removed', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    linkPhone(t.db, NOA, t.noa, t.shop);
    const admin = makeUser(t.db, 'admin@example.com', { superadmin: true });
    setProduct(t.db, t.shop.id, 'teder', false, { by: admin });
    assert.deepEqual((await t.lookup(DANA)).json.products, ['toran']);

    setDisabled(t.db, t.shop.id, true, { by: admin });
    const closed = await t.lookup(DANA);
    assert.equal(closed.status, 200);
    assert.equal(closed.json.workspace.disabled, true);
    assert.equal((await t.owners('GET', `/internal/owner-phones?workspace=${t.shop.id}`)).json.phones.every((o) => o.workspace.disabled), true);
    setDisabled(t.db, t.shop.id, false, { by: admin });

    // Noa leaves the workspace: her number is nobody's, and a disabled user's is nobody's either.
    t.db.run('DELETE FROM memberships WHERE user_id = ?', t.noa.id);
    assert.equal((await t.lookup(NOA)).status, 404);
    assert.deepEqual((await t.owners('GET', `/internal/owner-phones?workspace=${t.shop.id}`)).json.phones.map((o) => o.phone), [DANA]);
    t.db.run("UPDATE users SET disabled_at = ? WHERE id = ?", T0, t.dana.id);
    assert.equal((await t.lookup(DANA)).status, 404);
  } finally {
    await t.done();
  }
});

test('the claim: unknown_code, expired after 30 minutes, used once, and a code in any case', async () => {
  const t = await setup();
  try {
    assert.deepEqual(await t.claim('LINK-ABCDEF', DANA).then((r) => [r.status, r.json]), [404, { error: 'unknown_code' }]);
    for (const code of ['', 'LINK-', 'LINK-ABCDE0', 'ABCDEF', 'LINK-ABCDEFG']) assert.equal((await t.claim(code, DANA)).json.error, 'unknown_code', code);

    const late = createLinkCode(t.db, { user: t.dana, workspaceId: t.other.id }).code; // not hers to use: she is not in it
    assert.equal((await t.claim(late, DANA)).json.error, 'unknown_code');

    const { code } = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id });
    advance(30 * MINUTE);
    assert.deepEqual(await t.claim(code, DANA).then((r) => [r.status, r.json]), [410, { error: 'expired' }]);

    const fresh = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id }).code;
    advance(30 * MINUTE - 1000);
    assert.equal((await t.claim(` ${fresh.toLowerCase()} `, DANA)).status, 200, 'typed by hand: lower case and spaces');
    assert.deepEqual(await t.claim(fresh, DANA).then((r) => [r.status, r.json]), [409, { error: 'used' }]);
    assert.deepEqual(await t.claim(fresh, NOA).then((r) => [r.status, r.json]), [409, { error: 'used' }]);
    advance(MINUTE);
    assert.equal((await t.claim(fresh, DANA)).json.error, 'used', 'used is said even once it has expired');
  } finally {
    await t.done();
  }
});

test('a new code ends the one before it', async () => {
  const t = await setup();
  try {
    const first = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id }).code;
    advance(MINUTE);
    const second = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id }).code;
    assert.notEqual(first, second);
    assert.equal((await t.claim(first, DANA)).json.error, 'expired');
    assert.equal((await t.claim(second, DANA)).status, 200);
  } finally {
    await t.done();
  }
});

test('a number already linked: again by the same person verifies it again with the new answer; anyone else is phone_taken', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop, { optIn: true });
    advance(2 * HOUR);
    // Dana makes a new code, this time without the box: verified now, and the updates stop.
    const { code } = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id, optIn: false });
    advance(MINUTE);
    const r = await t.claim(code, DANA);
    assert.equal(r.status, 200);
    assert.equal(r.json.verifiedAt, '2026-10-24T11:01:00.000Z');
    assert.deepEqual(r.json.optIn, { at: T0, source: 'accounts' });
    assert.deepEqual(r.json.optOut, { at: '2026-10-24T11:00:00.000Z', source: 'accounts' });
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM user_phones').n, 1);
    assert.equal(j(actions(t.db).find((a) => a.action === 'phone_linked' && j(a.detail_json).again)?.detail_json)?.phone, DANA);

    // And ticked again: the updates are back.
    const yes = createLinkCode(t.db, { user: t.dana, workspaceId: t.shop.id, optIn: true }).code;
    advance(MINUTE);
    const back = await t.claim(yes, DANA);
    assert.deepEqual([back.json.optIn, back.json.optOut], [{ at: '2026-10-24T11:01:00.000Z', source: 'accounts' }, null]);

    // Another workspace, and another person in the same one, cannot take it.
    const gil = createLinkCode(t.db, { user: t.gil, workspaceId: t.other.id }).code;
    assert.deepEqual(await t.claim(gil, DANA).then((x) => [x.status, x.json]), [409, { error: 'phone_taken' }]);
    const noa = createLinkCode(t.db, { user: t.noa, workspaceId: t.shop.id }).code;
    assert.equal((await t.claim(noa, DANA)).json.error, 'phone_taken');
    // A refused claim spends nothing: the code still works for a number of its own.
    assert.equal((await t.claim(gil, '972500000125')).status, 200);
    assert.equal((await t.lookup(DANA)).json.user.email, 'dana@example.com');
  } finally {
    await t.done();
  }
});

test('a number whose person left the workspace can be linked again by someone else', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, NOA, t.noa, t.shop);
    t.db.run('DELETE FROM memberships WHERE user_id = ?', t.noa.id);
    const code = createLinkCode(t.db, { user: t.gil, workspaceId: t.other.id }).code;
    const r = await t.claim(code, NOA);
    assert.equal(r.status, 200);
    assert.equal(r.json.workspace.slug, 'other-shop');
    assert.equal(r.json.optOut, null);
  } finally {
    await t.done();
  }
});

test('consent: "הפסק" and "התחל" from WhatsApp, the later one speaks, each one audited', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop, { optIn: true });
    advance(MINUTE);
    const stop = await t.consent(DANA, false);
    assert.equal(stop.status, 200);
    assert.equal(stop.headers['cache-control'], 'no-store');
    assert.deepEqual([stop.json.optIn, stop.json.optOut], [{ at: T0, source: 'accounts' }, { at: '2026-10-24T09:01:00.000Z', source: 'whatsapp' }]);
    advance(MINUTE);
    const start = await t.consent(DANA, true);
    assert.deepEqual([start.json.optIn, start.json.optOut], [{ at: '2026-10-24T09:02:00.000Z', source: 'whatsapp' }, null]);
    // The same word twice in the same moment changes nothing; on a tie, the opt-out speaks.
    assert.deepEqual((await t.consent(DANA, true)).json.optIn, { at: '2026-10-24T09:02:00.000Z', source: 'whatsapp' });
    const tie = await t.consent(DANA, false);
    assert.deepEqual(tie.json.optOut, { at: '2026-10-24T09:02:00.000Z', source: 'whatsapp' });
    // The source defaults to WhatsApp.
    advance(MINUTE);
    assert.deepEqual((await t.owners('POST', '/internal/owner-phone/consent', { phone: DANA, optIn: true })).json.optIn.source, 'whatsapp');

    assert.deepEqual(
      actions(t.db).filter((a) => a.action.startsWith('phone_opt')).map((a) => [a.action, j(a.detail_json).source, a.actor]),
      [
        ['phone_opt_in', 'accounts', 'dana@example.com'],
        ['phone_opt_out', 'whatsapp', 'dana@example.com'],
        ['phone_opt_in', 'whatsapp', 'dana@example.com'],
        ['phone_opt_out', 'whatsapp', 'dana@example.com'],
        ['phone_opt_in', 'whatsapp', 'dana@example.com'],
      ]
    );
    assert.deepEqual(await t.consent('972500000199', false).then((r) => [r.status, r.json]), [404, { error: 'not_linked' }]);
  } finally {
    await t.done();
  }
});

test('a body that is not what the route takes is bad, a phone that is not digits bad_phone, a big one too_large', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    const post = (path, body) => t.owners('POST', path, body).then((r) => [r.status, r.json]);
    for (const path of ['/internal/owner-phone/claim', '/internal/owner-phone/consent']) {
      for (const body of ['', '{', 'null', '[]', '"x"', '42']) assert.deepEqual(await post(path, body), [400, { error: 'bad' }], `${path} ${body}`);
      assert.deepEqual(await post(path, { phone: '+972500000123', code: 'LINK-ABCDEF', optIn: true }), [400, { error: 'bad_phone' }]);
      assert.deepEqual(await post(path, { phone: 972500000123, code: 'LINK-ABCDEF', optIn: true }), [400, { error: 'bad_phone' }]);
      assert.deepEqual(await post(path, JSON.stringify({ phone: DANA, pad: 'x'.repeat(5000) })), [413, { error: 'too_large' }]);
    }
    assert.deepEqual(await post('/internal/owner-phone/claim', { phone: DANA }), [400, { error: 'bad' }]);
    assert.deepEqual(await post('/internal/owner-phone/claim', { phone: DANA, code: 7 }), [400, { error: 'bad' }]);
    for (const extra of [{}, { optIn: 'true' }, { optIn: 1 }, { optIn: true, source: 'WhatsApp' }, { optIn: true, source: '' }, { optIn: true, source: 3 }])
      assert.deepEqual(await post('/internal/owner-phone/consent', { phone: DANA, ...extra }), [400, { error: 'bad' }], JSON.stringify(extra));
    assert.equal(actions(t.db).filter((a) => a.action.startsWith('phone_opt')).length, 1, 'nothing refused was recorded');
  } finally {
    await t.done();
  }
});

test('the same locks as /internal/session: the token, loopback Host, the method, the path', async () => {
  const t = await setup();
  try {
    linkPhone(t.db, DANA, t.dana, t.shop);
    const routes = [
      ['GET', `/internal/owner-phone?phone=${DANA}`, null],
      ['GET', `/internal/owner-phones?workspace=${t.shop.id}`, null],
      ['POST', '/internal/owner-phone/claim', { code: 'LINK-ABCDEF', phone: DANA }],
      ['POST', '/internal/owner-phone/consent', { phone: DANA, optIn: false }],
    ];
    for (const [method, path, body] of routes) {
      for (const auth of ['', 'Bearer wrong', `Bearer ${TOKEN}x`, `Basic ${TOKEN}`]) {
        const r = await t.owners(method, path, body, { authorization: auth });
        assert.deepEqual([r.status, r.json], [401, { error: 'bad_token' }], `${path} ${auth}`);
      }
      for (const host of ['accounts.openfrequency.co.il', 'evil.example', `127.0.0.1:${t.s.internalPort + 1}`]) {
        const r = await t.owners(method, path, body, { host });
        assert.deepEqual([r.status, r.json], [403, { error: 'bad_host' }], `${path} ${host}`);
      }
    }
    // The method each path takes, and no other.
    for (const [method, path] of [['POST', `/internal/owner-phone?phone=${DANA}`], ['POST', '/internal/owner-phones?workspace=1'], ['GET', '/internal/owner-phone/claim'], ['GET', '/internal/owner-phone/consent'], ['PUT', '/internal/owner-phone/consent'], ['DELETE', `/internal/owner-phone?phone=${DANA}`], ['POST', '/internal/session']])
      assert.deepEqual(await t.owners(method, path, method === 'GET' ? null : {}).then((r) => [r.status, r.json]), [405, { error: 'method_not_allowed' }], `${method} ${path}`);
    for (const path of ['/internal/owner-phone/', '/internal/owner-phone/remove', '/internal/owner']) assert.equal((await t.owners('GET', path)).status, 404, path);
    // Nothing above changed anything.
    assert.equal(actions(t.db).filter((a) => a.action === 'phone_opt_out').length, 0);
  } finally {
    await t.done();
  }
});

test('with OF_INTERNAL_TOKEN unset or short, the owner routes refuse everything too', async () => {
  for (const env of [{ OF_INTERNAL_TOKEN: '' }, { OF_INTERNAL_TOKEN: 'short' }]) {
    const t = await setup(env);
    try {
      linkPhone(t.db, DANA, t.dana, t.shop);
      for (const auth of ['', 'Bearer ', 'Bearer short']) {
        assert.deepEqual((await t.owners('GET', `/internal/owner-phone?phone=${DANA}`, null, { authorization: auth })).json, { error: 'not_configured' });
        assert.deepEqual((await t.owners('POST', '/internal/owner-phone/consent', { phone: DANA, optIn: false }, { authorization: auth })).json, { error: 'not_configured' });
      }
    } finally {
      await t.done();
    }
  }
});

test('the public listener knows nothing of the owner routes', async () => {
  const t = await setup();
  try {
    const r = await fetch(`http://127.0.0.1:${t.s.port}/internal/owner-phone?phone=${DANA}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 404);
  } finally {
    await t.done();
  }
});

test('a link code is LINK- and six of the 31 letters and digits nobody misreads', () => {
  const h = tempHome();
  try {
    const shop = makeWorkspace(h.db, 'dana-shop', { members: { 'dana@example.com': 'client_owner' } });
    const dana = h.db.get("SELECT * FROM users WHERE email = 'dana@example.com'");
    assert.equal(CODE_ALPHABET.length, 31);
    assert.doesNotMatch(CODE_ALPHABET, /[01IOL]/);
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const { code } = createLinkCode(h.db, { user: dana, workspaceId: shop.id });
      assert.match(code, /^LINK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      for (const c of code.slice(5)) seen.add(c);
    }
    assert.ok(seen.size > 25, 'every letter turns up');
    assert.equal(h.db.get('SELECT COUNT(*) AS n FROM phone_links WHERE used_at IS NULL AND expires_at > ?', nowIso()).n, 1, 'only the last one is open');
  } finally {
    h.cleanup();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { linkPhone, makeUser, makeWorkspace, tempHome } from './helpers.js';
import { startSite, TOKEN } from './site.js';
import { setNow } from '../src/core/clock.js';
import { ROOT } from '../src/core/paths.js';
import { createSession } from '../src/auth/sessions.js';
import { ensureSubscription, payMonth, setSubscription } from '../src/accounts/subscriptions.js';
import { cancelSubscription, setComp } from '../src/accounts/entitlement.js';
import { createLinkCode } from '../src/accounts/phones.js';
import { payCodeFor } from '../src/accounts/pay.js';
import { startViewAs } from '../src/accounts/workspaces.js';
import { operatorAssertion } from '../src/web/admin-toran.js';
import { readSetup } from '../src/web/setup.js';
import { eraseClient } from '../src/web/erase.js';
import { changedClient, CHANGED_PATH, REASONS } from '../src/web/changed.js';
import { readLead, readLeads, toranClient } from '../src/web/toran.js';
import { remindClient, REMIND_KINDS, REMIND_PATH } from '../src/web/remind.js';
import { PAY_CODE } from '../src/accounts/pay.js';
import { sampleSetup } from './setup-fake.js';
import { sampleOps } from './toran-fake.js';

// The contracts (docs/contracts, PRA-QA-003), held against the code. Every case of an API accounts serves is asked
// of the real route, in a state made for it, and its answer must have the case's status and the shape of its body
// (the same keys, the same types; a field the case calls nullable may be null). Every API accounts calls is answered
// from its cases, and accounts' client must read each one the way the case says. accounts' fakes of Teder and Toran
// are the contracts' examples, so they cannot drift from them unseen.

const DIR = path.join(ROOT, 'docs', 'contracts');
const contracts = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))])
);

/** Where `actual` does not have the shape of `example`, as a list of paths; [] when it does. */
export function shapeProblems(actual, example, nullable = [], at = '$') {
  const key = at.split('.').at(-1);
  if (actual === null && (example === null || nullable.includes(key))) return [];
  if (example === null) return actual === null || nullable.includes(key) ? [] : [`${at}: null in the contract, ${typeof actual} here`];
  if (Array.isArray(example)) {
    if (!Array.isArray(actual)) return [`${at}: an array in the contract`];
    return example.length && actual.length ? actual.flatMap((a, i) => shapeProblems(a, example[0], nullable, `${at}[${i}]`)) : [];
  }
  if (typeof example === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return [`${at}: an object in the contract`];
    const want = Object.keys(example).sort();
    const got = Object.keys(actual).sort();
    if (want.join() !== got.join()) return [`${at}: keys ${got.join(',')} where the contract has ${want.join(',')}`];
    return want.flatMap((k) => shapeProblems(actual[k], example[k], nullable, `${at}.${k}`));
  }
  return typeof actual === typeof example ? [] : [`${at}: ${typeof actual} where the contract has ${typeof example}`];
}

test('every contract file is complete: who serves it, who calls it, and every answer with a status and an example', () => {
  assert.deepEqual(Object.keys(contracts).sort(), ['admin-leads', 'admin-toran-operator', 'entitlement', 'entitlement-changed', 'notify', 'ops-customers', 'owner-phone', 'pay', 'pay-remind', 'session', 'setup', 'signup', 'toran-ops', 'workspaces-delete']);
  for (const [name, c] of Object.entries(contracts)) {
    assert.equal(c.name, name);
    assert.ok(c.doc && c.servedBy.length && c.calledBy.length, name);
    for (const r of c.routes) {
      assert.ok(r.method && r.path && r.auth && r.answers.length, `${name} ${r.path}`);
      for (const a of r.answers) assert.ok(a.case && Number.isInteger(a.status) && a.body && typeof a.body === 'object', `${name} ${a.case}`);
    }
  }
});

// ---- the APIs accounts serves: each case asked of the real route

async function world() {
  const h = tempHome();
  setNow('2026-10-22T10:00:00.000Z');
  const site = await startSite(h.db);
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'Admin' });
  const dana = makeWorkspace(h.db, 'dana-shop', { name: 'Dana Shop', products: ['teder', 'toran'], members: { 'dana@example.com': 'client_owner' } });
  for (const p of ['teder', 'toran']) ensureSubscription(h.db, dana.id, p);
  const danaUser = h.db.get("SELECT * FROM users WHERE email = 'dana@example.com'");
  const call = (method, p, body = null, headers = {}) => site.owners(method, p, body, headers);
  return { ...h, site, admin, dana, danaUser, call, done: async () => (await site.close(), h.cleanup()) };
}

const ent = (w, id, product = 'teder') => w.call('GET', `/internal/entitlement?workspace=${id}&product=${product}`);
const fresh = (w, slug, products = ['teder']) => {
  const ws = makeWorkspace(w.db, slug, { products, members: { [`${slug}@example.com`]: 'client_owner' } });
  for (const p of products) ensureSubscription(w.db, ws.id, p);
  return ws;
};
const noToken = (w, method, p, body) => w.call(method, p, body, { authorization: 'Bearer wrong-token-wrong-token-wrong-token-x' });
const NOTIFY = { product: 'teder', kind: 'posts_waiting', subject: 'שלושה פוסטים מחכים', text: 'יש פוסטים חדשים.', link: 'https://teder.openfrequency.co.il/review' };
// A receipt as Toran posts it: a PNG's first bytes, which is all the check reads.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const receipt = (code, extra = {}) => ({ code, phone: '972500000123', file: { name: 'shot.png', type: 'image/png', data: PNG }, ...extra });
const pay = (w, code) => w.call('GET', `/internal/pay?code=${encodeURIComponent(code)}`);
const expiredCode = (w) => {
  const { code } = payCodeFor(w.db, w.dana.id);
  setNow('2026-12-22T10:00:00.000Z');
  return code;
};
// The world's site has sign-up closed, as by default; an open one is a second site on the same database, with its settings.
const signupOn = async (w, env) => {
  const s = await startSite(w.db, { env });
  try {
    return await s.owners('GET', '/internal/signup');
  } finally {
    await s.close();
  }
};

// Each case, by "<contract> <path> :: <case>", made and asked. 503 (no token here) is asked of a site started without one.
const RUN = {
  'session /internal/session :: a customer': (w) => w.site.internal(createSession(w.db, w.danaUser).id, 'teder'),
  'session /internal/session :: the superadmin, viewing a workspace as its customer': (w) => {
    const s = createSession(w.db, w.admin);
    startViewAs(w.db, s.row, w.dana.id, { by: w.admin });
    return w.site.internal(s.id, 'teder');
  },
  'session /internal/session :: no session, a signed-out, expired or idle one, or a disabled user': (w) => w.site.internal('nope', 'teder'),
  'session /internal/session :: a member of several workspaces who has not picked one': (w) => {
    const u = makeUser(w.db, 'two@example.com');
    for (const slug of ['one-shop', 'two-shop']) w.db.insert('memberships', { user_id: u.id, workspace_id: makeWorkspace(w.db, slug).id, role: 'client_member', created_at: '2026-10-22T10:00:00.000Z' });
    return w.site.internal(createSession(w.db, u).id, 'teder');
  },
  'session /internal/session :: the workspace was disabled': (w) => {
    const sid = createSession(w.db, w.danaUser).id;
    w.db.run('UPDATE workspaces SET disabled_at = ? WHERE id = ?', '2026-10-22T10:00:00.000Z', w.dana.id);
    return w.site.internal(sid, 'teder');
  },
  'session /internal/session :: ?product= names one the workspace does not have': (w) => {
    const ws = makeWorkspace(w.db, 'teder-only', { products: ['teder'], members: { 'only@example.com': 'client_owner' } });
    return w.site.internal(createSession(w.db, w.db.get("SELECT * FROM users WHERE email = 'only@example.com'"), { workspaceId: ws.id }).id, 'toran');
  },
  'session /internal/session :: ?product= is not teder or toran': (w) => w.site.internal(createSession(w.db, w.danaUser).id, 'nope'),
  'session /internal/session :: no token, or the wrong one': (w) => noToken(w, 'GET', '/internal/session'),

  'entitlement /internal/entitlement :: paid (Teder, the small plan)': (w) => {
    setSubscription(w.db, w.dana.id, 'teder', { plan: 'small', monthly: '490', setup: '990', vat: 'excluded', started_on: '2026-10-22' }, { by: w.admin });
    payMonth(w.db, w.dana.id, 'teder', { by: w.admin });
    return ent(w, w.dana.id);
  },
  'entitlement /internal/entitlement :: due: the paid period is over, in its 72 hours of grace': (w) => {
    const ws = fresh(w, 'due-shop');
    payMonth(w.db, ws.id, 'teder', { by: w.admin });
    setNow('2026-11-24T10:00:00.000Z'); // paid until 21.11: the last of the 3 days
    return ent(w, ws.id);
  },
  'entitlement /internal/entitlement :: unpaid: never paid, or the grace is over': (w) => ent(w, fresh(w, 'unpaid-shop').id),
  'entitlement /internal/entitlement :: cancelled, working until its last day': (w) => {
    const ws = fresh(w, 'gone-shop');
    payMonth(w.db, ws.id, 'teder', { by: w.admin });
    cancelSubscription(w.db, ws.id, 'teder', { by: w.admin });
    return ent(w, ws.id);
  },
  'entitlement /internal/entitlement :: complimentary': (w) => {
    const ws = fresh(w, 'comp-shop');
    setComp(w.db, ws.id, 'teder', true, { by: w.admin });
    return ent(w, ws.id);
  },
  'entitlement /internal/entitlement :: paid (Toran, the big plan)': (w) => {
    const ws = fresh(w, 'toran-big', ['toran']);
    setSubscription(w.db, ws.id, 'toran', { plan: 'big', monthly: '1190', setup: '990', vat: 'excluded', started_on: '2026-10-22' }, { by: w.admin });
    payMonth(w.db, ws.id, 'toran', { by: w.admin });
    return ent(w, ws.id, 'toran');
  },
  'entitlement /internal/entitlement :: off (Toran, its plan as a new subscription would start)': (w) => ent(w, fresh(w, 'teder-shop').id, 'toran'),
  'entitlement /internal/entitlement :: the workspace is not a positive integer': (w) => w.call('GET', '/internal/entitlement?workspace=x&product=teder'),
  'entitlement /internal/entitlement :: a missing or unknown product': (w) => w.call('GET', `/internal/entitlement?workspace=${w.dana.id}&product=nope`),
  'entitlement /internal/entitlement :: an id we never had (a deleted one is 200, off)': (w) => ent(w, 999),
  'entitlement /internal/entitlement :: no token, or the wrong one': (w) => noToken(w, 'GET', `/internal/entitlement?workspace=${w.dana.id}&product=teder`),

  'notify /internal/notify :: sent (sent is 0 when nobody wants this kind)': (w) => w.call('POST', '/internal/notify', { workspace: w.dana.id, ...NOTIFY }),
  'notify /internal/notify :: a field that breaks its rule': (w) => w.call('POST', '/internal/notify', { workspace: w.dana.id, ...NOTIFY, kind: 'nope' }),
  'notify /internal/notify :: a workspace we do not have, or a deleted one': (w) => w.call('POST', '/internal/notify', { workspace: 999, ...NOTIFY }),
  'notify /internal/notify :: the product is not on for it': (w) => w.call('POST', '/internal/notify', { workspace: fresh(w, 'teder-shop').id, ...NOTIFY, product: 'toran', kind: 'conversation_waiting' }),
  'notify /internal/notify :: past 3 of one kind for one product to one workspace in 24 hours': async (w) => {
    for (let i = 0; i < 3; i++) await w.call('POST', '/internal/notify', { workspace: w.dana.id, ...NOTIFY });
    return w.call('POST', '/internal/notify', { workspace: w.dana.id, ...NOTIFY });
  },
  'notify /internal/notify :: no token, or the wrong one': (w) => noToken(w, 'POST', '/internal/notify', { workspace: w.dana.id, ...NOTIFY }),

  'owner-phone /internal/owner-phone :: the owner': (w) => (linkPhone(w.db, '972500000123', w.danaUser, w.dana), w.call('GET', '/internal/owner-phone?phone=972500000123')),
  'owner-phone /internal/owner-phone :: no such number': (w) => w.call('GET', '/internal/owner-phone?phone=972500000199'),
  'owner-phone /internal/owner-phone :: not international digits': (w) => w.call('GET', '/internal/owner-phone?phone=0500000123'),
  'owner-phone /internal/owner-phone :: no token, or the wrong one': (w) => noToken(w, 'GET', '/internal/owner-phone?phone=972500000123'),
  'owner-phone /internal/owner-phones :: every number of the workspace, oldest first': (w) => (linkPhone(w.db, '972500000123', w.danaUser, w.dana), w.call('GET', `/internal/owner-phones?workspace=${w.dana.id}`)),
  'owner-phone /internal/owner-phones :: not a positive integer': (w) => w.call('GET', '/internal/owner-phones?workspace=0'),
  'owner-phone /internal/owner-phones :: no token, or the wrong one': (w) => noToken(w, 'GET', `/internal/owner-phones?workspace=${w.dana.id}`),
  'owner-phone /internal/owner-phone/claim :: linked: the owner': (w) => {
    const { code } = createLinkCode(w.db, { user: w.danaUser, workspaceId: w.dana.id, optIn: true });
    return w.call('POST', '/internal/owner-phone/claim', { code, phone: '972500000123' });
  },
  'owner-phone /internal/owner-phone/claim :: no such code': (w) => w.call('POST', '/internal/owner-phone/claim', { code: 'LINK-ABCDEF', phone: '972500000123' }),
  'owner-phone /internal/owner-phone/claim :: used already': async (w) => {
    const { code } = createLinkCode(w.db, { user: w.danaUser, workspaceId: w.dana.id, optIn: true });
    await w.call('POST', '/internal/owner-phone/claim', { code, phone: '972500000123' });
    return w.call('POST', '/internal/owner-phone/claim', { code, phone: '972500000124' });
  },
  'owner-phone /internal/owner-phone/claim :: 30 minutes have passed, or a newer code was made': (w) => {
    const { code } = createLinkCode(w.db, { user: w.danaUser, workspaceId: w.dana.id, optIn: true });
    setNow('2026-10-22T11:00:00.000Z');
    return w.call('POST', '/internal/owner-phone/claim', { code, phone: '972500000123' });
  },
  "owner-phone /internal/owner-phone/claim :: the number is someone else's": (w) => {
    const other = fresh(w, 'other-shop');
    linkPhone(w.db, '972500000123', w.db.get("SELECT * FROM users WHERE email = 'other-shop@example.com'"), other);
    const { code } = createLinkCode(w.db, { user: w.danaUser, workspaceId: w.dana.id, optIn: true });
    return w.call('POST', '/internal/owner-phone/claim', { code, phone: '972500000123' });
  },
  'owner-phone /internal/owner-phone/claim :: no token, or the wrong one': (w) => noToken(w, 'POST', '/internal/owner-phone/claim', { code: 'LINK-ABCDEF', phone: '972500000123' }),
  'owner-phone /internal/owner-phone/consent :: recorded: the owner': (w) => (linkPhone(w.db, '972500000123', w.danaUser, w.dana), w.call('POST', '/internal/owner-phone/consent', { phone: '972500000123', optIn: false, source: 'whatsapp' })),
  'owner-phone /internal/owner-phone/consent :: no such number': (w) => w.call('POST', '/internal/owner-phone/consent', { phone: '972500000199', optIn: false }),
  'owner-phone /internal/owner-phone/consent :: no token, or the wrong one': (w) => noToken(w, 'POST', '/internal/owner-phone/consent', { phone: '972500000123', optIn: false }),

  'ops-customers /internal/ops/customers :: every workspace, newest first': (w) => {
    setSubscription(w.db, w.dana.id, 'teder', { plan: 'small', monthly: '490', setup: '990', vat: 'excluded', started_on: '2026-10-01' }, { by: w.admin });
    return w.call('GET', '/internal/ops/customers');
  },
  'ops-customers /internal/ops/customers :: no token, or the wrong one': (w) => noToken(w, 'GET', '/internal/ops/customers'),

  'pay /internal/pay :: owed: the first month and the setup fee': (w) => {
    setSubscription(w.db, w.dana.id, 'teder', { plan: 'small', monthly: '490', setup: '990', vat: 'excluded', started_on: '2026-10-22' }, { by: w.admin });
    return pay(w, payCodeFor(w.db, w.dana.id).code.toLowerCase());
  },
  'pay /internal/pay :: nothing owed: paid more than a week ahead, or complimentary': (w) => {
    const ws = fresh(w, 'paid-shop');
    payMonth(w.db, ws.id, 'teder', { by: w.admin });
    return pay(w, payCodeFor(w.db, ws.id).code);
  },
  'pay /internal/pay :: no such code, or its workspace is disabled or deleted': (w) => pay(w, 'PAY-ABCDEF'),
  "pay /internal/pay :: the code's 60 days are over": (w) => pay(w, expiredCode(w)),
  'pay /internal/pay :: no token, or the wrong one': (w) => noToken(w, 'GET', '/internal/pay?code=PAY-ABCDEF'),
  'pay /internal/pay/receipt :: kept, and the operator emailed a link to it': (w) => w.call('POST', '/internal/pay/receipt', receipt(payCodeFor(w.db, w.dana.id).code)),
  "pay /internal/pay/receipt :: the same file as one of the workspace's receipts that waits or was marked paid: that receipt, nothing kept again and nobody emailed": async (w) => {
    const code = payCodeFor(w.db, w.dana.id).code;
    assert.equal((await w.call('POST', '/internal/pay/receipt', receipt(code))).status, 201);
    return w.call('POST', '/internal/pay/receipt', receipt(code));
  },
  'pay /internal/pay/receipt :: the phone is not international digits': (w) => w.call('POST', '/internal/pay/receipt', receipt(payCodeFor(w.db, w.dana.id).code, { phone: '0500000123' })),
  'pay /internal/pay/receipt :: not that shape: no file object, or its data is not base64': (w) => w.call('POST', '/internal/pay/receipt', receipt(payCodeFor(w.db, w.dana.id).code, { file: null })),
  'pay /internal/pay/receipt :: no such code, or its workspace is disabled or deleted': (w) => w.call('POST', '/internal/pay/receipt', receipt('PAY-ABCDEF')),
  "pay /internal/pay/receipt :: the code's 60 days are over": (w) => w.call('POST', '/internal/pay/receipt', receipt(expiredCode(w))),
  'pay /internal/pay/receipt :: the file is over 5 MB, or the body over 7,500,000 bytes': (w) =>
    w.call('POST', '/internal/pay/receipt', receipt(payCodeFor(w.db, w.dana.id).code, { file: { type: 'image/png', data: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') } })),
  'pay /internal/pay/receipt :: not a JPEG, PNG, WebP or PDF, or its first bytes are not the type it says': (w) => w.call('POST', '/internal/pay/receipt', receipt(payCodeFor(w.db, w.dana.id).code, { file: { type: 'image/jpeg', data: PNG } })),
  'pay /internal/pay/receipt :: a sixth receipt from one code in an Israel day': async (w) => {
    const { code } = payCodeFor(w.db, w.dana.id);
    // Six different pictures: the same one again is the receipt already kept (pay.js sameReceipt), not a sixth.
    const shot = (i) => receipt(code, { file: { name: 'shot.png', type: 'image/png', data: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from([i])]).toString('base64') } });
    for (let i = 0; i < 5; i++) assert.equal((await w.call('POST', '/internal/pay/receipt', shot(i))).status, 201);
    return w.call('POST', '/internal/pay/receipt', shot(5));
  },
  'pay /internal/pay/receipt :: no token, or the wrong one': (w) => noToken(w, 'POST', '/internal/pay/receipt', receipt('PAY-ABCDEF')),

  'signup /internal/signup :: open, for the products OF_SIGNUP_PRODUCTS names': (w) => signupOn(w, { OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder' }),
  'signup /internal/signup :: closed: OF_SIGNUP is not 1, so no product': (w) => w.call('GET', '/internal/signup'),
  'signup /internal/signup :: no token, or the wrong one': (w) => noToken(w, 'GET', '/internal/signup'),
};

for (const [name, c] of Object.entries(contracts)) {
  if (!c.servedBy.includes('accounts') || c.kind === 'header') continue;
  for (const r of c.routes) {
    for (const a of r.answers) {
      const key = `${name} ${r.path} :: ${a.case}`;
      test(`contract ${key}`, async () => {
        if (a.status === 503) {
          // Asked of a site with no token of its own.
          const h = tempHome();
          const site = await startSite(h.db, { env: { OF_INTERNAL_TOKEN: '' } });
          try {
            const res = await site.owners(r.method, r.path.replace('<id>', '1'), r.method === 'POST' ? r.request?.body ?? {} : null);
            assert.equal(res.status, 503);
            assert.deepEqual(res.json, a.body);
          } finally {
            await site.close();
            h.cleanup();
          }
          return;
        }
        assert.ok(RUN[key], `no run for ${key}: every case of a route accounts serves is asked of the real route`);
        const w = await world();
        try {
          const res = await RUN[key](w);
          assert.equal(res.status, a.status, `${key}: ${JSON.stringify(res.json)}`);
          assert.deepEqual(shapeProblems(res.json, a.body, a.nullable || []), [], key);
          if (a.status >= 400) assert.deepEqual(res.json, a.body, `${key}: the error code`);
        } finally {
          await w.done();
        }
      });
    }
  }
}

// ---- the APIs accounts calls: its clients read every case as the case says, and its fakes are the contracts' examples

/** A product on 127.0.0.1 that answers every request with `answer()`: { status, body }. */
async function answering(answer) {
  const server = createServer((req, res) => {
    const a = answer(req);
    res.writeHead(a.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(a.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

test('setup: every 200 case passes accounts\' strict reader, and the fake of Teder and Toran is the contract\'s example', () => {
  const r = contracts.setup.routes[0];
  for (const a of r.answers.filter((x) => x.status === 200)) assert.ok(readSetup(a.body, a.body.product, { [a.body.product]: `https://${a.body.product}.openfrequency.co.il/` }), a.case);
  assert.deepEqual(sampleSetup('teder'), r.answers[0].body);
  assert.deepEqual(sampleSetup('toran'), r.answers[1].body);
});

test('workspaces-delete: a 200 is deleted, whatever its body; a 404 or anything else is a failure that stops everything', async () => {
  const r = contracts['workspaces-delete'].routes[0];
  for (const a of r.answers) {
    const p = await answering(() => ({ status: a.status, body: a.body }));
    try {
      const out = await eraseClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TEDER_INTERNAL: p.url }, log: () => {} }).erase(7, ['teder']);
      assert.equal(out.results.teder, a.status >= 200 && a.status < 300 ? 'deleted' : 'failed', a.case);
    } finally {
      await p.close();
    }
  }
});

test('entitlement-changed: accounts sends the request the contract has, to the path it names; a 2xx is told, anything else a line in the log', async () => {
  const r = contracts['entitlement-changed'].routes[0];
  assert.deepEqual([r.method, r.path], ['POST', CHANGED_PATH]);
  assert.ok(REASONS.includes(r.request.body.reason), 'the example reason is one accounts sends');
  for (const a of r.answers) {
    const seen = [];
    const p = await answering((req) => (seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'] }), { status: a.status, body: a.body }));
    const logs = [];
    try {
      const out = await changedClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TEDER_INTERNAL: p.url }, log: (m) => logs.push(m) }).tell(r.request.body.workspace, ['teder'], r.request.body.reason);
      const ok = a.status >= 200 && a.status < 300;
      assert.deepEqual(out, { teder: ok ? 'told' : 'failed' }, a.case);
      assert.equal(logs.length, ok ? 0 : 1, `${a.case}: ${ok ? 'nothing' : 'one line'} in the log`);
      assert.deepEqual(seen, [{ method: 'POST', url: CHANGED_PATH, auth: `Bearer ${TOKEN}`, type: 'application/json' }]);
    } finally {
      await p.close();
    }
  }
  // The body itself: what the contract's request shows, the workspace a number even when it came as a string.
  const bodies = [];
  const p = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.answers[0].body));
  });
  await new Promise((ok) => p.listen(0, '127.0.0.1', ok));
  try {
    await changedClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TORAN_INTERNAL: `http://127.0.0.1:${p.address().port}` }, log: () => {} }).tell(String(r.request.body.workspace), ['toran'], r.request.body.reason);
    assert.deepEqual(bodies, [r.request.body]);
  } finally {
    await new Promise((ok) => (p.closeAllConnections(), p.close(ok)));
  }
});

test('pay-remind: accounts sends the request the contract has, to the path it names; each of the four 200s is read as the case says, anything else is not taken', async () => {
  const r = contracts['pay-remind'].routes[0];
  assert.deepEqual([r.method, r.path], ['POST', REMIND_PATH]);
  const ex = r.request.body;
  assert.ok(REMIND_KINDS.includes(ex.kind) && PAY_CODE.test(ex.code), 'the example kind and code are ones accounts sends');
  for (const a of r.answers) {
    const seen = [];
    const p = createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(a.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(a.body));
    });
    await new Promise((ok) => p.listen(0, '127.0.0.1', ok));
    try {
      const out = await remindClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TORAN_INTERNAL: `http://127.0.0.1:${p.address().port}` } }).remind(ex);
      if (a.status === 200) assert.deepEqual(out, { taken: true, sent: a.body.sent, why: a.body.why }, a.case);
      else assert.deepEqual(out, { taken: false, why: `${a.status} ${a.body.error}` }, a.case);
      assert.deepEqual(seen, [{ method: 'POST', url: REMIND_PATH, auth: `Bearer ${TOKEN}`, type: 'application/json', body: ex }], a.case);
    } finally {
      await new Promise((ok) => (p.closeAllConnections(), p.close(ok)));
    }
  }
  // An answer not in the contract's shape is not taken either.
  const odd = await answering(() => ({ status: 200, body: { ok: true, sent: false, why: 'maybe' } }));
  try {
    assert.equal((await remindClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TORAN_INTERNAL: odd.url } }).remind(ex)).taken, false);
  } finally {
    await odd.close();
  }
});

test('toran-ops: the dashboard\'s answer is read, an action\'s line comes back, a refusal keeps Toran\'s words; the fake has the contract\'s shape', async () => {
  const [get, post] = contracts['toran-ops'].routes;
  const dash = get.answers.find((a) => a.status === 200);
  assert.deepEqual(shapeProblems(sampleOps(Date.parse('2026-10-24T10:00:00.000Z')), dash.body, dash.nullable), []);
  for (const a of [...get.answers, ...post.answers]) {
    const p = await answering(() => ({ status: a.status, body: a.body }));
    try {
      const client = toranClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TORAN_INTERNAL: p.url }, log: () => {} });
      if (get.answers.includes(a)) {
        const out = await client.ops();
        assert.equal(out.ok, a.status === 200, a.case);
      } else {
        const out = await client.act('toran', '12', 'sent', { by: 'Admin' });
        if (a.status === 200) assert.deepEqual(out, { ok: true, message: a.body.message });
        else if (a.status === 400) assert.deepEqual([out.ok, out.error], [false, a.body.error]);
        else assert.equal(out.ok, false, a.case);
      }
    } finally {
      await p.close();
    }
  }
});

test("admin-leads: the list and one lead are read in the contract's shape, a button's line comes back, a refusal keeps Toran's words", async () => {
  const [list, one, act] = contracts['admin-leads'].routes;
  const l = list.answers[0];
  assert.deepEqual(shapeProblems(readLeads(l.body), { teder: l.body.teder, counts: l.body.counts, leads: l.body.leads, tederOnly: l.body.tederOnly }, l.nullable), []);
  const o = one.answers[0];
  assert.deepEqual(shapeProblems(readLead(o.body), o.body.lead, o.nullable), []);
  for (const [route, a] of [...list.answers.map((a) => [list, a]), ...one.answers.map((a) => [one, a]), ...act.answers.map((a) => [act, a])]) {
    const p = await answering(() => ({ status: a.status, body: a.body }));
    try {
      const client = toranClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TORAN_INTERNAL: p.url }, log: () => {} });
      if (route === list) assert.equal((await client.leads()).ok, a.status === 200, a.case);
      else if (route === one) {
        const out = await client.lead('12');
        assert.equal(out.ok, a.status === 200, a.case);
        if (a.status === 404) assert.equal(out.why, 'none', a.case);
      } else {
        const out = await client.leadAct('12', 'notes', { by: 'Admin', notes: 'x' });
        if (a.status === 200) assert.deepEqual(out, { ok: true, message: a.body.message });
        else if (a.status === 400 || a.status === 404) assert.deepEqual([out.ok, out.error], [false, a.body.error], a.case);
        else assert.equal(out.ok, false, a.case);
      }
    } finally {
      await p.close();
    }
  }
});

test('admin-toran-operator: the statement accounts signs has the contract\'s fields and types, and verifies as the contract says', () => {
  const a = contracts['admin-toran-operator'].routes[0].answers[0];
  const value = operatorAssertion({ id: 1, email: 'admin@example.com', name: 'Admin' }, 'a-session-id', TOKEN, Date.parse('2026-10-24T10:00:00.000Z'));
  const [payload, sig] = value.split('.');
  assert.equal(sig, createHmac('sha256', TOKEN).update(payload).digest('base64url'));
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.deepEqual(shapeProblems(body, a.body), []);
  assert.equal(body.exp, Date.parse('2026-10-24T10:00:00.000Z') + 60_000);
  assert.match(body.ses, /^[A-Za-z0-9_-]{32}$/);
});

test('the shape check itself: keys, types, nulls where allowed, and the elements of a list', () => {
  assert.deepEqual(shapeProblems({ a: 1, b: null, c: [{ d: 'x' }] }, { a: 2, b: 'y', c: [{ d: 'z' }] }, ['b']), []);
  assert.equal(shapeProblems({ a: 1 }, { a: 1, b: 2 }).length, 1);
  assert.equal(shapeProblems({ a: '1' }, { a: 1 }).length, 1);
  assert.equal(shapeProblems({ a: null }, { a: 1 }).length, 1);
  assert.equal(shapeProblems({ c: [{ d: 1 }] }, { c: [{ d: 'z' }] }).length, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeUser, makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite, TOKEN } from './site.js';
import { startProduct } from './setup-fake.js';
import { setNow } from '../src/core/clock.js';
import { ensureSubscription } from '../src/accounts/subscriptions.js';
import { payCodeFor } from '../src/accounts/pay.js';
import { changedClient, CHANGED_PATH } from '../src/web/changed.js';

// When a payment is recorded, Teder and Toran hear at once (the owner's audit, 2026-11-02, accounts item 3: "When a
// payment is recorded, tell Teder and Toran right away (the existing internal endpoint with the bearer token), so they
// clear their entitlement cache. The customer should see access open on the next refresh, not after 5 minutes."):
// POST <product>/internal/entitlement/changed, after the payment is committed, to each product paid for that the
// workspace has, once per payment recorded and never for a duplicate refused, and never awaited: a product that is down
// or slow is a line in the log and costs the payment nothing. The other changes to access tell the product the same way;
// deleting a workspace does not (its products are asked to delete it first, and do).

const T0 = '2026-10-22T10:00:00.000Z';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a picture')]);

async function site({ changedMs = 1500, teder: tederOpts = {}, toran: toranOpts = {}, inject = true } = {}) {
  const h = tempHome();
  setNow(T0);
  const teder = await startProduct('teder', tederOpts);
  const toran = await startProduct('toran', toranOpts);
  const logs = [];
  const log = (m) => logs.push(String(m));
  const productEnv = { OF_INTERNAL_TOKEN: TOKEN, OF_TEDER_INTERNAL: teder.url, OF_TORAN_INTERNAL: toran.url };
  // The client the site uses, so a test can wait for what is still on its way (the site itself never does).
  const changed = inject ? changedClient({ env: productEnv, log, timeoutMs: changedMs }) : null;
  const s = await startSite(h.db, { env: { ...productEnv, OF_PAYMENT_METHOD: 'העברה בנקאית לחשבון 12-345-678901', OF_ASSISTANT_WA: '972500000200' }, log, ...(changed ? { changed } : {}) });
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder', 'toran'], members: { 'noa@example.com': 'client_owner' } });
  for (const p of ['teder', 'toran']) ensureSubscription(h.db, ws.id, p, '2026-10-22');
  const solo = makeWorkspace(h.db, 'ron-studio', { name: 'Ron Studio', products: ['teder'], members: { 'ron@example.com': 'client_owner' } });
  ensureSubscription(h.db, solo.id, 'teder', '2026-10-22');
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'Admin' });
  const op = signedIn(s, h.db, admin);
  return {
    ...h,
    ...s,
    teder,
    toran,
    ws,
    solo,
    op,
    logs,
    settled: () => changed?.settled(),
    done: async () => (await changed?.settled(), await s.close(), await teder.close(), await toran.close(), h.cleanup()),
  };
}

/** What a product was told, in order: [workspace, reason] for each POST to the changed route. */
const told = (fake) => fake.calls.filter((c) => c.method === 'POST' && c.path === CHANGED_PATH).map((c) => [c.body.workspace, c.body.reason]);
/** Every form on a page that posts, with its hidden fields as the browser would send them. */
const forms = (page) =>
  [...page.matchAll(/<form method="post" action="([^"]+)"[^>]*>([^]*?)<\/form>/g)].map((m) => ({
    action: m[1],
    fields: Object.fromEntries([...m[2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((x) => [x[1], x[2]])),
  }));
const payForm = (page, wsId, product) => {
  const f = forms(page).find((x) => x.action === `/admin/workspaces/${wsId}/subscription/pay` && x.fields.product === product);
  assert.ok(f, `no payment button for ${product} of workspace ${wsId}`);
  return f;
};
const paidUntil = (t, wsId, product = 'teder') => t.db.get('SELECT paid_until FROM subscriptions WHERE workspace_id = ? AND product = ?', wsId, product).paid_until;

test("the console's payment tells the product paid for, once, with the workspace and 'paid'; the same form again tells nobody; the other product is not told", async () => {
  const t = await site();
  try {
    const page = (await t.op.get('/admin/accounts')).body;
    const form = payForm(page, t.ws.id, 'teder');
    const first = await t.op.post(form.action, form.fields);
    assert.equal(first.status, 303);
    await t.settled();
    assert.deepEqual(told(t.teder), [[t.ws.id, 'paid']], 'Teder is told once, about this workspace');
    assert.deepEqual(told(t.toran), [], 'Toran was not paid for: not told');
    const call = t.teder.calls.find((c) => c.path === CHANGED_PATH);
    assert.equal(call.auth, `Bearer ${TOKEN}`, 'with the bearer token');

    // A double click, the browser sending it again: "התשלום כבר נרשם", nothing recorded, nobody told.
    const again = await t.op.post(form.action, form.fields);
    assert.equal(again.status, 303);
    await t.settled();
    assert.equal(paidUntil(t, t.ws.id), '2026-11-21', 'one month');
    assert.deepEqual(told(t.teder), [[t.ws.id, 'paid']], 'still once');

    // The next month, from the console drawn again: a second payment, a second notice.
    const next = payForm((await t.op.get('/admin/accounts')).body, t.ws.id, 'teder');
    await t.op.post(next.action, next.fields);
    await t.settled();
    assert.equal(paidUntil(t, t.ws.id), '2026-12-21');
    assert.deepEqual(told(t.teder), [[t.ws.id, 'paid'], [t.ws.id, 'paid']], 'one notice for each payment recorded');

    // Toran paid for in a workspace that does not have Toran: recorded, and Toran is not told about it.
    const page2 = (await t.op.get('/admin/accounts')).body;
    const toranHere = forms(page2).find((x) => x.action === `/admin/workspaces/${t.solo.id}/subscription/pay` && x.fields.product === 'toran');
    assert.equal(toranHere, undefined, 'the console offers no Toran payment where Toran is off');
    await t.op.post(`/admin/workspaces/${t.solo.id}/subscription/pay`, { product: 'toran', expect: '' });
    await t.settled();
    assert.deepEqual(told(t.toran), [], 'only the products the workspace has');
  } finally {
    await t.done();
  }
});

test("a transfer's \"התשלום הגיע\" tells each product it recorded a month for, once; the same form again tells nobody, and \"לא הגיע\" tells nobody", async () => {
  const t = await site();
  try {
    const send = async (workspaceId, data = PNG) => {
      const r = await t.owners('POST', '/internal/pay/receipt', { code: payCodeFor(t.db, workspaceId).code, phone: '972500000123', file: { name: 'shot.png', type: 'image/png', data: data.toString('base64') } });
      assert.equal(r.status, 201, r.body);
      return r.json.id;
    };
    const id = await send(t.ws.id);
    const page = (await t.op.get(`/admin/receipts/${id}`)).body;
    const form = forms(page).find((x) => x.action === `/admin/receipts/${id}/paid`);
    assert.ok(form, 'the receipt has "התשלום הגיע"');
    const res = await t.op.post(form.action, form.fields);
    assert.deepEqual([res.status, res.headers.location], [303, '/admin']);
    await t.settled();
    assert.deepEqual(told(t.teder), [[t.ws.id, 'paid']]);
    assert.deepEqual(told(t.toran), [[t.ws.id, 'paid']], 'both were owed, both recorded, both told');

    const again = await t.op.post(form.action, form.fields);
    assert.deepEqual([again.status, again.headers.location], [303, `/admin/receipts/${id}`], '"התשלום כבר נרשם", on the receipt');
    await t.settled();
    assert.deepEqual([told(t.teder).length, told(t.toran).length], [1, 1], 'nobody is told twice');

    // A receipt that is not a payment records nothing, and tells nobody.
    const other = await send(t.solo.id, Buffer.concat([PNG, Buffer.from('2')]));
    await t.op.get(`/admin/receipts/${other}`);
    assert.equal((await t.op.post(`/admin/receipts/${other}/not-paid`, {})).status, 303);
    await t.settled();
    assert.deepEqual([told(t.teder).length, told(t.toran).length], [1, 1]);
  } finally {
    await t.done();
  }
});

test('a product that is down or does not answer never fails the payment or holds it up: the payment is answered at once, and the product is a line in the log after the timeout', async () => {
  const t = await site({ changedMs: 800, teder: { changed: () => 'hang' } });
  try {
    // Toran is down: nothing listens where it is configured.
    const dead = createServer();
    await new Promise((r) => dead.listen(0, '127.0.0.1', r));
    const deadUrl = `http://127.0.0.1:${dead.address().port}`;
    await new Promise((r) => dead.close(r));
    const down = changedClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TORAN_INTERNAL: deadUrl }, log: (m) => t.logs.push(String(m)), timeoutMs: 800 });

    const page = (await t.op.get('/admin/accounts')).body;
    const form = payForm(page, t.ws.id, 'teder');
    const started = Date.now();
    const res = await t.op.post(form.action, form.fields);
    const took = Date.now() - started;
    assert.equal(res.status, 303);
    assert.ok(took < 800, `answered in ${took} ms, before Teder's 800 ms were up`);
    assert.equal(paidUntil(t, t.ws.id), '2026-11-21', 'recorded');
    assert.ok(res.setCookies.some((c) => /^(__Host-)?of_flash=/.test(c) && decodeURIComponent(c).includes('תדר שולם עד 21.11.2026')), 'and said so');
    assert.equal(t.mails.filter((m) => /^תדר פתוח\. אפשר להתחיל$/.test(m.subject)).length, 1, 'the owner was emailed');

    const out = await t.settled();
    assert.deepEqual(out, [{ teder: 'failed' }]);
    assert.ok(t.logs.some((l) => /teder POST \/internal\/entitlement\/changed \(workspace \d+, paid\): timed out/.test(l)), t.logs.join('\n'));

    assert.deepEqual(await down.tell(t.ws.id, ['toran'], 'paid'), { toran: 'failed' });
    assert.ok(t.logs.some((l) => /toran POST \/internal\/entitlement\/changed \(workspace \d+, paid\): ECONNREFUSED/.test(l)), t.logs.join('\n'));
    // A refusal is a line too, and so is a server with no token: never an exception.
    t.teder.state.changed = () => 503;
    assert.deepEqual(await changedClient({ env: { OF_INTERNAL_TOKEN: TOKEN, OF_TEDER_INTERNAL: t.teder.url }, log: (m) => t.logs.push(String(m)) }).tell(t.ws.id, ['teder'], 'comp'), { teder: 'failed' });
    assert.ok(t.logs.some((l) => /teder POST \/internal\/entitlement\/changed \(workspace \d+, comp\): 503/.test(l)));
    assert.deepEqual(await changedClient({ env: { OF_TEDER_INTERNAL: t.teder.url }, log: (m) => t.logs.push(String(m)) }).tell(t.ws.id, ['teder'], 'paid'), { teder: 'failed' });
    assert.ok(t.logs.some((l) => /OF_INTERNAL_TOKEN is not set, so it was not told/.test(l)));
    assert.ok(!t.logs.join('\n').includes(TOKEN), 'the token is never in the log');
  } finally {
    await t.done();
  }
});

test('the site tells the products at the addresses it reaches them on (OF_TEDER_INTERNAL, OF_TORAN_INTERNAL) without a client handed to it', async () => {
  const t = await site({ inject: false });
  try {
    const form = payForm((await t.op.get('/admin/accounts')).body, t.ws.id, 'toran');
    assert.equal((await t.op.post(form.action, form.fields)).status, 303);
    for (let i = 0; i < 100 && !told(t.toran).length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(told(t.toran), [[t.ws.id, 'paid']]);
    assert.deepEqual(told(t.teder), []);
  } finally {
    await t.done();
  }
});

test('every other change to access tells the product too (comp, a subscription saved by hand, cancelling and its undo, a product off and on, the workspace disabled and enabled); deleting the workspace tells nobody', async () => {
  const t = await site();
  try {
    await t.op.get('/admin/accounts');
    const step = async (label, path, fields) => {
      const before = [told(t.teder).length, told(t.toran).length];
      const r = await t.op.post(path, fields);
      assert.equal(r.status, 303, `${label}: ${r.body.slice(0, 300)}`);
      await t.settled();
      return [told(t.teder).slice(before[0]), told(t.toran).slice(before[1])];
    };
    const W = t.ws.id;
    assert.deepEqual(await step('comp on', `/admin/workspaces/${W}/comp`, { product: 'teder', comp: '1' }), [[[W, 'comp']], []]);
    assert.deepEqual(await step('comp off', `/admin/workspaces/${W}/comp`, { product: 'teder', comp: '0' }), [[[W, 'comp']], []]);
    const sub = { product: 'teder', plan: 'small', monthly: '490', setup: '990', vat: 'excluded', started_on: '2026-10-22', paid_until: '2026-11-30', ends_on: '' };
    assert.deepEqual(await step('the subscription saved', `/admin/workspaces/${W}/subscription`, sub), [[[W, 'subscription']], []]);
    assert.deepEqual(await step('Toran off', `/admin/workspaces/${W}/products`, { product: 'toran', enabled: '0' }), [[], [[W, 'product']]], 'it had Toran until now: told');
    assert.deepEqual(await step('Toran on', `/admin/workspaces/${W}/products`, { product: 'toran', enabled: '1' }), [[], [[W, 'product']]]);
    assert.deepEqual(await step('disabled', `/admin/workspaces/${W}/disable`, {}), [[[W, 'workspace']], [[W, 'workspace']]], 'every product it has');
    assert.deepEqual(await step('enabled', `/admin/workspaces/${W}/enable`, {}), [[[W, 'workspace']], [[W, 'workspace']]]);

    // The owner cancels Teder online, and takes it back.
    const owner = signedIn(t, t.db, t.db.get("SELECT * FROM users WHERE email = 'noa@example.com'"));
    assert.equal((await owner.get('/subscription/teder/cancel')).status, 200);
    let before = told(t.teder).length;
    assert.equal((await owner.post('/subscription/teder/cancel', {})).status, 303);
    await t.settled();
    assert.deepEqual(told(t.teder).slice(before), [[W, 'cancelled']]);
    await owner.get('/');
    before = told(t.teder).length;
    assert.equal((await owner.post('/subscription/teder/resume', {})).status, 303);
    await t.settled();
    assert.deepEqual(told(t.teder).slice(before), [[W, 'resumed']]);
    assert.deepEqual(told(t.toran).filter(([, r]) => r === 'cancelled' || r === 'resumed'), [], 'Toran was not cancelled');

    // Deleted: each product is asked to delete it (and deletes the answer it kept); nobody is told it "changed".
    t.teder.state.erase = () => 200;
    t.toran.state.erase = () => 200;
    const counts = [told(t.teder).length, told(t.toran).length];
    await t.op.get('/admin/accounts');
    assert.equal((await t.op.post(`/admin/workspaces/${t.solo.id}/delete`, { name: 'Ron Studio' })).status, 303);
    await t.settled();
    assert.equal(t.teder.calls.filter((c) => c.path === `/internal/workspaces/${t.solo.id}/delete`).length, 1, 'asked to delete');
    assert.deepEqual([told(t.teder).length, told(t.toran).length], counts);
  } finally {
    await t.done();
  }
});

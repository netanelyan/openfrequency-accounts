import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, tempHome } from './helpers.js';
import { signedIn, startSite, TOKEN } from './site.js';
import { now, setNow } from '../src/core/clock.js';
import { ensureSubscription, payMonth } from '../src/accounts/subscriptions.js';
import { addInvoice } from '../src/accounts/invoices.js';
import { savePrefs } from '../src/accounts/notify.js';
import { setSuperadmin } from '../src/accounts/superadmin.js';
import { newTotpSecret, stepAt, totpCode } from '../src/auth/totp.js';
import { startProduct } from './setup-fake.js';

// Deleting a workspace and its data: owners only, the business's name typed to confirm, Teder and Toran asked first
// (played by fakes: a 2xx is done or nothing there; anything else, a 404 included, stops everything), then ours
// deleted with the invoices kept and detached, everyone signed out of it, the owner told. The console can do it too.

const T0 = '2026-10-22T10:00:00.000Z';
const ADMIN = 'admin@example.com';
const PDF = Buffer.from('%PDF-1.7\n% invoice 1042\n%%EOF\n');

async function setup() {
  const h = tempHome();
  setNow(T0);
  const teder = await startProduct('teder', { erase: () => 200 });
  const toran = await startProduct('toran', { erase: () => 200 });
  const secret = newTotpSecret();
  setSuperadmin(h.db, { email: ADMIN, password: 'a long enough password', totpSecret: secret });
  const ws = makeWorkspace(h.db, 'noa-shop', { name: 'Noa Shop', products: ['teder', 'toran'], members: { 'noa@example.com': 'client_owner', 'ron@example.com': 'client_member' } });
  // Ron is in another workspace too: his account stays.
  const other = makeWorkspace(h.db, 'ron-studio', { name: 'Ron Studio', products: ['teder'], members: { 'ron@example.com': 'client_owner' } });
  for (const p of ['teder', 'toran']) ensureSubscription(h.db, ws.id, p);
  payMonth(h.db, ws.id, 'teder', { by: null });
  const admin_ = h.db.get('SELECT * FROM users WHERE email = ?', ADMIN);
  addInvoice(h.db, ws.id, { product: 'teder', number: '1042', issued_on: '2026-10-22', period_from: '2026-10-22', period_to: '2026-11-21', amount: '790', vat: '142.2' }, PDF, { by: admin_ });
  const noa = h.db.get("SELECT * FROM users WHERE email = 'noa@example.com'");
  const ron = h.db.get("SELECT * FROM users WHERE email = 'ron@example.com'");
  savePrefs(h.db, { userId: noa.id, workspaceId: ws.id, on: new Set(['teder:weekly']) });
  const site = await startSite(h.db, { env: { OF_TEDER_INTERNAL: teder.url, OF_TORAN_INTERNAL: toran.url, OF_SIGNUP_NOTIFY: 'boss@example.com' } });
  const admin = site.browser({ ip: '192.0.2.1' });
  await admin.get('/admin/login');
  await admin.post('/admin/login', { email: ADMIN, password: 'a long enough password', code: totpCode(secret, stepAt(now())) });
  await admin.get('/admin/accounts');
  return {
    ...h,
    ...site,
    ws,
    other,
    noa,
    ron,
    admin,
    teder,
    toran,
    done: async () => {
      await site.close();
      await teder.close();
      await toran.close();
      h.cleanup();
    },
  };
}

const deletes = (fake) => fake.calls.filter((c) => c.method === 'POST');

test('an owner deletes the workspace: the products first, then ours; invoices kept and detached; everyone out of it; the owner told', async () => {
  const t = await setup();
  try {
    const b = signedIn(t, t.db, t.noa);
    const ronB = signedIn(t, t.db, t.ron);
    // Ron is in two workspaces: he is in this one.
    t.db.run('UPDATE sessions SET workspace_id = ? WHERE user_id = ?', t.ws.id, t.ron.id);
    assert.match((await b.get('/')).body, /<a href="\/account\/delete">מחיקת החשבון<\/a>/);
    // A member: no link, and refused.
    assert.doesNotMatch((await ronB.get('/')).body, /account\/delete/);
    const no = await ronB.get('/account/delete');
    assert.equal(no.status, 403);
    assert.match(no.body, /רק בעלי החשבון יכולים למחוק אותו\./);

    // The page: permanent, what goes, what stays.
    const page = await b.get('/account/delete');
    assert.equal(page.status, 200);
    assert.match(page.body, /כאן מוחקים את החשבון של Noa Shop ואת הנתונים שלו\. אי אפשר לבטל את זה אחרי שזה קורה\./);
    assert.match(page.body, /מה נשאר[^]*החשבוניות\. החוק מחייב אותנו לשמור אותן/);
    assert.match(page.body, /כדי לאשר, כתבו את שם העסק: Noa Shop/);
    assert.match(page.body, /רוצים רק להפסיק לשלם ולשמור את הנתונים\?/);

    // The wrong name: nothing asked, nothing deleted.
    const wrong = await b.post('/account/delete', { name: 'Noa' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body, /השם לא תואם\./);
    assert.equal(deletes(t.teder).length + deletes(t.toran).length, 0);

    // Teder fails: nothing deleted here, and the page says so.
    t.teder.state.erase = () => 500;
    const failed = await b.post('/account/delete', { name: 'Noa Shop' });
    assert.equal(failed.status, 502);
    assert.match(failed.body, /לא הצלחנו לסיים את המחיקה, כי תדר לא ענה לנו\. החשבון עדיין קיים\./);
    assert.equal(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', t.ws.id).deleted_at, null);
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?', t.ws.id).n, 2);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'workspace_delete_failed'"));

    // A product without the route (404) is a failure too, never "nothing there" (ACC-06): Toran's data would stay.
    t.teder.state.erase = () => 200;
    t.toran.state.erase = () => 404;
    const missing = await b.post('/account/delete', { name: 'Noa Shop' });
    assert.equal(missing.status, 502);
    assert.match(missing.body, /לא הצלחנו לסיים את המחיקה, כי תורן לא ענה לנו\. החשבון עדיין קיים\./);
    assert.equal(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', t.ws.id).deleted_at, null);

    // Both delete. The name with other spaces and case.
    t.toran.state.erase = () => 200;
    const sid = b.cookie('__Secure-of_session');
    const r = await b.post('/account/delete', { name: '  noa   SHOP ' });
    assert.equal(r.status, 200);
    assert.match(r.body, /החשבון נמחק/);
    assert.match(r.body, /מחקנו את החשבון של Noa Shop ואת הנתונים שלו, ויצאתם מהחשבון\./);
    assert.ok(r.setCookies.some((c) => /^__Secure-of_session=;.*Max-Age=0/.test(c)), 'signed out');
    for (const fake of [t.teder, t.toran]) {
      const last = deletes(fake).at(-1);
      assert.deepEqual([last.path, last.auth], [`/internal/workspaces/${t.ws.id}/delete`, `Bearer ${TOKEN}`]);
    }

    // Ours: the workspace emptied (its id kept, never reused), its people, products, subscriptions and choices gone.
    const w = t.db.get('SELECT * FROM workspaces WHERE id = ?', t.ws.id);
    assert.deepEqual([w.name, w.slug, Boolean(w.deleted_at), Boolean(w.disabled_at)], ['', `deleted-${t.ws.id}-`, true, true]);
    for (const table of ['memberships', 'workspace_products', 'subscriptions', 'notify_prefs', 'tokens', 'user_phones', 'phone_links', 'signups'])
      assert.equal(t.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`, t.ws.id).n, 0, table);
    // Noa was only here: her account is gone. Ron is in another workspace: his stays, out of this one.
    assert.equal(t.db.get("SELECT 1 FROM users WHERE email = 'noa@example.com'"), null);
    assert.ok(t.db.get("SELECT 1 FROM users WHERE email = 'ron@example.com'"));
    assert.equal(t.db.get('SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ?', t.ws.id).n, 0);
    assert.equal((await t.internal(sid)).status, 401);
    // The invoice stays, with its PDF and the business it was for.
    const inv = t.db.get('SELECT * FROM invoices');
    assert.deepEqual([inv.workspace_id, inv.customer_name, Boolean(inv.detached_at), Buffer.from(inv.pdf).equals(PDF)], [t.ws.id, 'Noa Shop', true, true]);
    // Off for the products, out of the lists.
    assert.deepEqual((await t.owners('GET', `/internal/entitlement?workspace=${t.ws.id}&product=teder`)).json.access, 'off');
    assert.deepEqual((await t.owners('GET', '/internal/ops/customers')).json.workspaces.map((x) => x.slug), ['ron-studio']);
    assert.doesNotMatch((await t.admin.get('/admin/accounts')).body, /Noa Shop/);
    // The owner's notice.
    const notice = t.mails.find((m) => m.to === 'boss@example.com');
    assert.equal(notice.subject, 'חשבון נמחק: Noa Shop');
    assert.match(notice.text, /הלקוח מחק את החשבון של Noa Shop מהדף שלו\.[^]*מי מחק: noa@example\.com[^]*תדר: הנתונים נמחקו[^]*תורן: הנתונים נמחקו[^]*חשבוניות שנשמרו: 1/);
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'workspace_deleted' AND workspace_id = ?", t.ws.id));
    // The next workspace gets a new id.
    assert.ok(makeWorkspace(t.db, 'next-shop').id > t.ws.id);
  } finally {
    await t.done();
  }
});

test('the console deletes a workspace the same way: the name to confirm, only the products it ever had asked', async () => {
  const t = await setup();
  try {
    const wrong = await t.admin.post(`/admin/workspaces/${t.other.id}/delete`, { name: 'Ron' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body, /השם לא תואם את שם העסק, אז לא מחקנו כלום\./);
    const r = await t.admin.post(`/admin/workspaces/${t.other.id}/delete`, { name: 'Ron Studio' });
    assert.equal(r.status, 303);
    assert.match((await t.admin.get('/admin/accounts')).body, /Ron Studio נמחק, עם הנתונים שלו בתדר ובתורן\. החשבוניות נשמרו\./);
    // Ron Studio only ever had Teder.
    assert.deepEqual(deletes(t.teder).map((c) => c.path), [`/internal/workspaces/${t.other.id}/delete`]);
    assert.equal(deletes(t.toran).length, 0);
    assert.ok(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', t.other.id).deleted_at);
    // Ron is still in Noa Shop, so his account stays.
    assert.ok(t.db.get("SELECT 1 FROM users WHERE email = 'ron@example.com'"));
    assert.match(t.mails.find((m) => m.to === 'boss@example.com').text, /החשבון של Ron Studio נמחק מהקונסולה\./);
    // A customer cannot reach the console's route.
    const b = signedIn(t, t.db, t.noa);
    await b.get('/');
    assert.equal((await b.post(`/admin/workspaces/${t.ws.id}/delete`, { name: 'Noa Shop' })).status, 403);
    assert.equal(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', t.ws.id).deleted_at, null);
  } finally {
    await t.done();
  }
});

test('deleting: never from view-as, never signed out, and a product that does not answer stops it', async () => {
  const t = await setup();
  try {
    assert.equal((await t.admin.get('/account/delete')).status, 403);
    assert.equal((await t.browser().get('/account/delete')).headers.location, '/login');
    await t.toran.close();
    const b = signedIn(t, t.db, t.noa);
    await b.get('/account/delete');
    const r = await b.post('/account/delete', { name: 'Noa Shop' });
    assert.equal(r.status, 502);
    assert.match(r.body, /כי תורן לא ענה לנו/);
    assert.equal(t.db.get('SELECT deleted_at FROM workspaces WHERE id = ?', t.ws.id).deleted_at, null);
  } finally {
    await t.done();
  }
});

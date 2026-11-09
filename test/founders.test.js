import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';
import { pathOf, startSite, tokenOf } from './site.js';
import { setNow } from '../src/core/clock.js';
import { foundersEarlier, foundersSpots, foundersState } from '../src/accounts/founders.js';
import { eraseWorkspace } from '../src/accounts/erase.js';

// The founders' offer (src/accounts/founders.js; the owner, 2026-11-09: "no דמי הקמה for the next 10 people"): the
// next OF_FOUNDERS_SPOTS sign-ups pay no setup fee for what they chose, the spots are counted and never made up, and the
// website reads the real count from /public/founders.json.

const FORM = { name: 'Noa Levi', business: 'Noa Ceramics', email: 'noa@example.com', products: ['teder', 'toran'], terms: '1', website: '', via: 'email' };

async function setup(env = {}) {
  const h = tempHome();
  setNow('2026-11-09T10:00:00.000Z');
  const site = await startSite(h.db, { env: { OF_SIGNUP: '1', OF_SIGNUP_PRODUCTS: 'teder,toran', ...env } });
  return { ...h, ...site, done: async () => (await site.close(), h.cleanup()) };
}

/** One sign-up by email, to the workspace it opens. */
async function signUp(t, n) {
  const b = t.browser({ ip: `198.51.100.${n}` });
  await b.get('/signup');
  const r = await b.post('/signup', { ...FORM, email: `owner${n}@example.com`, business: `Store ${n}` });
  assert.equal(r.status, 200, `sign-up ${n} accepted: ${(r.body.match(/class="error"[^>]*>([^<]*)/) || [])[1] || ''}`);
  const mail = t.mails.at(-1);
  assert.equal(mail.to, `owner${n}@example.com`);
  await b.get(pathOf(mail.link));
  assert.equal((await b.post('/signup/confirm', { t: tokenOf(mail.link) })).status, 303);
  return { b, w: t.db.get('SELECT * FROM workspaces WHERE name = ?', `Store ${n}`) };
}

const setups = (db, w) => db.all('SELECT product, setup FROM subscriptions WHERE workspace_id = ? ORDER BY product', w.id).map((r) => [r.product, r.setup]);

test('the spots: 10 when unset, a whole number when set, 0 (off) for anything else', () => {
  assert.equal(foundersSpots({}), 10);
  assert.equal(foundersSpots({ OF_FOUNDERS_SPOTS: '3' }), 3);
  for (const v of ['0', '-1', '2.5', 'ten', '5000']) assert.equal(foundersSpots({ OF_FOUNDERS_SPOTS: v }), 0, v);
});

test('businesses already using OpenFrequency hold a spot each, by name, beside the sign-ups that took one', () => {
  const db = { get: () => ({ n: 1 }) }; // one sign-up took a spot
  assert.deepEqual(foundersEarlier({ OF_FOUNDERS_EARLIER: ' brickdealil, tiyulplus ,' }), ['brickdealil', 'tiyulplus']);
  assert.deepEqual(foundersState(db, { OF_FOUNDERS_EARLIER: 'brickdealil,tiyulplus' }), { spots: 10, taken: 3, left: 7 });
  assert.deepEqual(foundersState(db, {}), { spots: 10, taken: 1, left: 9 }, 'none named: only the sign-ups');
  assert.deepEqual(foundersState(db, { OF_FOUNDERS_SPOTS: '2', OF_FOUNDERS_EARLIER: 'a,b' }), { spots: 2, taken: 3, left: 0 }, 'never below 0');
});

test('the next sign-ups take a spot each and pay no setup fee for both products; once the spots are gone, the list price; the count is real', async () => {
  const t = await setup({ OF_FOUNDERS_SPOTS: '2' });
  try {
    const page = await t.browser().get('/signup');
    assert.match(page.body, /<p class="founders-note">מבצע מייסדים: 2 העסקים הראשונים שנרשמים לא משלמים דמי הקמה\. נשארו 2 מתוך 2 מקומות/);

    const one = await signUp(t, 1);
    assert.deepEqual(setups(t.db, one.w), [['teder', 0], ['toran', 0]], 'one spot, no setup fee for either product');
    const setupPage = await one.b.get('/setup');
    assert.match(setupPage.body, /במבצע המייסדים, אז אין דמי הקמה/);
    assert.doesNotMatch(setupPage.body, /דמי הקמה של 1,490|דמי הקמה של 990/);
    assert.deepEqual(foundersState(t.db, { OF_FOUNDERS_SPOTS: '2' }), { spots: 2, taken: 1, left: 1 });
    assert.ok(t.db.get("SELECT 1 FROM audit WHERE action = 'founders_spot' AND workspace_id = ?", one.w.id));

    await signUp(t, 2);
    const three = await signUp(t, 3);
    assert.deepEqual(setups(t.db, three.w), [['teder', 1490], ['toran', 990]], 'the spots are gone: the list price');
    assert.doesNotMatch((await three.b.get('/setup')).body, /מבצע המייסדים/);
    assert.doesNotMatch((await t.browser().get('/signup')).body, /founders-note/, 'no offer on the page once it is full');

    // The count, as the website reads it: the real one, for openfrequency.co.il's pages only to read across sites.
    const r = await t.browser().get('/public/founders.json', { origin: 'https://openfrequency.co.il' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { spots: 2, left: 0 });
    assert.equal(r.headers['access-control-allow-origin'], 'https://openfrequency.co.il');
    assert.match(r.headers['cache-control'], /max-age=60/);
    assert.equal((await t.browser().get('/public/founders.json', { origin: 'https://evil.example' })).headers['access-control-allow-origin'], undefined);

    // A workspace erased later keeps its spot taken.
    eraseWorkspace(t.db, one.w.id, { by: null });
    assert.deepEqual(foundersState(t.db, { OF_FOUNDERS_SPOTS: '2' }), { spots: 2, taken: 2, left: 0 });
  } finally {
    await t.done();
  }
});

test('off (OF_FOUNDERS_SPOTS=0): no spot, no note, and the count says none', async () => {
  const t = await setup({ OF_FOUNDERS_SPOTS: '0' });
  try {
    assert.doesNotMatch((await t.browser().get('/signup')).body, /founders-note/);
    const one = await signUp(t, 1);
    assert.deepEqual(setups(t.db, one.w), [['teder', 1490], ['toran', 990]]);
    assert.deepEqual(JSON.parse((await t.browser().get('/public/founders.json')).body), { spots: 0, left: 0 });
  } finally {
    await t.done();
  }
});

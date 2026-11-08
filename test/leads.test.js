import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';
import { LEADS_CONTRACT, sampleOps, startToran } from './toran-fake.js';
import { setNow } from '../src/core/clock.js';

// The shared lead dashboard on /admin/leads (the owner, 2026-11-08: "make the shared lead dashboard be in the admin
// dashboard, not in one of the products"), against a pretend Toran answering as docs/contracts/admin-leads.json says:
// the list with both products, one lead's page with its one main way to send, each button forwarded to Toran with the
// right path and body and back to the lead's page with Toran's line, and who may reach it.

const LIST = LEADS_CONTRACT.routes[0].answers[0].body;
const LEAD = LEADS_CONTRACT.routes[1].answers[0].body.lead;

async function setup() {
  const h = tempHome();
  setNow('2026-11-08T10:00:00.000Z');
  const fake = await startToran({ data: sampleOps() });
  const site = await startSite(h.db, { env: { OF_TORAN_INTERNAL: fake.url } });
  const admin = makeUser(h.db, 'admin@example.com', { superadmin: true, name: 'נתנאל' });
  const op = signedIn(site, h.db, admin);
  return { ...h, ...site, fake, op, done: async () => (await site.close(), await fake.close(), h.cleanup()) };
}

test('the list: both products for each store, the tabs by where it stands, the search, and Teder-only leads apart', async () => {
  const t = await setup();
  try {
    const r = await t.op.get('/admin/leads');
    assert.equal(r.status, 200);
    const b = r.body;
    assert.match(b, /<a href="\/admin\/leads" aria-current="page">לידים<\/a>/, 'the tab in the header');
    assert.ok(b.includes(`<a class="who" href="/admin/leads/${LIST.leads[0].id}"><b>${LIST.leads[0].name}</b></a>`), 'the row opens its lead');
    assert.match(b, /<span class="tag p-toran">תורן: מוכן<\/span><span class="tag p-teder">תדר: מוכן<\/span>/);
    assert.match(b, /ליד אחד שיש רק בתדר/);
    assert.ok(b.includes(LIST.tederOnly[0].leadUrl.replace(/&/g, '&amp;')), "a Teder-only lead opens in Teder");
    await t.op.get('/admin/leads?where=ready&q=nurit');
    assert.equal(t.fake.calls.at(-1).path, '/internal/leads?where=ready&q=nurit');
    await t.op.get('/admin/leads?where=nonsense');
    assert.equal(t.fake.calls.at(-1).path, '/internal/leads', 'an unknown tab is all');
    // Toran down: the page says so.
    t.fake.state.down = true;
    assert.match((await t.op.get('/admin/leads')).body, /תורן לא ענה כרגע/);
  } finally {
    await t.done();
  }
});

test("one lead's page: one main way to send, the two demos, where it stands; a lead Toran does not have is 404", async () => {
  const t = await setup();
  try {
    const r = await t.op.get(`/admin/leads/${LEAD.id}`);
    assert.equal(r.status, 200);
    const b = r.body;
    assert.ok(b.includes(`<h2>${LEAD.name}</h2>`));
    assert.match(b, /<form method="post" action="\/admin\/leads\/12\/send-toran" class="inline">.*<button class="primary">לשלוח את תורן<\/button><\/form>/s, 'the main send, the one option the example has');
    assert.ok(b.includes(LEAD.send.toranText), 'the message it sends');
    assert.match(b, /action="\/admin\/leads\/12\/build-teder"/, 'Teder can be built');
    assert.match(b, /action="\/admin\/leads\/12\/replied"/);
    assert.match(b, /action="\/admin\/leads\/12\/notes"/);
    assert.equal(t.fake.calls.at(-1).path, '/internal/leads/12');
    const none = await t.op.get('/admin/leads/999');
    assert.equal(none.status, 404);
    assert.match(none.body, /אין ליד כזה/);
  } finally {
    await t.done();
  }
});

test("each button goes to Toran with the operator's name and comes back to the lead with Toran's line; a refusal keeps Toran's words", async () => {
  const t = await setup();
  try {
    const cases = [
      ['send-both', {}, '/internal/leads/12/send-both', { by: 'נתנאל' }],
      ['build-teder', {}, '/internal/leads/12/build-teder', { by: 'נתנאל' }],
      ['notes', { notes: 'לחזור בחמישי' }, '/internal/leads/12/notes', { by: 'נתנאל', notes: 'לחזור בחמישי' }],
      ['skip', { reason: 'לא מתאים' }, '/internal/leads/12/skip', { by: 'נתנאל', reason: 'לא מתאים' }],
      ['replied', {}, '/internal/ops/toran/12/replied', { by: 'נתנאל' }],
      ['later', { days: '7' }, '/internal/ops/toran/12/later', { by: 'נתנאל', days: 7 }],
      ['lost', { reason: 'price' }, '/internal/ops/toran/12/lost', { by: 'נתנאל', reason: 'price' }],
    ];
    await t.op.get('/admin/leads/12'); // the page's form token, as a person has it
    for (const [action, fields, toPath, body] of cases) {
      const r = await t.op.post(`/admin/leads/12/${action}`, fields);
      assert.equal(r.status, 303, action);
      assert.equal(r.headers.location, '/admin/leads/12');
      const sent = t.fake.posts().at(-1);
      assert.deepEqual([sent.path, sent.body, sent.auth], [toPath, body, 'Bearer internal-token-for-tests-only-0123456789'], action);
    }
    assert.match((await t.op.get('/admin/leads/12')).body, /<p class="flash" role="status">/);
    // Toran refuses: its own words, nothing else.
    t.fake.state.answers['lead:send-toran'] = { status: 400, body: { ok: false, error: 'עכשיו לילה, שבת או חג, אז לא שולחים ללידים.' } };
    await t.op.post('/admin/leads/12/send-toran', {});
    assert.match((await t.op.get('/admin/leads/12')).body, /<p class="flash bad" role="alert">עכשיו לילה, שבת או חג, אז לא שולחים ללידים\.<\/p>/);
    // An action that is not one never reaches Toran.
    const before = t.fake.posts().length;
    await t.op.post('/admin/leads/12/fly', {});
    assert.equal(t.fake.posts().length, before);
  } finally {
    await t.done();
  }
});

test('only the superadmin: anyone else is sent to the admin sign-in, and nothing reaches Toran', async () => {
  const t = await setup();
  try {
    const anon = t.browser();
    assert.equal((await anon.get('/admin/leads')).headers.location, '/admin/login');
    assert.equal((await anon.get('/admin/leads/12')).headers.location, '/admin/login');
    assert.equal(t.fake.calls.length, 0);
  } finally {
    await t.done();
  }
});

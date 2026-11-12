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
    // The store Teder alone has was written to: it is on the list of the ones we wrote to, and added to Toran's from there.
    assert.doesNotMatch(b, /חנות אחת שיש רק בתדר/);
    const reached = (await t.op.get('/admin/leads/reached')).body;
    assert.match(reached, /חנות אחת שיש רק בתדר/);
    assert.match(reached, /<form method="post" action="\/admin\/leads\/add" class="inline">.*<input type="hidden" name="url" value="https:\/\/kelim\.example\/"><button class="quiet">להוסיף לרשימה<\/button>/s, "a store Teder alone has is added to the list here");
    // A store in a few words: its own line, then what Toran found of it.
    const first = new RegExp(`<li id="lead-${LIST.leads[0].id}">(.*?)</li>`, 's').exec(b)[1];
    assert.ok(first.includes(`<p class="about" dir="auto">${LIST.leads[0].about}</p>`), 'its own line');
    for (const fact of ['<bdi class="ltr">Shopify</bdi>', '14 מוצרים', '45 ₪ עד 500 ₪', 'ספלים, קערות', 'href="https://www.instagram.com/nurit.ceramics/" target="_blank" rel="noopener">אינסטגרם</a>', 'וואטסאפ באתר']) assert.ok(first.includes(fact), fact);
    // Creating leads: a store by its address, more found, and what is still being read.
    assert.match(b, /<form class="row lead-add" method="post" action="\/admin\/leads\/add">.*name="url".*להוסיף חנות/s);
    assert.match(b, /<details class="find"><summary>למצוא עוד חנויות<\/summary><form class="row" method="post" action="\/admin\/leads\/discover">.*<option value="storecensus">ספריית חנויות Shopify בישראל<\/option>.*<\/select>/s);
    assert.match(b, /בחיפוש האחרון, .*נבדקו 40 אתרים ו־4 חנויות מתאימות נוספו לרשימה\./);
    assert.match(b, /<ul class="adding"><li><bdi class="ltr">new-store\.example<\/bdi> <span class="tag wait">קוראים את האתר<\/span><\/li><\/ul>/);
    // Nothing here opens the products' own operator pages (the owner, 2026-11-12: "MUST not send me to old fronts").
    assert.doesNotMatch(b, /\/admin\/(toran|teder)\/(lead|leads|demos|review)|leads\?tab=/);
    // Toran is asked with the search and every tab: the tab, and which list, are cut here.
    await t.op.get('/admin/leads?where=ready&q=nurit');
    assert.equal(t.fake.calls.at(-1).path, '/internal/leads?q=nurit');
    await t.op.get('/admin/leads?all=1');
    assert.equal(t.fake.calls.at(-1).path, '/internal/leads?all=1', 'the stores that did not pass the score too');
    await t.op.get('/admin/leads/reached?all=1');
    assert.equal(t.fake.calls.at(-1).path, '/internal/leads', 'every one we wrote to is on the list anyway');
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
    assert.match(b, /action="\/admin\/leads\/12\/go-both".*action="\/admin\/leads\/12\/go-toran".*action="\/admin\/leads\/12\/go-teder"/s, 'Toran, Teder or both, whatever is built');
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
      ['go-both', {}, '/internal/leads/12/go-both', { by: 'נתנאל' }],
      ['notes', { notes: 'לחזור בחמישי' }, '/internal/leads/12/notes', { by: 'נתנאל', notes: 'לחזור בחמישי' }],
      ['skip', { reason: 'לא מתאים' }, '/internal/leads/12/skip', { by: 'נתנאל', reason: 'לא מתאים' }],
      ['go-none', {}, '/internal/leads/12/go-none', { by: 'נתנאל', reason: '' }],
      ['replied', {}, '/internal/leads/12/replied', { by: 'נתנאל' }],
      ['later', { days: '7' }, '/internal/leads/12/later', { by: 'נתנאל', days: 7 }],
      ['lost', { reason: 'price' }, '/internal/leads/12/lost', { by: 'נתנאל', reason: 'price' }],
      ['reopen', {}, '/internal/leads/12/reopen', { by: 'נתנאל' }],
      ['approve-toran', {}, '/internal/leads/12/approve-toran', { by: 'נתנאל' }],
      ['hold-toran', {}, '/internal/leads/12/hold-toran', { by: 'נתנאל' }],
      ['brand', { name: ' כלי חרס ', color: '#0a7d4f' }, '/internal/leads/12/brand', { by: 'נתנאל', name: 'כלי חרס', color: '#0a7d4f' }],
      ['sample', {}, '/internal/leads/12/sample', { by: 'נתנאל' }],
      ['teder-other', {}, '/internal/leads/12/teder-other', { by: 'נתנאל' }],
      ['teder-remove', {}, '/internal/leads/12/teder-remove', { by: 'נתנאל' }],
      ['takedown', {}, '/internal/leads/12/takedown', { by: 'נתנאל' }],
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
    // An action that is not one never reaches Toran, nor "not interested" without a reason.
    const before = t.fake.posts().length;
    await t.op.post('/admin/leads/12/fly', {});
    await t.op.post('/admin/leads/12/lost', { reason: 'whatever' });
    assert.equal(t.fake.posts().length, before);
    // Deleted: the lead's page is no more, so the list comes back, with Toran's line.
    t.fake.state.answers['lead:delete'] = { status: 200, body: { ok: true, message: 'החנות נמחקה מתורן.', gone: true } };
    assert.equal((await t.op.post('/admin/leads/12/delete', {})).headers.location, '/admin/leads');
    assert.match((await t.op.get('/admin/leads')).body, /<p class="flash" role="status">החנות נמחקה מתורן\.<\/p>/);
    // The list's own buttons: a store added by its address, more stores found, each with the operator's name.
    assert.equal((await t.op.post('/admin/leads/add', { url: ' store.co.il ' })).headers.location, '/admin/leads');
    assert.deepEqual([t.fake.posts().at(-1).path, t.fake.posts().at(-1).body], ['/internal/leads/add', { url: 'store.co.il', by: 'נתנאל' }]);
    t.fake.state.answers['lead:add'] = { status: 200, body: { ok: true, message: 'החנות כבר ברשימה.', id: 12 } };
    assert.equal((await t.op.post('/admin/leads/add', { url: 'nurit-ceramics.co.il' })).headers.location, '/admin/leads/12', 'one already here opens its lead');
    t.fake.state.answers['lead:add'] = { status: 400, body: { ok: false, error: 'זו לא כתובת של אתר.' } };
    await t.op.post('/admin/leads/add', { url: 'x' });
    assert.match((await t.op.get('/admin/leads')).body, /<p class="flash bad" role="alert">זו לא כתובת של אתר\.<\/p>/);
    await t.op.post('/admin/leads/discover', { source: 'nonsense' });
    assert.deepEqual([t.fake.posts().at(-1).path, t.fake.posts().at(-1).body], ['/internal/leads/discover', { source: 'storecensus', by: 'נתנאל' }], 'an unknown source is the default one');
  } finally {
    await t.done();
  }
});

// The owner, 2026-11-11: "make the leads dashboard functional on mobile. also, if something misses it should be red,
// not purple or green. each leads should have a button for generating a demo for teder/toran/both. the message that is
// suggested being sent to the phone number on whatsapp should be according to that."

const none = { state: 'none', pageUrl: null, sentAt: null, reminderSentAt: null, reminderDue: false, error: null, idea: null };
/** What Toran says each choice of what the lead goes on with would make now (build.go): [] makes nothing, null cannot. */
const go = (both, toran, teder) => Object.fromEntries(Object.entries({ both, toran, teder }).map(([k, v]) => [k, { can: v !== null, makes: v || [] }]));
const row = (over) => ({ ...LIST.leads[0], ...over });
/** One lead as Toran answers it. */
const answer = (lead) => ({ ok: true, lead });

test('the list: a missing demo is red, one that is there has its colour; each row has one button for what it goes on with, Toran, Teder or both whatever is built, and it comes back to the list, or to the lead when its message can go', async () => {
  const t = await setup();
  try {
    t.fake.state.leads = {
      ...LIST,
      leads: [
        row({ id: 21, name: 'אין לה כלום', toran: none, teder: none, build: { toran: true, teder: true, both: true, toranWhyNot: null, go: go(['toran', 'teder'], ['toran'], ['teder']) }, chosen: null }),
        row({ id: 22, name: 'תדר נכשל', toran: { ...LIST.leads[0].toran }, teder: { ...none, state: 'failed', error: 'לא נקרא' }, build: { toran: true, teder: true, both: false, toranWhyNot: null, go: go(['teder'], [], ['teder']) }, chosen: null }),
        row({ id: 23, name: 'הכול מוכן' }),
        row({ id: 24, name: 'ויקס', facts: { ...LIST.leads[0].facts, social: { instagram: null, tiktok: null, facebook: null }, socialRead: false }, toran: none, teder: { ...none, state: 'building' }, build: { toran: false, teder: false, both: false, toranWhyNot: 'תורן קורא כרגע רק חנויות Shopify.', go: go(null, null, []) }, chosen: null }),
        row({ id: 25, name: 'הוסר', facts: { ...LIST.leads[0].facts, social: { instagram: null, tiktok: null, facebook: null }, socialRead: true }, toran: { ...none, state: 'removed' }, teder: none, build: { toran: false, teder: false, both: false, toranWhyNot: null, go: go(null, null, null) }, chosen: null }),
      ],
    };
    const b = (await t.op.get('/admin/leads')).body;
    const li = (id) => new RegExp(`<li id="lead-${id}">(.*?)</li>`, 's').exec(b)?.[1] || '';
    // Neither demo yet: one red tag; one missing: red beside the other's colour; both there: their colours.
    assert.match(li(21), /<span class="tag miss">אין דמו<\/span>/);
    assert.match(li(22), /<span class="tag p-toran">תורן: מוכן<\/span><span class="tag miss">תדר: נכשל<\/span>/);
    assert.match(li(23), /<span class="tag p-toran">תורן: מוכן<\/span><span class="tag p-teder">תדר: מוכן<\/span>/);
    assert.match(li(24), /<span class="tag miss">תורן: אין<\/span><span class="tag wait">תדר: נבנה<\/span>/, 'being built is grey');
    assert.doesNotMatch(b, /class="tag p-(toran|teder)">[^<]*: (אין|נכשל|הוסר)</, 'no product colour on anything missing');
    // No profiles is said only of a site read for them (one found before Toran read them may have some).
    assert.doesNotMatch(li(24), /אינסטגרם/);
    assert.match(li(25), /בלי אינסטגרם וטיקטוק באתר/);
    // One button a row, opening Toran, Teder and both, both first, whatever is built (the owner, 2026-11-12: "i dont see
    // a button for going on with teder/toran/both for each lead"); once chosen, the button says which.
    const choices = (id) => [...li(id).matchAll(/action="\/admin\/leads\/\d+\/(go-(?:both|toran|teder))"/g)].map((m) => m[1]);
    assert.match(li(21), /<details class="make"><summary>להמשיך עם…<\/summary><div class="make-pick">.*action="\/admin\/leads\/21\/go-both".*<button class="primary">תורן ותדר<\/button>.*action="\/admin\/leads\/21\/go-toran".*>תורן<\/button>.*action="\/admin\/leads\/21\/go-teder".*>תדר<\/button>/s);
    assert.deepEqual(choices(22), ['go-both', 'go-toran', 'go-teder'], "Toran's page is up: both can still be chosen");
    assert.match(li(23), /<details class="make"><summary>ממשיכים עם תורן ותדר<\/summary>/, 'everything built: still a choice, and it says the one made');
    assert.deepEqual(choices(23), ['go-both', 'go-toran', 'go-teder']);
    assert.deepEqual(choices(24), ['go-teder'], 'a site Toran cannot read: Teder alone');
    assert.ok(!li(25).includes('<details class="make">'), 'nothing can be chosen, no button');
    // Neither, under the three, in red (the owner, 2026-11-12: "toran/teder/both/neither").
    assert.match(li(21), /action="\/admin\/leads\/21\/go-teder".*action="\/admin\/leads\/21\/go-none".*<button class="danger">לא להמשיך איתם<\/button>/s);
    assert.doesNotMatch(b, /build-(both|toran|teder)/, 'the list makes nothing but by a choice');
    assert.match(li(21), /<input type="hidden" name="back" value="list">/);

    // Made from a tab and a search: Toran builds it, and the list comes back as it was, at the row.
    await t.op.get('/admin/leads?where=new&q=x');
    const r = await t.op.post('/admin/leads/21/go-both', { back: 'list', where: 'new', q: 'x' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/admin/leads?where=new&q=x#lead-21');
    assert.deepEqual([t.fake.posts().at(-1).path, t.fake.posts().at(-1).body], ['/internal/leads/21/go-both', { by: 'נתנאל' }]);
    assert.match((await t.op.get('/admin/leads?where=new&q=x')).body, /<p class="flash" role="status">/);
    // A choice that makes nothing, its message ready: the lead opens at its message, with Toran's line.
    t.fake.state.answers['lead:go-toran'] = { status: 200, body: { ok: true, message: 'ממשיכים עם תורן. ההודעה מוכנה לשליחה.', ready: true } };
    const ready = await t.op.post('/admin/leads/23/go-toran', { back: 'list', where: 'new' });
    assert.equal(ready.headers.location, '/admin/leads/23#send');
    t.fake.state.lead = { ok: true, lead: { ...LEAD, id: 23 } };
    assert.match((await t.op.get('/admin/leads/23')).body, /<p class="flash" role="status">ממשיכים עם תורן\. ההודעה מוכנה לשליחה\.<\/p>/);
    // Refused: the list comes back at its top, where Toran's line is.
    t.fake.state.answers['lead:go-teder'] = { status: 400, body: { ok: false, error: 'תדר לא ענה כרגע.' } };
    const refused = await t.op.post('/admin/leads/22/go-teder', { back: 'list' });
    assert.equal(refused.headers.location, '/admin/leads');
    assert.match((await t.op.get('/admin/leads')).body, /<p class="flash bad" role="alert">תדר לא ענה כרגע\.<\/p>/);
    // Under a tab, the tag of where it stands is the tab's: not repeated on each row.
    assert.doesNotMatch((await t.op.get('/admin/leads?where=ready')).body, /class="tag where"/);
    assert.match((await t.op.get('/admin/leads')).body, /<span class="tag where">מוכנים לשליחה<\/span>/);
    // Anything else than a build goes back to the lead, even with back=list.
    assert.equal((await t.op.post('/admin/leads/21/notes', { notes: 'x', back: 'list' })).headers.location, '/admin/leads/21');
  } finally {
    await t.done();
  }
});

test("a lead's message is the one for the demo chosen: from our number each one's own text and button; copied by hand, each with its link and its own \"שלחתי\"", async () => {
  const t = await setup();
  try {
    const ready = { ...LEAD.toran };
    const tederReady = { ...LEAD.toran, pageUrl: 'https://teder.openfrequency.co.il/s/nurit-ceramics-a1b2c3', idea: 'הסיפור של הקרמיקה' };
    const texts = { bothText: 'שניהם בהודעה אחת', toranText: 'רק תורן', tederText: 'רק תדר, ובה הלינק' };
    // From our number, Teder chosen: its message leads; the others are a press away, each with its own button.
    t.fake.state.lead = answer({ ...LEAD, teder: tederReady, chosen: 'teder', send: { ...LEAD.send, options: ['teder', 'both', 'toran'], main: 'teder', ...texts } });
    let b = (await t.op.get('/admin/leads/12')).body;
    assert.match(b, /<fieldset class="seg"><legend>איזו הודעה לשלוח<\/legend><label><input type="radio" name="pick" value="teder" checked><span>תדר<\/span><\/label><label><input type="radio" name="pick" value="both"><span>תורן ותדר<\/span><\/label>/);
    assert.match(b, /<div class="pick on" data-pick="teder"><blockquote class="msg">רק תדר, ובה הלינק<\/blockquote>.*לראות את המצגת.*action="\/admin\/leads\/12\/send-teder".*<button class="primary">לשלוח את תדר<\/button>/s);
    assert.match(b, /<div class="pick" data-pick="both"><blockquote class="msg">שניהם בהודעה אחת<\/blockquote>.*send-both.*לשלוח את שניהם בהודעה אחת/s);
    assert.match(b, /<div class="pick" data-pick="toran"><blockquote class="msg">רק תורן<\/blockquote>/);
    // Nothing chosen: Toran's main one leads (both, as before).
    t.fake.state.lead = answer({ ...LEAD, teder: tederReady, chosen: null, send: { ...LEAD.send, options: ['both', 'toran', 'teder'], main: 'both', ...texts } });
    assert.match((await t.op.get('/admin/leads/12')).body, /<div class="pick on" data-pick="both">/);

    // Our number cannot send: each message to copy, its chat opening with it written in, and "שלחתי" for that demo.
    t.fake.state.lead = answer({ ...LEAD, teder: tederReady, chosen: null, send: { ...LEAD.send, pitchable: false, options: [], main: null, ...texts } });
    b = (await t.op.get('/admin/leads/12')).body;
    assert.match(b, /<div class="pick on" data-pick="both"><textarea id="lead-msg-12-both"[^>]*>שניהם בהודעה אחת<\/textarea>/);
    assert.ok(b.includes(`href="https://wa.me/972500000123?text=${encodeURIComponent(texts.tederText)}"`), "Teder's chat opens with Teder's text");
    assert.match(b, /data-copy="#lead-msg-12-teder"/);
    assert.match(b, /<div class="pick" data-pick="teder">.*action="\/admin\/leads\/12\/mark-sent".*name="product" value="teder".*>שלחתי<\/button>/s);
    assert.match(b, /מעתיקים ושולחים מהטלפון/);
    await t.op.post('/admin/leads/12/mark-sent', { product: 'teder' });
    assert.deepEqual(t.fake.posts().at(-1).body, { by: 'נתנאל', product: 'teder' });
    await t.op.post('/admin/leads/12/mark-sent', { product: 'nonsense' });
    assert.deepEqual(t.fake.posts().at(-1).body, { by: 'נתנאל' }, 'an unknown one is not passed on: Toran marks Toran');

    // Both chosen, only Toran's up and Teder's failed: Toran's message, and a line on what both waits for. A page under
    // review sends nothing.
    t.fake.state.lead = answer({ ...LEAD, teder: { ...none, state: 'failed' }, chosen: 'both', send: { ...LEAD.send, pitchable: false, options: [], main: null, bothText: null, toranText: 'רק תורן', tederText: null } });
    b = (await t.op.get('/admin/leads/12')).body;
    assert.match(b, /כשגם הדמו של תדר יהיה מוכן, אפשר לשלוח את שניהם בהודעה אחת\./);
    assert.doesNotMatch(b, /<fieldset class="seg">/, 'one message: no switch');
    t.fake.state.lead = answer({ ...LEAD, toran: { ...ready, state: 'review' }, send: { ...LEAD.send, pitchable: false, options: [], main: null, bothText: null, toranText: null, tederText: null, copy: null } });
    b = (await t.op.get('/admin/leads/12')).body;
    assert.match(b, /עוד אין מה לשלוח/);
    assert.doesNotMatch(b, /mark-sent/);
  } finally {
    await t.done();
  }
});

test("a lead's demos: the one button for what it goes on with (blue while there is no demo), a missing one is red with its mark grey, and its error says why", async () => {
  const t = await setup();
  try {
    t.fake.state.lead = answer({ ...LEAD, toran: none, teder: { ...none, state: 'failed', error: 'לא הצלחנו לקרוא את החנות' }, build: { toran: true, teder: true, both: false, toranWhyNot: null, go: go(['toran', 'teder'], ['toran'], ['teder']) }, chosen: null, send: { ...LEAD.send, options: [], main: null, bothText: null, toranText: null, tederText: null, copy: null } });
    const b = (await t.op.get('/admin/leads/12')).body;
    assert.match(b, /<article class="card" id="demos"><h3>הדמואים<\/h3>\n<div class="make-row"><details class="make"><summary class="primary">להמשיך עם…<\/summary>.*go-both.*go-toran.*go-teder/s);
    assert.match(b, /<div class="demo-box miss" id="toran"><header class="op-who"><span class="mark toran"[^]*<span class="tag miss">אין<\/span>/);
    assert.match(b, /<span class="tag miss">נכשל<\/span><\/h3><small class="bad">לא הצלחנו לקרוא את החנות<\/small>/);
    assert.match(b, /<div class="demo-box miss" id="teder">.*action="\/admin\/leads\/12\/build-teder".*<button class="primary">לנסות שוב<\/button>/s, "Teder's that failed: try again, here");
    // None yet (the owner, 2026-11-12: "add a build button for teder. if there is no demo, i should be able to build it
    // and then send a message according to that"): each box builds its own; with the other one there, the lead goes on
    // with both, so the message that waits is the one with both demos.
    t.fake.state.lead = answer({ ...LEAD, toran: none, teder: none, review: null, build: { toran: true, teder: true, both: true, toranWhyNot: null, go: go(['toran', 'teder'], ['toran'], ['teder']) }, chosen: null, send: { ...LEAD.send, options: [], main: null, bothText: null, toranText: null, tederText: null, copy: null } });
    const n = (await t.op.get('/admin/leads/12')).body;
    assert.match(n, /action="\/admin\/leads\/12\/build-toran".*<button class="primary">לבנות את הדף של תורן<\/button>/s);
    assert.match(n, /action="\/admin\/leads\/12\/build-teder".*<button class="primary">לבנות דמו של תדר<\/button>/s);
    assert.doesNotMatch(n, /שני הדמואים/, 'neither there: each alone');
    t.fake.state.lead = answer({ ...LEAD, teder: none, build: { toran: true, teder: true, both: false, toranWhyNot: null, go: go(['teder'], [], ['teder']) }, chosen: null });
    const withToran = (await t.op.get('/admin/leads/12')).body;
    assert.match(withToran, /<div class="demo-box miss" id="teder">[^]*?action="\/admin\/leads\/12\/go-both"[^]*?<button class="primary">לבנות דמו של תדר<\/button><\/form><\/div><p class="muted">כשהוא מוכן, ההודעה תצא עם שני הדמואים\.<\/p>/, "Toran's page up: Teder's made, and both go");
    t.fake.state.lead = answer({ ...LEAD, toran: none, review: null, teder: { ...LEAD.toran, pageUrl: 'https://teder.openfrequency.co.il/s/nurit-ceramics-a1b2c3' }, build: { toran: true, teder: false, both: false, toranWhyNot: null, go: go(['toran'], ['toran'], []) }, chosen: null });
    assert.match((await t.op.get('/admin/leads/12')).body, /<div class="demo-box miss" id="toran">[^]*?action="\/admin\/leads\/12\/go-both"[^]*?<button class="primary">לבנות את הדף של תורן<\/button>/, "and the other way round");
    // Toran's page waiting for a look, checked here: what holds it back, each with its fix in place, and the page itself
    // to look at; never Toran's own review page.
    const review = { ...LEAD.review, gaps: [{ key: 'name', he: 'אין שם לחנות.' }, { key: 'sample', he: 'אין שיחת דוגמה.' }], approved: false, name: null, colorsFound: ['#0a7d4f', '#b4532a'] };
    t.fake.state.lead = answer({ ...LEAD, toran: { ...LEAD.toran, state: 'review' }, review });
    const r = (await t.op.get('/admin/leads/12')).body;
    assert.match(r, /<div class="gaps" role="alert"><b>הדף לא נפתח לאף אחד עד שזה מתמלא<\/b><ul><li>אין שם לחנות<\/li><li>אין שיחת דוגמה שעברה את הבדיקה<\/li><\/ul><\/div>/);
    assert.match(r, /<details class="brand" open><summary>השם והצבע בדף<\/summary>\n<form method="post" action="\/admin\/leads\/12\/brand" class="brand-form">.*name="name" value="".*type="color" name="color" value="#0a7d4f"/s);
    assert.match(r, /<input type="hidden" name="color" value="#b4532a"><button class="quiet swatch-b" aria-label="להשתמש ב־#b4532a"><svg class="swatch"[^>]*><rect[^>]*fill="#b4532a"\/><\/svg>/, "the site's other colour, one press");
    assert.match(r, /action="\/admin\/leads\/12\/sample".*<button class="primary">לבנות את שיחת הדוגמה מחדש<\/button>/s);
    assert.ok(r.includes(`href="${LEAD.toran.pageUrl}?preview=1"`), 'the page itself, as its owner sees it before it is approved');
    assert.doesNotMatch(r, /\/admin\/(toran|teder)\/|leads\?tab=/, 'no old fronts');
    assert.match(r, /<details class="make"><summary>ממשיכים עם תורן<\/summary><div class="make-pick">.*go-both.*go-toran.*go-teder/s, 'the choice made, and the others, quietly');
    // Nothing missing, not approved yet: approving is the one main button here.
    t.fake.state.lead = answer({ ...LEAD, toran: { ...LEAD.toran, state: 'review' }, review: { ...LEAD.review, approved: false } });
    assert.match((await t.op.get('/admin/leads/12')).body, /action="\/admin\/leads\/12\/approve-toran".*<button class="primary">לאשר את הדף<\/button>/s);
    // Teder's up: the idea it is about, its page, and its own buttons under "עוד".
    t.fake.state.lead = answer({ ...LEAD, teder: { ...LEAD.toran, pageUrl: 'https://teder.openfrequency.co.il/s/nurit-ceramics-a1b2c3', idea: 'הסיפור של הקרמיקה' } });
    const td = (await t.op.get('/admin/leads/12')).body;
    assert.match(td, /<p dir="auto">רעיון לטיקטוק ולאינסטגרם שלהם: הסיפור של הקרמיקה<\/p>/);
    assert.match(td, /teder-redo.*teder-other.*<summary>להוריד את הדמו של תדר<\/summary>.*teder-remove/s);
    // The end of the road, apart: the page taken down, the store deleted, each asking twice.
    assert.match(td, /<article class="card end" id="end">.*<summary>להוריד את העמוד<\/summary>.*action="\/admin\/leads\/12\/takedown".*<summary>למחוק את החנות<\/summary>.*action="\/admin\/leads\/12\/delete"/s);
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
    assert.equal((await anon.get('/admin/leads/reached')).headers.location, '/admin/login');
    assert.equal(t.fake.calls.length, 0);
  } finally {
    await t.done();
  }
});

// The owner, 2026-11-12: "On the leda page, those that were already reached to, move them to a different page".
test('the stores we wrote to are a list of their own: each list its tabs and its count, a link between them, and a lead goes back to its own', async () => {
  const t = await setup();
  try {
    const sent = { ...LIST.leads[0].toran, sentAt: '2026-11-07T09:00:00.000Z' };
    t.fake.state.leads = {
      ...LIST,
      leads: [
        row({ id: 31, name: 'חדשה', where: 'new', toran: none, teder: none }),
        row({ id: 32, name: 'מוכנה', where: 'ready' }),
        row({ id: 33, name: 'נשלחה', where: 'sent', toran: sent }),
        row({ id: 34, name: 'ענתה', where: 'talking', toran: sent }),
        row({ id: 35, name: 'נסגרה אחרי ההודעה', where: 'closed', toran: sent }),
        row({ id: 36, name: 'דילגנו עליה', where: 'closed', toran: none, teder: none }),
        row({ id: 37, name: 'רק תדר נשלח', where: 'sent', teder: { ...LIST.leads[0].teder, sentAt: '2026-11-07T09:00:00.000Z' } }),
      ],
      tederOnly: [],
    };
    const ids = (b) => [...b.matchAll(/<li id="lead-(\d+)">/g)].map((m) => Number(m[1]));
    const tabs = (b) => [.../<nav class="tabs lead-tabs"[^>]*>(.*?)<\/nav>/s.exec(b)[1].matchAll(/<a href="([^"]+)"[^>]*>([^<]+) <span class="muted">(\d+)<\/span><\/a>/g)].map((m) => [m[1], m[2], Number(m[3])]);
    // The leads: the ones we have not written to, closed before any message too; a link to the others, with how many.
    const leads = (await t.op.get('/admin/leads')).body;
    assert.deepEqual(ids(leads), [31, 32, 36]);
    assert.deepEqual(tabs(leads), [['/admin/leads', 'הכול', 3], ['/admin/leads?where=new', 'חדשים', 1], ['/admin/leads?where=ready', 'מוכנים לשליחה', 1], ['/admin/leads?where=closed', 'סגורים', 1]]);
    assert.match(leads, /<a class="chip to-reached" href="\/admin\/leads\/reached">פנינו אליהם <span class="muted">4<\/span><\/a>/);
    assert.match(leads, /action="\/admin\/leads\/add"/, 'stores are added and found here');
    // The ones we wrote to, by either product: where each stands since, back to the leads, and nothing to add or find.
    const r = await t.op.get('/admin/leads/reached');
    assert.equal(r.status, 200);
    assert.match(r.body, /<title>פנינו אליהם · OpenFrequency<\/title>/);
    assert.match(r.body, /<a href="\/admin\/leads" aria-current="page">לידים<\/a>/, "the header's tab is the leads'");
    assert.deepEqual(ids(r.body), [33, 34, 35, 37]);
    assert.deepEqual(tabs(r.body), [['/admin/leads/reached', 'הכול', 4], ['/admin/leads/reached?where=sent', 'מחכים לתשובה', 2], ['/admin/leads/reached?where=talking', 'בשיחה', 1], ['/admin/leads/reached?where=closed', 'סגורים', 1]]);
    assert.match(r.body, /<p><a href="\/admin\/leads">← לידים<\/a><\/p>\n<div class="list-h"><h2>פנינו אליהם<\/h2>/);
    assert.match(r.body, /<form class="row lead-search" method="get" action="\/admin\/leads\/reached" role="search">/);
    assert.doesNotMatch(r.body, /action="\/admin\/leads\/(add|discover)"|class="lead-all"/);
    assert.match(r.body, /<li id="lead-34">.*?<span class="tag where">בשיחה<\/span>/s);
    // Under a tab, its own; a choice made from a row comes back to this list, at the row.
    assert.deepEqual(ids((await t.op.get('/admin/leads/reached?where=closed')).body), [35]);
    assert.deepEqual(ids((await t.op.get('/admin/leads?where=closed')).body), [36]);
    const tab = (await t.op.get('/admin/leads/reached?where=sent')).body;
    assert.match(new RegExp('<li id="lead-33">(.*?)</li>', 's').exec(tab)[1], /<input type="hidden" name="page" value="reached"><input type="hidden" name="where" value="sent">/);
    assert.equal((await t.op.post('/admin/leads/33/go-teder', { back: 'list', page: 'reached', where: 'sent' })).headers.location, '/admin/leads/reached?where=sent#lead-33');
    assert.equal((await t.op.post('/admin/leads/31/go-teder', { back: 'list', where: 'sent' })).headers.location, '/admin/leads#lead-31', "a tab that is not the list's own is all");
    // A search counts the other list too, and its link keeps it: the store searched for is found on its own list.
    const q = (await t.op.get('/admin/leads?q=x')).body;
    assert.match(q, /<a class="chip to-reached" href="\/admin\/leads\/reached\?q=x">/);
    t.fake.state.leads = { ...t.fake.state.leads, leads: t.fake.state.leads.leads.filter((x) => x.id === 33) };
    const found = (await t.op.get('/admin/leads?q=x')).body;
    assert.match(found, /<b>אין כאן חנויות<\/b><p>אין כאן חנות שהשם או הדומיין שלה כוללים &quot;x&quot;\.<\/p>/);
    assert.match(found, /פנינו אליהם <span class="muted">1<\/span>/);
    // An old link to a tab that is now the other list's opens there.
    assert.equal((await t.op.get('/admin/leads?where=talking&q=x')).headers.location, '/admin/leads/reached?where=talking&q=x');
    assert.equal((await t.op.get('/admin/leads/reached?where=new')).headers.location, '/admin/leads?where=new');
    // Nothing written to yet: the list says so in its own words.
    const counts = (o) => ({ all: 0, new: 0, ready: 0, sent: 0, talking: 0, closed: 0, ...o });
    t.fake.state.leads = { ...LIST, counts: counts({ all: 1, new: 1 }), leads: [row({ id: 31, where: 'new', toran: none, teder: none })], tederOnly: [] };
    assert.match((await t.op.get('/admin/leads/reached')).body, /<b>עוד לא פנינו לאף חנות<\/b><p>חנות עוברת לכאן כשההודעה הראשונה אליה יוצאת\.<\/p>/);
    assert.match((await t.op.get('/admin/leads?where=closed')).body, /<b>אין כאן חנויות<\/b><\/div>/);
    // A lead's page goes back to the list it is on.
    t.fake.state.lead = answer({ ...LEAD, where: 'sent', toran: { ...LEAD.toran, sentAt: '2026-11-07T09:00:00.000Z' } });
    assert.match((await t.op.get('/admin/leads/12')).body, /<p><a href="\/admin\/leads\/reached">← פנינו אליהם<\/a><\/p>/);
    t.fake.state.lead = null;
    assert.match((await t.op.get('/admin/leads/12')).body, /<p><a href="\/admin\/leads">← לידים<\/a><\/p>/);
    // The list's empty title is its own (the choice "neither" had the same key, and won).
    t.fake.state.leads = { ...LIST, counts: counts({}), leads: [], tederOnly: [] };
    assert.match((await t.op.get('/admin/leads')).body, /<b>אין כאן לידים<\/b><p>ליד מופיע כאן כשתורן מוצא חנות מתאימה/);
  } finally {
    await t.done();
  }
});

test('the counts of each list: past the 300 Toran sends at once, the tabs that are one list\'s alone are counted as Toran counts them', async () => {
  const { leadsOfPage } = await import('../src/web/toran.js');
  const { readLeads } = await import('../src/web/toran.js');
  const sent = { ...LIST.leads[0].toran, sentAt: '2026-11-07T09:00:00.000Z' };
  const d = readLeads({ ...LIST, counts: { all: 420, new: 300, ready: 40, sent: 50, talking: 10, closed: 20 }, leads: [row({ id: 1, where: 'new' }), row({ id: 2, where: 'sent', toran: sent }), row({ id: 3, where: 'closed', toran: sent }), row({ id: 4, where: 'closed' })], tederOnly: [] });
  const cut = leadsOfPage(d, { page: 'leads' });
  assert.deepEqual(cut.counts, { leads: { all: 341, new: 300, ready: 40, closed: 1 }, reached: { all: 61, sent: 50, talking: 10, closed: 1 } });
  assert.deepEqual(cut.leads.map((x) => x.id), [1, 4]);
  // With a search, the counts are of what it found.
  assert.deepEqual(leadsOfPage(d, { page: 'reached', q: 'x' }).counts.reached, { all: 2, sent: 1, talking: 0, closed: 1 });
});

// The owner, 2026-11-12: "Lead page shouldnt let me send a message while a demo is being built".
test("while a demo of the lead is being built, nothing can be sent from its page: one line says so and the page looks again, and a send from a page opened before is refused", async () => {
  const t = await setup();
  try {
    const tederUp = { ...LEAD.toran, pageUrl: 'https://teder.openfrequency.co.il/s/nurit-ceramics-a1b2c3', idea: 'הסיפור של הקרמיקה' };
    const sendable = { ...LEAD.send, options: ['both', 'toran', 'teder'], main: 'both', bothText: 'שניהם', toranText: 'רק תורן', tederText: 'רק תדר' };
    const card = (b) => /<article class="card" id="send">(.*?)<\/article>/s.exec(b)[1];
    // Teder's demo written (again): no message, no button, no copy; one line, and the page looks again by itself.
    t.fake.state.lead = answer({ ...LEAD, teder: { ...none, state: 'building' }, chosen: 'both', send: { ...sendable, options: ['toran'], main: 'toran' } });
    let b = card((await t.op.get('/admin/leads/12')).body);
    assert.equal(b, '<h3>מה שולחים</h3><p class="muted" data-reload="20">הדמו של תדר עוד נבנה. אפשר יהיה לשלוח כשהוא מוכן.</p><p><a href="/admin/leads/12#send">לבדוק שוב</a></p>');
    // Toran's page read again, or its sample chat made again, while Teder's is up: the same.
    t.fake.state.lead = answer({ ...LEAD, teder: tederUp, review: { ...LEAD.review, building: true }, send: sendable });
    b = card((await t.op.get('/admin/leads/12')).body);
    assert.match(b, /הדמו של תורן עוד נבנה\./);
    assert.doesNotMatch(b, /send-|mark-sent|<blockquote|<textarea/);
    // Both being built, nothing sent yet: both named.
    t.fake.state.lead = answer({ ...LEAD, toran: { ...none, state: 'building' }, teder: { ...none, state: 'building' }, review: null, send: { ...LEAD.send, options: [], main: null, bothText: null, toranText: null, tederText: null } });
    assert.match(card((await t.op.get('/admin/leads/12')).body), /הדמואים של תורן ושל תדר עוד נבנים\. אפשר יהיה לשלוח כשהם מוכנים\./);
    // Sent already and the reminder not due: when it will be says more than the build.
    t.fake.state.lead = answer({ ...LEAD, toran: { ...LEAD.toran, sentAt: '2026-11-07T09:00:00.000Z' }, review: { ...LEAD.review, building: true }, send: { ...LEAD.send, options: [], main: null, waitingUntil: '2026-11-11T09:00:00.000Z', bothText: null, toranText: null, tederText: null } });
    assert.match(card((await t.op.get('/admin/leads/12')).body), /ההודעה נשלחה\. התזכורת האחת תהיה מוכנה/);

    // A send from a page opened before the build: not sent, and the lead says why.
    t.fake.state.lead = answer({ ...LEAD, teder: { ...none, state: 'building' }, send: { ...sendable, options: ['toran'], main: 'toran' } });
    const before = t.fake.posts().length;
    const r = await t.op.post('/admin/leads/12/send-toran', {});
    assert.equal(r.headers.location, '/admin/leads/12');
    assert.equal(t.fake.posts().length, before, 'nothing reached Toran');
    assert.match((await t.op.get('/admin/leads/12')).body, /<p class="flash bad" role="alert">ההודעה לא נשלחה, כי הדמו עוד נבנה\. אפשר לשלוח כשהוא מוכן\.<\/p>/);
    // "שלחתי" on a message already sent by hand is kept: it went.
    await t.op.post('/admin/leads/12/mark-sent', { product: 'toran' });
    assert.equal(t.fake.posts().at(-1).path, '/internal/leads/12/mark-sent');
    // Built: it goes.
    t.fake.state.lead = answer({ ...LEAD, teder: tederUp, send: sendable });
    await t.op.post('/admin/leads/12/send-both', {});
    assert.equal(t.fake.posts().at(-1).path, '/internal/leads/12/send-both');
    assert.doesNotMatch((await t.op.get('/admin/leads/12')).body, /data-reload/);
  } finally {
    await t.done();
  }
});

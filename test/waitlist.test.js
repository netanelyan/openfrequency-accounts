// /admin/waitlist: Toran's waitlist from the website (a fake of openfrequency-web's /internal/waitlist), and a
// message to it: emails sent by the website, a WhatsApp button for each phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeUser, tempHome } from './helpers.js';
import { signedIn, startSite } from './site.js';

async function fakeSite() {
  const calls = [];
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      res.writeHead(req.url === '/internal/waitlist/send' && calls.filter((c) => c.path === req.url).length > 1 ? 409 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/internal/waitlist'
        ? { waitlist: [{ id: 2, contact: '972501234567', store: 'shop.co.il', createdAt: new Date().toISOString() }, { id: 1, contact: 'a@b.co.il', store: null, createdAt: '2026-01-01T00:00:00.000Z' }, { id: 3, contact: '<script>' }] }
        : calls.filter((c) => c.path === req.url).length > 1 ? { error: 'again' } : { emails: 1, phones: ['972501234567'] }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { calls, url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((ok) => s.close(ok)) };
}

test('the operator sees the whole waitlist, sends it a message, and gets a WhatsApp button per phone; a second send is refused', async () => {
  const h = tempHome();
  const fake = await fakeSite();
  const site = await startSite(h.db, { env: { OF_SITE_INTERNAL: fake.url } });
  try {
    const op = signedIn(site, h.db, makeUser(h.db, 'admin@example.com', { superadmin: true }));
    const r = await op.get('/admin/waitlist');
    assert.equal(r.status, 200);
    assert.match(r.body, /2 ברשימת ההמתנה של תורן/);
    assert.match(r.body, /\+972501234567/);
    assert.match(r.body, /a@b\.co\.il/);
    assert.doesNotMatch(r.body, /<script>/);
    assert.match(r.body, /action="\/admin\/waitlist\/send"/);
    assert.equal(fake.calls[0].auth, 'Bearer internal-token-for-tests-only-0123456789');

    const sent = await op.post('/admin/waitlist/send', { subject: 'תורן נפתח', text: 'שלום לכולם' });
    assert.equal(sent.status, 200);
    assert.deepEqual(fake.calls.find((c) => c.method === 'POST').body, { subject: 'תורן נפתח', text: 'שלום לכולם' });
    assert.match(sent.body, /המייל יוצא עכשיו ל-1 כתובות/);
    assert.ok(sent.body.includes(`https://wa.me/972501234567?text=${encodeURIComponent('שלום לכולם')}`));
    assert.equal(h.db.get("SELECT count(*) AS n FROM audit WHERE action = 'waitlist_message'").n, 1);

    const again = await op.post('/admin/waitlist/send', { subject: 'תורן נפתח', text: 'שלום לכולם' });
    assert.equal(again.status, 409);
    assert.match(again.body, /כבר נשלחה/);

    // Not the superadmin: nothing.
    const owner = signedIn(site, h.db, makeUser(h.db, 'owner@example.com'));
    assert.notEqual((await owner.get('/admin/waitlist')).status, 200);
  } finally {
    await site.close();
    await fake.close();
    h.cleanup();
  }
});

test('a website that does not answer leaves the page saying so', async () => {
  const h = tempHome();
  const site = await startSite(h.db);
  try {
    const op = signedIn(site, h.db, makeUser(h.db, 'admin@example.com', { superadmin: true }));
    const r = await op.get('/admin/waitlist');
    assert.equal(r.status, 200);
    assert.match(r.body, /לא הצלחנו לקרוא עכשיו את הרשימה/);
  } finally {
    await site.close();
    h.cleanup();
  }
});

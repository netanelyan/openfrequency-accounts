import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { createMailer } from '../src/mail/send.js';
import { inviteMail, magicLinkMail } from '../src/mail/messages.js';
import { MAIL, T } from '../src/web/copy.js';
import { outboxDir } from '../src/core/paths.js';

const LINK = 'https://accounts.openfrequency.co.il/auth/link?t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

test('with a key, each email is one call to Resend with the documented fields', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push({ url, init }), new Response('{"id":"x"}', { status: 200 }));
  const m = createMailer({ env: { RESEND_API_KEY: 'key-for-tests', MAIL_FROM: 'OpenFrequency <hi@example.com>', MAIL_REPLY_TO: 'help@example.com' }, fetchImpl, log: () => {} });
  assert.equal(m.sending, 'resend');
  m.send(magicLinkMail('dana@example.com', LINK));
  await m.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer key-for-tests');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'reply_to', 'subject', 'text', 'to']);
  assert.deepEqual(body.to, ['dana@example.com']);
  assert.equal(body.from, 'OpenFrequency <hi@example.com>');
  assert.equal(body.reply_to, 'help@example.com');
  assert.equal(body.subject, MAIL.magicSubject);
});

test('a failed send is logged, never thrown, and never stops the next one', async () => {
  const logs = [];
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? new Response('bad', { status: 422 }) : new Response('{}', { status: 200 }));
  const m = createMailer({ env: { RESEND_API_KEY: 'k' }, fetchImpl, log: (s) => logs.push(s) });
  m.send(magicLinkMail('a@example.com', LINK));
  m.send(magicLinkMail('b@example.com', LINK));
  await m.flush();
  assert.equal(n, 2);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /a@example\.com failed: Resend answered 422/);
});

test('without a key, the email is written to the outbox and its link printed', async () => {
  const h = tempHome();
  try {
    const logs = [];
    const m = createMailer({ env: { OF_HOME: h.home }, log: (s) => logs.push(s) });
    assert.equal(m.sending, 'outbox');
    m.send(magicLinkMail('dana@example.com', LINK));
    await m.flush();
    const files = readdirSync(outboxDir({ OF_HOME: h.home }));
    assert.equal(files.length, 1);
    const saved = JSON.parse(readFileSync(path.join(outboxDir({ OF_HOME: h.home }), files[0]), 'utf8'));
    assert.equal(saved.to, 'dana@example.com');
    assert.equal(saved.link, LINK);
    assert.match(logs[0], /not sent/);
    assert.ok(logs[0].includes(LINK));
  } finally {
    h.cleanup();
  }
});

test('the magic-link email: Hebrew, right to left, the link as a button and in full', () => {
  const m = magicLinkMail('dana@example.com', LINK);
  assert.match(m.html, /<html lang="he" dir="rtl">/);
  assert.equal(m.html.split(LINK).length - 1, 2);
  assert.ok(m.text.includes(LINK));
  assert.match(m.text, /15 דקות/);
  assert.match(m.text, /לא ביקשתם\?/);
});

test('the invite email names the workspace and when the invite ends, escaped', () => {
  const m = inviteMail('noa@example.com', 'Dana <b>Shop</b>', LINK.replace('/auth/link', '/invite'), '2026-10-25T10:00:00.000Z');
  assert.equal(m.subject, 'הזמנה ל-Dana <b>Shop</b> ב-OpenFrequency');
  assert.ok(m.html.includes('Dana &lt;b&gt;Shop&lt;/b&gt;'));
  assert.ok(!m.html.includes('<b>Shop</b>'));
  // Israel time: summer time ends on 25 October 2026 at 02:00, so 10:00 UTC is 12:00.
  assert.match(m.text, /25\.10\.2026, 12:00/);
});

// The hebrew-voice rules a test can hold: no em or en dashes, no exclamation
// marks, no gendered slashes, no bureaucratic words, no masculine singular commands.
test('every Hebrew string keeps the voice rules', () => {
  const strings = [];
  const walk = (v) => {
    if (typeof v === 'string') strings.push(v);
    else if (typeof v === 'function') {
      const out = v('X', 'Y', 'Z');
      walk(out);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(T);
  walk(MAIL);
  const hebrew = strings.filter((s) => /[֐-׿]/.test(s));
  assert.ok(hebrew.length > 60, `only ${hebrew.length} Hebrew strings found`);
  for (const s of hebrew) {
    assert.doesNotMatch(s, /[–—]/, `dash in: ${s}`);
    assert.doesNotMatch(s, /!/, `exclamation in: ${s}`);
    assert.doesNotMatch(s, /[֐-׿]\/[֐-׿]/, `gendered slash in: ${s}`);
    assert.doesNotMatch(s, /הננו|בגין|על מנת|במידה ו|ניתן ל|יש לציין|לשירותכם|המערכת/, `bureaucratic in: ${s}`);
    assert.doesNotMatch(s, /(^|\s)(הקלד|לחץ|הזן|בחר|שלח|היכנס)(\s|$)/, `masculine singular in: ${s}`);
  }
});

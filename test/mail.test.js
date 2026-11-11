import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { createMailer } from '../src/mail/send.js';
import { billingMail, inviteMail, ltrNumbers, magicLinkMail, receiptNoticeMail, welcomeMail } from '../src/mail/messages.js';
import { ADD, AUDIT_NAMES, CANCEL, ERASE, MAIL, MORNING, NOTIFY, PAY, SETUP, SIGNUP, T, ils } from '../src/web/copy.js';
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

test("OpenFrequency's own emails wear its mark, its name and its blue, preview their first real line, and end with the site's foot", () => {
  const m = magicLinkMail('dana@example.com', LINK);
  assert.ok(m.html.includes('src="https://openfrequency.co.il/mail/openfrequency.png"'));
  assert.match(m.html, /color:#2747d6">OpenFrequency<\/td>/);
  assert.match(m.html, /bgcolor="#0071e3"/);
  // The inbox's preview is the first line that says something, not "שלום,".
  assert.match(m.html, /<div style="display:none[^"]*">ביקשתם להיכנס ל-OpenFrequency\. זה הקישור:<\/div>/);
  assert.match(m.html, /OpenFrequency™ · <a href="https:\/\/openfrequency\.co\.il"/);
  // Dark mode for the mail programs that read it; the light colours stay inline for the rest.
  assert.match(m.html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(m.html, /<meta name="color-scheme" content="light dark">/);
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
  // "לחשבון של", never "ל-" before a name (the audit of 2026-11-11: "הזמנה ל-הסטודיו של דנה").
  assert.equal(m.subject, 'הזמנה לחשבון של Dana <b>Shop</b> ב-OpenFrequency');
  assert.ok(m.html.includes('Dana &lt;b&gt;Shop&lt;/b&gt;'));
  assert.ok(!m.html.includes('<b>Shop</b>'));
  // Israel time: summer time ends on 25 October 2026 at 02:00, so 10:00 UTC is 12:00.
  assert.match(m.text, /25\.10\.2026, 12:00/);
  // From an owner on the home page: who sent it, made plain (no line breaks or bidi overrides in it) and escaped.
  const from = inviteMail('noa@example.com', 'Dana Shop', LINK.replace('/auth/link', '/invite'), '2026-10-25T10:00:00.000Z', 'דנה <i>' + String.fromCharCode(0x202e) + 'כהן</i>\nX');
  assert.match(from.text, /קיבלתם הזמנה מ-דנה <i> כהן<\/i> X להצטרף לחשבון של Dana Shop ב-OpenFrequency\./);
  assert.ok(from.html.includes('מ-דנה &lt;i&gt; כהן&lt;/i&gt; X להצטרף'));
  assert.match(from.text, /בקשו מ-דנה <i> כהן<\/i> X לשלוח הזמנה חדשה\./);
});

test('an amount of a thousand and up stays whole and left to right in the HTML: 3,610.80, never "610.80,3" (the audit of 2026-11-11)', () => {
  const span = (n) => `<span dir="ltr" style="white-space:nowrap">${n}</span>`;
  // Every shape an amount takes: thousands with and without agorot, under a thousand, none. A number with no
  // separator is already one run and is left as it is.
  for (const [n, out] of [
    ['1,490', span('1,490')],
    ['3,610.80', span('3,610.80')],
    ['1,404.20', span('1,404.20')],
    ['1,746.40', span('1,746.40')],
    ['790', '790'],
    ['0', '0'],
  ])
    assert.equal(ltrNumbers(`${n} ₪`), `${out} ₪`, n);
  // The comma after a date is the sentence's: the date alone is kept whole.
  assert.equal(ltrNumbers('10.11.2026, והתשלום'), `${span('10.11.2026')}, והתשלום`);
  assert.equal(ltrNumbers('25.10.2026, 12:00'), `${span('25.10.2026')}, ${span('12:00')}`);

  // The welcome email of Teder's small plan: 490 + 990 before VAT, 1,746.40 with it, then 578.20 a month.
  const w = welcomeMail('dana@example.com', {
    business: 'הסטודיו של דנה',
    link: 'https://accounts.openfrequency.co.il/setup',
    prices: [MAIL.welcomePrice('תדר, החבילה הקטנה', ils(490), ils(990), true)],
    total: [MAIL.payNow(ils(1746.4), ils(1480), ils(266.4)), MAIL.payThen(ils(578.2))],
    payHow: 'העברה בנקאית',
  });
  assert.ok(w.html.includes(`סך הכול לתשלום עכשיו: ${span('1,746.40')} ₪, כולל מע״מ (${span('1,480')} ₪ ועוד ${span('266.40')} ₪ מע״מ).`), 'the total and its parts');
  assert.ok(w.html.includes('ודמי הקמה של 990 ₪'), 'an amount under a thousand as it is');
  assert.ok(w.html.includes(`אחר כך ${span('578.20')} ₪ לחודש`));
  // The bug: only the part after the comma was wrapped, and the isolated span moved left of "1,".
  assert.ok(!w.html.includes(`1,${span('746.40')}`));
  // A billing email of Toran's big plan: 1,190 before VAT, 1,404.20 with it.
  const b = billingMail('dana@example.com', { kind: 'due', business: 'הסטודיו של דנה', product: 'toran', paidUntil: '2026-11-10', dueOn: '2026-11-11', graceUntil: '2026-11-13', amount: MAIL.amount(ils(1190), true, ils(1404.2)), pay: [], link: 'https://accounts.openfrequency.co.il/setup' });
  assert.ok(b.html.includes(`(${span('1,190')} ₪ ועוד מע״מ, ${span('1,404.20')} ₪ בסך הכול)`));
  // The operator's receipt notice: 3,610.80.
  const r = receiptNoticeMail('boss@example.com', { business: 'הסטודיו של דנה', total: 3610.8, phone: '972500000123', at: '2026-11-11T10:00:00.000Z', link: 'https://accounts.openfrequency.co.il/admin/receipts/1' });
  assert.ok(r.html.includes(`סכום: ${span('3,610.80')} ₪, כולל מע״מ`));
  // The text part was never wrong, and stays so.
  assert.match(w.text, /סך הכול לתשלום עכשיו: 1,746\.40 ₪/);
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
  walk(AUDIT_NAMES);
  walk(SIGNUP);
  walk(SETUP);
  walk(CANCEL);
  walk(ERASE);
  walk(NOTIFY);
  walk(PAY);
  walk(MORNING);
  walk(ADD);
  const hebrew = strings.filter((s) => /[֐-׿]/.test(s));
  assert.ok(hebrew.length > 60, `only ${hebrew.length} Hebrew strings found`);
  for (const s of hebrew) {
    assert.doesNotMatch(s, /[–—]/, `dash in: ${s}`);
    assert.doesNotMatch(s, /!/, `exclamation in: ${s}`);
    assert.doesNotMatch(s, /[֐-׿]\/[֐-׿]/, `gendered slash in: ${s}`);
    assert.doesNotMatch(s, /הננו|בגין|על מנת|במידה ו|ניתן ל|יש לציין|לשירותכם|המערכת/, `bureaucratic in: ${s}`);
    assert.doesNotMatch(s, /(^|\s)(הקלד|לחץ|הזן|בחר|שלח|היכנס)(\s|$)/, `masculine singular in: ${s}`);
    // Payment is a bank transfer (the owner, 2026-11-05: not "שלמו בווצאפ"): WhatsApp is where the details and the
    // receipt go, and the one button that leads there is "לתשלום אוטומטי בוואטסאפ".
    assert.doesNotMatch(s, /(שלמו|לשלם|משלמים|תשלמו|לתשלום)\s+(לנו\s+)?(ב|דרך\s+|ב-)?וו?[אצ]ט?ס?אפ/, `paying on WhatsApp in: ${s}`);
  }
  assert.equal(PAY.button, 'לתשלום אוטומטי בוואטסאפ');
});

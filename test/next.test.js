import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../src/auth/next.js';

// ?next= decides where a signed-in browser goes. Anything that could land
// outside *.openfrequency.co.il is an open redirect: a phishing link that
// starts on our real login page. These are the known ways in.

test('a product subdomain over https is allowed, normalised', () => {
  for (const [given, want] of [
    ['https://teder.openfrequency.co.il', 'https://teder.openfrequency.co.il/'],
    ['https://toran.openfrequency.co.il/inbox?x=1#top', 'https://toran.openfrequency.co.il/inbox?x=1#top'],
    ['https://TEDER.OpenFrequency.co.il/Posts', 'https://teder.openfrequency.co.il/Posts'],
    ['https://teder.openfrequency.co.il:443/', 'https://teder.openfrequency.co.il/'],
    ['https://new-product.openfrequency.co.il/', 'https://new-product.openfrequency.co.il/'],
  ]) {
    assert.equal(safeNext(given), want, given);
  }
});

test('a path on this site is allowed and stays a path', () => {
  assert.equal(safeNext('/admin'), '/admin');
  assert.equal(safeNext('/admin/workspaces?q=a#b'), '/admin/workspaces?q=a#b');
  assert.equal(safeNext('/%2F%2Fevil.example'), '/%2F%2Fevil.example');
});

const refused = [
  // other hosts, and hosts that only look like ours
  'https://evil.example/',
  'https://openfrequency.co.il.evil.example/',
  'https://teder.openfrequency.co.il.evil.example/',
  'https://evilopenfrequency.co.il/',
  'https://evil.example/#.openfrequency.co.il',
  'https://evil.example/?.openfrequency.co.il',
  'https://teder.openfrequency.co.il%2e.evil.example/',
  'https://teder.openfrequency.co.il./',
  // the bare domain (the public website) and deeper names
  'https://openfrequency.co.il/',
  'https://a.b.openfrequency.co.il/',
  // credentials, which browsers show as if they were the host
  'https://teder.openfrequency.co.il@evil.example/',
  'https://evil.example@teder.openfrequency.co.il/',
  'https://user:pass@teder.openfrequency.co.il/',
  // other schemes and ports
  'http://teder.openfrequency.co.il/',
  'javascript:alert(1)//.openfrequency.co.il',
  'data:text/html,hi',
  'ftp://teder.openfrequency.co.il/',
  'https://teder.openfrequency.co.il:8443/',
  // protocol-relative and backslash tricks
  '//evil.example/',
  '//teder.openfrequency.co.il/',
  '/\\evil.example/',
  '\\\\evil.example/',
  'https:\\\\evil.example',
  'https://evil.example\\@teder.openfrequency.co.il/',
  // whitespace and control characters the URL parser would silently drop
  '/\t/evil.example/',
  '/\n/evil.example/',
  ' https://teder.openfrequency.co.il/',
  'https://teder.openfrequency.co.il/\r\nSet-Cookie: x=1',
  'java\tscript:alert(1)',
  '/\u0000/evil.example',
  '/　/evil.example',
  // not a URL at all, or not a string, or too long
  'teder.openfrequency.co.il',
  'https://',
  '',
  null,
  undefined,
  ['https://teder.openfrequency.co.il/'],
  `https://teder.openfrequency.co.il/${'a'.repeat(2048)}`,
];

for (const given of refused) {
  test(`?next= refuses ${JSON.stringify(given)?.slice(0, 70)}`, () => {
    assert.equal(safeNext(given), null);
  });
}

test('localhost is allowed only in development, and only over http', () => {
  assert.equal(safeNext('http://localhost:4700/'), null);
  assert.equal(safeNext('http://localhost:4700/', { allowLocal: true }), 'http://localhost:4700/');
  assert.equal(safeNext('http://127.0.0.1:4710/x', { allowLocal: true }), 'http://127.0.0.1:4710/x');
  assert.equal(safeNext('http://localhost.evil.example/', { allowLocal: true }), null);
  assert.equal(safeNext('http://evil.example/', { allowLocal: true }), null);
});

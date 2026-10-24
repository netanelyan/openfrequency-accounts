import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, describe, israelToday } from '../src/accounts/subscriptions.js';

// What a customer's dashboard says of a subscription, worked out from the days OpenFrequency records.

const S = { monthly: 449, vat: 'excluded', setup: 990, started_on: '2026-10-01', paid_until: null, ends_on: null };

test('a month on is the same day, or the month\'s last day when it has none', () => {
  assert.equal(addMonths('2026-10-22'), '2026-11-22');
  assert.equal(addMonths('2026-01-31'), '2026-02-28');
  assert.equal(addMonths('2028-01-31'), '2028-02-29');
  assert.equal(addMonths('2026-12-15'), '2027-01-15');
  assert.equal(israelToday(Date.parse('2026-10-22T22:30:00Z')), '2026-10-23', "Israel's day, not UTC's");
});

test('the states: on with nothing paid yet, active with the days left, waiting for payment, ending, ended', () => {
  assert.equal(describe(S, '2026-10-05').status, 'open');
  const a = describe({ ...S, paid_until: '2026-10-31' }, '2026-10-22');
  assert.deepEqual([a.status, a.left, a.period], ['active', 10, 31]);
  assert.deepEqual(a.next, { on: '2026-11-01', monthly: 449, vat: 'excluded' });
  assert.equal(describe({ ...S, paid_until: '2026-10-31' }, '2026-10-31').left, 1, 'the last paid day');
  const due = describe({ ...S, paid_until: '2026-10-31' }, '2026-11-03');
  assert.deepEqual([due.status, due.next.on], ['due', '2026-11-01']);
  const ending = describe({ ...S, paid_until: '2026-10-31', ends_on: '2026-10-31' }, '2026-10-29');
  assert.deepEqual([ending.status, ending.left, ending.next], ['ending', 3, null]);
  assert.equal(describe({ ...S, ends_on: '2026-10-31' }, '2026-11-01').status, 'ended');
  assert.equal(describe(null), null);
});

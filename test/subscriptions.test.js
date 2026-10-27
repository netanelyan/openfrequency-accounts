import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, describe, israelToday } from '../src/accounts/subscriptions.js';
import { homePage } from '../src/web/html.js';

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

test("the bar is the month paid for that today is in: day 1 on its first day, full on its last, none once it is over", () => {
  const paid = { ...S, paid_until: '2026-11-21' };
  const first = describe(paid, '2026-10-22');
  assert.deepEqual(first.bar, { from: '2026-10-22', to: '2026-11-21', days: 31, day: 1 }, 'the day the month was paid for');
  assert.equal(first.left, 31);
  const last = describe(paid, '2026-11-21');
  assert.deepEqual([last.bar.day, last.bar.days, last.left], [31, 31, 1], 'its last day: full');
  assert.equal(describe(paid, '2026-11-22').bar, null, 'waiting for payment: no bar');
  assert.equal(describe(S, '2026-10-22').bar, null, 'nothing paid yet: no bar');
  assert.equal(describe({ ...paid, ends_on: '2026-11-21' }, '2026-11-22').bar, null, 'ended: no bar');

  // Paid three months ahead: this month's bar, not one 92 days long, and the next charge after the last paid day.
  const ahead = describe({ ...S, paid_until: '2027-01-21' }, '2026-11-30');
  assert.deepEqual(ahead.bar, { from: '2026-11-22', to: '2026-12-21', days: 30, day: 9 });
  assert.equal(ahead.next.on, '2027-01-22');
  // February, from the 31st: the month ends on its last day, as payMonth() records it.
  assert.deepEqual(describe({ ...S, paid_until: '2027-02-27' }, '2027-02-01').bar, { from: '2027-01-28', to: '2027-02-27', days: 31, day: 5 });

  // Ending: the bar stops on the last day, even when that comes before the end of the month paid for.
  const ending = describe({ ...paid, ends_on: '2026-11-10' }, '2026-11-01');
  assert.deepEqual([ending.status, ending.left, ending.bar.to, ending.bar.days, ending.bar.day], ['ending', 10, '2026-11-10', 20, 11]);
  assert.equal(describe({ ...S, ends_on: '2026-11-10' }, '2026-11-01').bar, null, 'ending with nothing paid: no bar');
});

test('on the page: a <progress> with its numbers in words, the days left and the next charge beside it; no bar where nothing is paid', () => {
  // The next charge is shown once a payment provider is connected (providerReady); before that, only "paid until".
  const page = (s, today, providerReady = true) =>
    homePage({ csrf: 'x', user: { id: 1, email: 'dana@example.com', name: 'דנה' }, workspace: { name: 'החנות' }, products: ['teder'], productUrls: { teder: '/' }, subscriptions: { teder: describe(s, today) }, providerReady });
  assert.doesNotMatch(page({ ...S, monthly: 790, paid_until: '2026-11-21' }, '2026-10-22', false), /החיוב הבא/);
  const first = page({ ...S, monthly: 790, paid_until: '2026-11-21' }, '2026-10-22');
  assert.match(first, /<progress max="31" value="1" aria-label="החודש ששולם, מ-22\.10\.2026 עד 21\.11\.2026" aria-valuetext="יום 1 מתוך 31\. נשארו 31 ימים בחודש ששולם"><\/progress>/);
  assert.match(first, /<span>נשארו 31 ימים בחודש ששולם<\/span><span class="muted">יום 1 מתוך 31<\/span>/);
  assert.match(first, /החיוב הבא: 790 ₪ ועוד מע״מ, ב-22\.11\.2026/);
  assert.match(page({ ...S, paid_until: '2026-11-21' }, '2026-11-21'), /<progress max="31" value="31"[^>]*aria-valuetext="יום 31 מתוך 31\. זה היום האחרון בחודש ששולם"/);

  const due = page({ ...S, paid_until: '2026-11-21' }, '2026-11-25');
  assert.doesNotMatch(due, /<progress/);
  assert.match(due, /<span class="tag">מחכה לתשלום<\/span>[^]*התשלום לחודש שהתחיל ב-22\.11\.2026 עוד לא הגיע אלינו/);
  const ended = page({ ...S, paid_until: '2026-11-21', ends_on: '2026-11-21' }, '2026-11-25');
  assert.doesNotMatch(ended, /<progress/);
  assert.match(ended, /המנוי הסתיים ב-21\.11\.2026\./);
  assert.doesNotMatch(page(S, '2026-10-22'), /<progress/, 'nothing paid yet');

  // Ending: the days left said once, in the warning, then the bar of the last month.
  const ending = page({ ...S, paid_until: '2026-11-21', ends_on: '2026-11-21' }, '2026-11-12');
  assert.match(ending, /class="card sub s-ending"[^]*המנוי מסתיים ב-21\.11\.2026\. נשארו 10 ימים\.[^]*<progress max="31" value="22"/);
  assert.doesNotMatch(ending, /נשארו 10 ימים בחודש ששולם<\/span>/);
});

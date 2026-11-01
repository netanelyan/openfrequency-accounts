# Paying over WhatsApp: /internal/pay

Payment is a manual bank transfer (`OF_PAYMENT=manual`, the owner's details in
`OF_PAYMENT_METHOD`). Paying over WhatsApp makes it one button for the customer: our bot Toran
answers with the exact amount and the transfer details, takes the picture of the transfer, and
hands it to us; the operator checks the bank and records the payment with one press. **Toran
never records a payment, and nothing here moves money: only the operator's press records one.**
This file is accounts' half; the contract both sides are held to is
[`docs/contracts/pay.json`](contracts/pay.json).

## The flow

1. The customer presses "לתשלום בוואטסאפ" on `/setup`'s payment card, or in the welcome email or
   a billing email (a week before, a day before, the day it falls due). It opens
   `https://wa.me/<OF_ASSISTANT_WA>?text=...` with this written:
   `היי, אני רוצה לשלם על המנוי של <business>. PAY-XXXXXX`. The code rides at the end of the
   message; nothing on the page or in the email explains it.
2. Toran reads `PAY-XXXXXX` from the message and asks `GET /internal/pay?code=PAY-XXXXXX`. It
   answers the customer with the amount (`total`, VAT included), what it is for (`summary`) and
   how to pay (`payHow`).
3. The customer sends a screenshot or a PDF of the transfer. Toran posts it to
   `POST /internal/pay/receipt` with the code and the number that sent it.
4. We keep it with what was owed at that moment, and email every address in
   `OF_SIGNUP_NOTIFY` "אישור העברה מ״<business>״" with one button, "לבדוק ולאשר", to
   `https://<PUBLIC_HOST>/admin/receipts/<id>`.
5. On that page the operator sees the picture, checks the bank, and presses "התשלום הגיע" (a
   month recorded for each product it was for, exactly as the console's "התקבל תשלום לחודש",
   and each owner gets "קיבלנו את התשלום על <product>") or "לא הגיע" (nothing recorded).

## When it is on

Only in manual mode with **both** `OF_PAYMENT_METHOD` and `OF_ASSISTANT_WA` set, and only while
something is owed. Otherwise every page and email says exactly what it said before (the receipt
button to `OF_SUPPORT_WA`, or the questions button), and no code is made. The service's log says
"Paying over WhatsApp: on" when it is.

| Where | With both settings, while something is owed |
|---|---|
| `/setup`'s payment card | The one blue button is "לתשלום בוואטסאפ" (in place of "לשלוח אסמכתא בוואטסאפ"); "איך משלמים: <OF_PAYMENT_METHOD>" stays; under it, in place of the receipt's line, "לוחצים על הכפתור ושולחים את ההודעה כמו שהיא. תורן עונה בוואטסאפ עם הסכום ופרטי ההעברה." In view-as, the same card without its button, and no code is made. |
| The welcome email | The details, that line, then the button "לתשלום בוואטסאפ", before the setup's button. |
| The billing emails, soon7, soon1, due | The details, that line, and the email's button is "לתשלום בוואטסאפ". "stopped" still leads to the account. |

In the HTML part the WhatsApp address is not printed under its button (it would show the
message's words, encoded); the text part has it, as it has every link.

## What is owed

One function answers it for the card and for Toran: `amountDue()` in `src/accounts/billing.js`
(`dueOf()`, pure, is what `/setup`'s card renders from). For each product turned on:
complimentary, nothing; in its 14 days of grace (`due`), a month; paid for today (cancelled ones
too, until their last day), nothing; no price recorded, nothing; anything else (never paid, or the
grace is over), a month and, until the first payment, the setup fee. VAT is added to each price
recorded without it and rounded to the agora (`payTotal()`).

Toran is told one thing more than the card shows: **when nothing is owed today, a month that falls
due within 7 days** (`PAY_AHEAD_DAYS`). That is what the billing emails a week and a day before
ask for, so their button leads to that month and not to "nothing to pay". The card shows today's
answer, so whenever the card has a button, Toran's amount is the card's.

## The code

`PAY-` and six of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, O, 1, I or L), from
`crypto.randomInt`, one table row per code (`pay_codes`). It names the workspace for that
conversation and nothing more: it signs nobody in, it is not used up, and someone who has it
learns only the business's name and what it owes. So it is stored as it is, lives 60 days, and a
page or an email takes the workspace's live code while 14 days or more are left on it, else makes
a new one. Toran may pass it in any letter case. A code of a disabled or deleted workspace is
unknown. Codes are never written to the audit log.

## The request

```
GET  http://127.0.0.1:4741/internal/pay?code=PAY-ABC234
POST http://127.0.0.1:4741/internal/pay/receipt
Authorization: Bearer <OF_INTERNAL_TOKEN>
```

The same listener and locks as every internal route ([internal-session.md](internal-session.md)):
127.0.0.1 only, never proxied, a loopback socket and Host, `OF_INTERNAL_TOKEN` (32 characters or
more; `503 not_configured` while it is unset or short). Any other method is `405`. Every answer
is JSON with `Cache-Control: no-store`.

### GET /internal/pay

`200`:

```json
{
  "code": "PAY-ABC234",
  "expiresAt": "2026-12-21T10:00:00.000Z",
  "workspace": { "id": 3, "name": "Dana Shop" },
  "items": [
    { "product": "teder", "productName": "תדר", "plan": "small", "monthly": 490, "setup": 990,
      "net": 1480, "total": 1746.4, "firstMonth": true }
  ],
  "net": 1480,
  "vat": 266.4,
  "total": 1746.4,
  "vatIncluded": false,
  "summary": [
    "תדר, החבילה הקטנה: 490 ₪ לחודש, לא כולל מע״מ, ודמי הקמה של 990 ₪ פעם אחת.",
    "סך הכול לתשלום עכשיו: 1,746.40 ₪, כולל מע״מ (1,480 ₪ ועוד 266.40 ₪ מע״מ)."
  ],
  "payHow": "העברה בנקאית לחשבון 12-345-678901",
  "paidThrough": null
}
```

| Field | Meaning |
|---|---|
| `items` | Each product to pay for now. `monthly` and `setup` in ₪ as recorded (`setup` is 0 unless it is the first payment, `firstMonth`), `net` the two together, `total` that with VAT. `plan` is Teder's (`full` or `small`), `null` for Toran. `[]` when nothing is owed. |
| `net`, `vat`, `total` | The payment: `total` with VAT, what the customer transfers; `net` the part recorded before VAT and `vat` the VAT on it (0 when every price already includes it). All 0 with nothing owed. |
| `vatIncluded` | True when every price in it was recorded with VAT in it. |
| `summary` | Hebrew lines to tell the customer: one per item, as `/setup` lists it (a month ahead ends ", על החודש שמתחיל ב-22.11.2026."), then the total. `[]` when nothing is owed. |
| `payHow` | `OF_PAYMENT_METHOD`, or `null` while it is unset. |
| `paidThrough` | With nothing owed, the earliest day a product is paid until, `YYYY-MM-DD` (an Israel calendar day, not an instant as in `/internal/entitlement`); `null` when something is owed, or nothing was ever paid (complimentary). |

`404 {"error":"unknown_code"}` for a code we do not have (or one of a disabled or deleted
workspace), `410 {"error":"expired"}` once its 60 days are over.

### POST /internal/pay/receipt

```json
{ "code": "PAY-ABC234", "phone": "972500000123",
  "file": { "name": "IMG-20261101-WA0003.jpg", "type": "image/jpeg", "data": "<base64>" } }
```

- `phone`: the number that sent the picture, international digits (8 to 15, no `+`, no leading 0).
- `file.data`: the file in base64. At most 5 MB once decoded; the body at most 7,500,000 bytes.
- `file.type`: `image/jpeg` (`image/jpg` is taken as it), `image/png`, `image/webp` or
  `application/pdf`, and the file's first bytes must be that type (JPEG `FF D8 FF`, PNG's
  signature, `RIFF....WEBP`, `%PDF-`).
- `file.name`: optional, kept for the operator, without control or bidi characters, quotes,
  slashes or angle brackets, at most 120 characters.

`201 {"id": 7, "workspace": {"id": 3, "name": "Dana Shop"}}`: kept, with what was owed at that
moment, in the audit log (`pay_receipt_received`: the receipt, phone, type, size and total, never
the code), and the operator emailed. Refused, and nothing kept: `400 bad_phone`; `400 bad` (no
`file` object, `data` not base64, or the body not a JSON object); `404 unknown_code`; `410
expired`; `413 too_large`; `415 bad_type`; `429 rate_limited` for a sixth receipt from one code in
an Israel day (it opens again at midnight, Israel time). The checks run in that order, after the
token.

## The operator's side

- `/admin` shows "אישורי העברה שמחכים" above the day's numbers while any receipt is undecided,
  newest first: the business, what was owed when it came, when, each a link to its page.
- `/admin/receipts/<id>`: the picture (a PDF as a link), the business, the number it came from,
  when; what was owed when it came and what is owed today; a warning for each product paid for
  since it came; then "התשלום הגיע" and "לא הגיע", side by side.
- `/admin/receipts/<id>/file`: the file as it came, `Content-Type` its checked type, `inline`,
  `nosniff`, `no-store`, `default-src 'none'`.
- All three are the superadmin's only (anyone else is sent to `/admin/login`, a POST is `403`),
  and the two buttons need the CSRF token, as every form here.
- "התשלום הגיע" (`POST /admin/receipts/<id>/paid`) records a month (`payMonth()`) for each product
  that was owed when the receipt came (when none was, for what is owed now), each guarded by the
  paid-until day the page showed (`expect_<product>`), all in one transaction: if one was
  recorded meanwhile (the console's button, another receipt, a page left open), nothing is
  recorded and the page says "התשלום הזה כבר נרשם". A receipt is decided once; pressing again
  changes nothing. Audit: `pay_receipt_paid` (with the days recorded) and `subscription_paid`.
- "לא הגיע" (`POST /admin/receipts/<id>/not-paid`) closes it and records nothing. Audit:
  `pay_receipt_not_paid`.

## The tables

```
pay_codes     code PK (PAY-XXXXXX), workspace_id, created_at, expires_at
pay_receipts  id PK, workspace_id, code, phone, created_at, name, type, size, file (BLOB, NULL once deleted),
              items_json (amountDue() when it came), decided_at, decided_by, decision ('paid' | 'not_paid' | NULL)
```

Migration 9 (`src/db/schema.js`).

## Retention

Run by the daily jobs (`src/web/daily.js`, `RETENTION`):

- a payment code: deleted 30 days after it ended (`linkDays`), like the other links and codes;
- a receipt's file: deleted 90 days after it came (`receiptFileDays`); its row stays (who sent it,
  when, what was owed, the operator's answer), as the record of the payment, and its page says
  the file was deleted;
- a deleted workspace takes its codes and receipts, rows and files, with it
  (`src/accounts/erase.js`). The invoices stay, as before.

## For the website's privacy policy

Not edited from here (`openfrequency-web` is its own repository). What this adds, for the
"what we keep" part of `https://openfrequency.co.il/privacy`, in the site's words:

> **צילום של העברה בנקאית.** כשמשלמים על המנוי בוואטסאפ, אפשר לשלוח לתורן צילום מסך או קובץ
> PDF של ההעברה. אנחנו שומרים אותו כדי לבדוק מול הבנק שהכסף הגיע ולרשום את התשלום, ורק אנחנו
> רואים אותו. את הקובץ עצמו אנחנו מוחקים 90 יום אחרי שהגיע. נשאר אצלנו רישום של התשלום: מאיזה
> מספר וואטסאפ הוא נשלח, מתי, על איזה סכום, ואם התשלום הגיע. כשמוחקים את החשבון, נמחקים איתו
> גם הקובץ וגם הרישום. ההודעה עוברת דרך וואטסאפ של Meta, כמו כל הודעה אחרת שנשלחת אלינו
> בוואטסאפ.

UNVERIFIED, for whoever words the policy: what Toran itself keeps of the picture after it posts
it here (Toran's side), and where the server stands.

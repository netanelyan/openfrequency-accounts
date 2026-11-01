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
- `check`: optional, what Toran read on the picture:
  `{ readable, isTransfer, amount: { seen, expected, verdict }, date: { seen, verdict },
  account: { seen, verdict }, payeeName, reference }`. `readable` and `isTransfer` are booleans,
  `amount.seen` and `amount.expected` numbers (₪), the rest strings; `amount.verdict` is `ok`,
  `mismatch` or `unknown`, `date.verdict` `ok`, `too_old`, `future` or `unknown`,
  `account.verdict` `ok`, `mismatch` or `unknown`. Unknown keys are dropped, and so is a value of
  the wrong type or a verdict outside its list; every string loses its control and bidi
  characters and is cut to 80 characters (`checkOf()` in `src/accounts/pay.js`). It is never a
  reason to refuse the receipt, and it decides nothing: the operator sees it as text (below).

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
  when; what Toran read on it, as plain escaped lines ("הסכום בצילום: 1,700 ₪ (לא תואם, צריך
  1,746.40 ₪)", "התאריך בצילום: 21.10.2026 (תקין)", "החשבון שהועבר אליו: מסתיים ב-6789 (תואם)",
  the payee and the reference as they were on the picture, never in a link), and always "בדקו
  בבנק שההעברה הגיעה לפני שמאשרים."; what was owed when it came and what is owed today; a warning
  for each product paid for since it came; then "התשלום הגיע" and "לא הגיע", side by side. The
  operator's email has the same lines.
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

## The invoice-receipt in Morning

With Morning's keys set, "התשלום הגיע" also issues a חשבונית מס/קבלה (document type 320) in
Morning (Green Invoice), which Morning emails to the business's owners with its PDF
(`src/accounts/morning.js`; Morning's API as its documents at developers.morning.co described it
on 2026-11-01). **The payment is recorded first, always**: an invoice that cannot be issued never
undoes or holds it, and the receipt's page then says why and offers "להפיק חשבונית שוב"
(`POST /admin/receipts/<id>/invoice`).

| Setting | What it does |
|---|---|
| `OF_MORNING_CLIENT_ID`, `OF_MORNING_CLIENT_SECRET` | The business's API keys in Morning. Both set, it is on; either unset, it is off, the payment is recorded as before, and the receipt's page says "החשבונית לא הופקה אוטומטית: Morning לא מחובר". The secret is in `SECRET_KEYS` (check:public refuses it with a value in a tracked file). |
| `OF_MORNING_ENV` | `production` (empty means production) or `sandbox`. Anything else keeps it off, and the log says so. |

Getting the keys: in Morning, the business's API keys are made in its settings, under the
developers' tools (the API documentation points to Morning's Hebrew help page on making them).
The business's plan must include API access: without it the token is refused
(`unauthorized_client`), and the page says so. UNVERIFIED: the menu's exact names in Morning
today, and that the business's plan has API access.

What happens, in order:

1. **The token.** `POST https://api.morning.co/idp/v1/oauth/token` (sandbox
   `https://api.sandbox.morning.dev/idp/v1/oauth/token`), JSON
   `{ grant_type: "client_credentials", client_id, client_secret }`; the answer
   `{ accessToken, tokenType: "Bearer", expiresAt }` (unix seconds) lasts an hour and is kept in
   memory until 60 seconds before it ends. A 401 from the API forgets it. The secret and the token
   are never logged, stored, put in an error, a page or an email.
2. **The business.** `GET https://api.greeninvoice.co.il/api/v1/documents/info?type=320` (sandbox
   `https://sandbox.d.greeninvoice.co.il/api/v1`). When it says `exemption: true` while VAT was
   added to the price, or a `vatRate` other than ours (0.18; 18 is read as percent), or no rate,
   nothing is issued: the page says what to fix in Morning, and the audit log has
   `morning_blocked`.
3. **The document.** `POST /documents`:

   ```json
   { "type": 320, "lang": "he", "currency": "ILS", "vatType": 0, "date": "2026-10-22",
     "description": "מנוי תדר",
     "client": { "name": "Noa Shop", "emails": ["noa@example.com"], "add": true },
     "income": [
       { "description": "מנוי תדר, החבילה הקטנה, 22.10.2026 עד 21.11.2026", "quantity": 1, "price": 490, "currency": "ILS", "vatType": 0 },
       { "description": "דמי הקמה, תדר, החבילה הקטנה", "quantity": 1, "price": 990, "currency": "ILS", "vatType": 0 } ],
     "payment": [ { "date": "2026-10-22", "type": 4, "price": 1746.4, "currency": "ILS" } ],
     "attachment": true, "emailContent": "קיבלנו את התשלום על המנוי, והחשבונית מצורפת." }
   ```

   A row for each month recorded (its product, plan and the days payMonth() gave it), a row for a
   setup fee, each price as the customer was asked, `vatType` 0 when VAT is added to it and 1 when
   it is in it; one payment, a bank transfer (type 4), of the total the customer was asked to pay.
   It is built from what "התשלום הגיע" recorded (`bill_json`), so a retry asks for the same
   document. The client's name is the workspace's name (accounts keeps no other name for
   invoices), its addresses the workspace's owners'.
4. **The copy.** The answer `{ id, number, url: { he, origin } }` is written to the receipt at once
   (`morning_doc_id`, `morning_doc_number`, `morning_url`; audit `morning_issued`). Its PDF is
   fetched from `url.origin`, then `url.he`, each first without the token and then with it, the
   token only to Morning's own hosts (`greeninvoice.co.il`, `morning.co`, `morning.dev`); a PDF of
   5 MB or less goes into `invoices` (number, the day, the first product and its days, the amount
   before VAT and the VAT) and so onto the customer's home page. When no link gives a PDF, only the
   link is kept, and the page shows it.

**Never two documents for one receipt.** Before anything is asked, one UPDATE claims the receipt
(`morning_state = 'issuing'`), and only a receipt marked paid, with no document and no request out,
passes it: a double press, a second retry while one is out, or a retry after it was issued asks
Morning nothing. A request out for more than 10 minutes (the process stopped mid-way) may be
retried, and the page says to look in Morning first; so does a timeout while the document was being
asked for, since Morning may have made it.

A failure (no answer in 15 seconds, a status that is not 2xx, an error code) is shown on the
receipt's page with Morning's code and its own words (escaped): 1006, the Morning subscription needs
renewing; 1010, a duplicate request; 1012, a higher plan is needed; 1018 and 1019, the client's
email; `invalid_client` or `invalid_grant`, the keys; `unauthorized_client`, a plan without the API;
`timeout`, `unreachable`. Audit: `morning_failed` (the code, the status and the step). UNVERIFIED
until the first live run: the error body's field names (`errorCode` and `errorMessage` are read,
then `code`, `error` and `message`), whether `vatRate` comes as 0.18 or 18 (both are read), and
whether the PDF links need the token (both ways are tried).

## The tables

```
pay_codes     code PK (PAY-XXXXXX), workspace_id, created_at, expires_at
pay_receipts  id PK, workspace_id, code, phone, created_at, name, type, size, file (BLOB, NULL once deleted),
              items_json (amountDue() when it came), decided_at, decided_by, decision ('paid' | 'not_paid' | NULL),
              check_json (what Toran read), bill_json (what "התשלום הגיע" recorded), morning_state
              ('issuing' | 'issued' | 'failed' | 'blocked'), morning_at, morning_error_json, morning_doc_id (unique),
              morning_doc_number, morning_url, invoice_id
```

Migrations 9 and 10 (`src/db/schema.js`).

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
it here (Toran's side), where the server stands, and whether the policy already names Morning as
the invoicing service (it now gets the business's name and its owners' addresses for each
invoice-receipt).

# Sign-up and the setup page

A business can open its own account at `/signup`, and every customer has one page, `/setup`,
that lists what is left before their products work, the payment first. This is the contract Teder
and Toran answer for that page, the paywall they ask (`GET /internal/entitlement`), the product
emails they send through us (`POST /internal/notify`), the route they answer when a workspace is
deleted, and the settings that turn each part on.

## The settings

| Variable | Default | What it does |
|---|---|---|
| `OF_SIGNUP` | unset | `1` opens `/signup`. Anything else: `/signup` says "ההרשמה תיפתח בקרוב" with a link to `https://openfrequency.co.il/join`, and every POST to it is refused (403). |
| `OF_SIGNUP_PRODUCTS` | `teder,toran` | The products `/signup` offers, comma-separated, unknown names ignored. One left out shows as "בקרוב" with its box off and is refused, by the form and through Google; with one product open, it starts chosen. The console opens any product either way. |
| `OF_SIGNUP_NOTIFY` | unset | Comma-separated addresses that get a short email on each confirmed sign-up, each online cancellation (and its undo), each deleted workspace, each payment that did not come on its day and each grace that ended (src/web/daily.js), and the workspaces deleted for being unused. Unset, no notice: this is how the operator hears of a new customer. |
| `OF_SIGNUP_DAILY_EMAILS` | `200` | The most sign-up emails `/signup` sends in a day, from every address together. Past it the form answers 429 ("עצרנו אותם עד מחר") and the log says so. |
| `OF_PAYMENT_METHOD` | unset | How payment works until a provider is connected, in plain Hebrew ("העברה בנקאית או ביט"). Set, `/setup`, the welcome email and the billing emails say "איך משלמים: ...". |
| `OF_TEDER_INTERNAL` | `http://127.0.0.1:4700` | Where `/setup` reaches Teder's internal routes, and where a deleted workspace's data is deleted. |
| `OF_TORAN_INTERNAL` | `http://127.0.0.1:4710` | Where `/setup` reaches Toran's (the same address `/admin` uses), and the same for deleting. |
| `OF_INTERNAL_TOKEN` | unset | The bearer token for both directions. Unset or shorter than 32 characters, no product is asked (each says "לא הצלחנו לבדוק כרגע", and deleting a workspace stops), and our internal routes answer 503. |
| `OF_BILLING_PROVIDER` | unset | The payment hook. Unset, `billingReady()` is false: the payment step says the online payment opens soon and leads to us, and the home page shows no next charge. |
| `OF_SUPPORT_WA` | unset | Our WhatsApp, where the payment step's button leads while there is no provider. Unset, it leads to an email to `MAIL_REPLY_TO`, and without that to `https://openfrequency.co.il/join`. |

## Sign-up

The form asks for the full name (2 to 80 characters), the business's name (2 to 80), the
products (Toran, Teder or both, at least one), Teder's plan (the full one, 790 ₪ a month and
1,490 ₪ setup for 40 slideshows and 10 redos, or the small one, 490 ₪ and 990 ₪ for 15 and 4;
`PLANS` in `src/accounts/subscriptions.js`; the website's `?plan=small` starts it chosen), the
terms and the privacy policy accepted
(`https://openfrequency.co.il/terms` and `/privacy`), and the email. The acceptance is kept on
the user and on the workspace (`terms_version`, `terms_accepted_at`); the version is the date
the website's legal pages were last updated, `TERMS_VERSION` in `src/accounts/signup.js`.

1. The answers wait in `signups` and the address gets an email with a link to
   `/signup/confirm`: one use, 15 minutes, and a button before it does anything (mail scanners
   open links), like a magic link. The token exists only in the email; the row keeps its SHA-256.
2. Pressing the button opens, in one transaction: the user, the workspace with only the products
   chosen, each with its subscription at the list price (of the plan chosen) and nothing paid yet (the console's own
   path, `openWorkspace()`), and the user as its `client_owner`. No invite is sent. The browser
   is signed in and goes to `/setup`.
3. **An address that already has an account** never gets a second workspace: the form sends it a
   sign-in link instead and shows the same page, so the page never says who has an account. If
   the address gets an account between the form and the link, the link opens nothing and says so.
4. **Continue with Google** (while `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set) is a
   second button of the same form. The answers wait in `signups` under a token kept in the signed
   Google flow cookie, never in a URL, and the address is the one Google verified. A Google
   account or an address that is already a customer's signs them in to that account and opens
   nothing; the superadmin's or a disabled account's opens nothing at all.

Protections: the CSRF token and Origin check of every form; 3 sign-ups an address in 15 minutes
(10 a day) and 5 an IP in an hour (20 a day), an IPv6 address counted by its /64, in memory like
the other limits; at most `OF_SIGNUP_DAILY_EMAILS` (200) sign-up emails a day from every address
together; nothing typed into the form in the confirmation email (the business's name shows on the
page its link opens), so the form cannot carry anyone's words to a stranger; a honeypot field
that a person never sees (filled, the page looks the same and nothing is kept or sent); the
address checked like the login's. Each sign-up is in the audit log (`signup_requested`,
`signed_up`), which the console shows.

**The owner's notice.** Each address in `OF_SIGNUP_NOTIFY` gets one email when a sign-up is
confirmed (by the link or by Google), after its transaction has committed: subject "הרשמה חדשה:
<business>", then the person's name and email, the business, the products, the time (Israel), how
it was confirmed, and a link to the workspace on `/admin/accounts`. What the customer typed is
put on one line (no control characters or bidi overrides) and escaped in the HTML part. Nothing
is sent for the form alone, a closed sign-up, the honeypot, a form past the limits, or an address
that already has an account. A notice that fails to send is logged and never holds up the sign-up.

Right after the confirmation (by the link or by Google) the customer gets a **welcome email**:
the account is open, the payment comes first (with each product's price before VAT and its setup
fee; without a provider, "answer this email and we send the payment details"), then the setup,
with a button to `/setup`.

Payment is not taken here. The subscription starts unpaid (the console's "open": on, no payment
recorded), and a new sign-up is never complimentary, so its products stay behind the paywall
(below) until a payment is recorded. `src/accounts/billing.js` has the hooks a card-clearing
provider will plug into: `billingReady(env)` and `checkoutUrl()`, which is null until a provider
is connected.

## /setup

For a signed-in customer in a workspace (the superadmin sees it only in view-as, read-only, with
no buttons). It asks each product the workspace has **turned on** for its checklist, all at once,
each for at most 3 seconds. A product that is not turned on is never asked and never shown.

```
GET <OF_TEDER_INTERNAL or OF_TORAN_INTERNAL>/internal/setup?workspace=<workspace id>
Authorization: Bearer <OF_INTERNAL_TOKEN>
Accept: application/json
```

### The answer

`200` with JSON, 64 KB at most:

```json
{
  "product": "toran",
  "ready": false,
  "steps": [
    {
      "key": "store",
      "title": "כתבו את כתובת האתר של החנות",
      "status": "todo",
      "detail": "תורן לומד ממנה מה לענות.",
      "href": "https://toran.openfrequency.co.il/settings",
      "required": true
    }
  ]
}
```

| Field | Type | Rules |
|---|---|---|
| `product` | string | The product asked: `"toran"` or `"teder"`. |
| `ready` | boolean | Whether the product works for this workspace now. |
| `steps` | array | At most 30, in the order to show them. |
| `key` | string | 1 to 60 of `A-Z a-z 0-9 _ . : -`, unique in the answer. |
| `title` | string | Not empty; plain text, up to 200 characters are shown. |
| `status` | string | `todo`, `working` (בתהליך), `done` (✓), `attention` (צריך תשומת לב) or `soon` (בקרוב). |
| `detail` | string or null | Optional; plain text, up to 500 characters. |
| `href` | string or null | Where the step is done. See below. |
| `required` | boolean | Required steps are listed first; the others under "אפשר גם". |

The answer is checked strictly: anything that does not fit (not JSON, another status code, the
wrong product, a missing or mistyped field, an unknown status, two steps with one key, more than
30 steps, more than 64 KB) and the whole answer is not used. The page then says "לא הצלחנו לבדוק
כרגע" with a link to the product, exactly as when the product is down or slow. Nothing from the
answer is rendered as HTML: every word is escaped.

`href` is shown as a button ("להתחיל" for `todo`, "לפתוח" for `working` and `attention`) when the
step is not `done` or `soon`. It is kept only when it is `https` on `openfrequency.co.il` or one
of its subdomains, or on the address the product is configured at (`TEDER_URL`, `TORAN_URL`,
`http://localhost:...` in development), with no user name or password in it. A path that starts
with `/` is taken as on the product's own address. Anything else (`javascript:`, `data:`, another
site) is dropped and the step has no button.

### What the page and the landing do with it

- Payment comes first, and it is required: `todo` until every product the workspace has on is
  allowed by the paywall (paid for, or complimentary), then `done`. It lists each product's price
  as recorded on its subscription (before VAT, with the setup fee until the first payment), or
  the day it is paid until. With no provider (`billingReady()` false) it says the online payment
  opens soon and its button reaches us: our WhatsApp (`OF_SUPPORT_WA`, with "רוצים לשלם על המנוי"
  written) or, unset, `https://openfrequency.co.il/join`. Once a provider is connected and
  `checkoutUrl()` gives a page, the button goes there.
- A product that is not allowed yet is **locked**: its steps are shown (asked of the product as
  usual), with "נפתח אחרי התשלום" and no buttons; a step it already reports done stays done.
- The count at the top ("3 מתוך 5 צעדים") is the steps done out of every step there is, payment
  included: a `soon` step is not counted, nor are the steps of a product that did not answer.
- A product's checklist is finished when it is allowed, says `ready: true`, and every required
  step is `done`.
- After a customer signs in (link, Google, or opening `/login` already signed in), and only when
  there is no `?next=`: while payment is not in, or a product that answered is not finished, they
  land on `/setup`; otherwise on the home page. A product that does not answer is never a reason
  to land on `/setup`.
- The home page shows a "הגדרת החשבון" card while setup is not finished, and a "הגדרה" link at
  the top until every product has said it is. A product that is not allowed has "להסדיר תשלום"
  on its card instead of the way into it. Each card says its status in plain words (פעיל, עוד לא
  שולם, מחכה לתשלום, בוטל, ללא תשלום, מסתיים, הסתיים), the price, the setup fee until the first
  payment, the day it is paid until, and the next charge once a provider is connected.

## The plans

Teder has two plans (`PLANS` in `src/accounts/subscriptions.js`, migration 8): `full` (40 slideshows
and 10 redos a month, 790 ₪ and 1,490 ₪ setup) and `small` (15 and 4, 490 ₪ and 990 ₪), before
VAT. A subscription keeps its plan in `subscriptions.plan`; every Teder subscription before
migration 8 is `full`. The entitlement tells Teder the plan's numbers, and Teder counts the month
for the whole workspace. The home page and `/setup` name the plan ("תדר, החבילה הקטנה"), and so
do the welcome email and the confirmation page. On `/admin/accounts` the superadmin changes the
plan in the subscription's form: a price still at the old plan's list price moves to the new
one's, a price agreed by hand stays. Toran has no plans here.

## The paywall

The product is sold behind a paywall: a workspace uses a product only while it is **allowed**.
There is no payment provider yet, so "paid" is what the superadmin records on `/admin/accounts`:
"התקבל תשלום לחודש" moves the subscription's last paid day (`paid_until`) a month on (from the
last paid day, or from today when that has passed), and the date can be edited by hand in the same
form. The console shows each product's access ("גישה: שולם, פתוח, עד 21.11.2026") and a button
that marks it complimentary or takes that back (`comp_set`, `comp_cleared` in the audit log).

| `access` | When | `allowed` |
|---|---|---|
| `off` | The product is not on for the workspace, or the workspace is disabled or deleted. | false |
| `comp` | The superadmin marked the product complimentary (free). | true |
| `cancelled` | The customer cancelled online, or the superadmin set a last day. | until the last day paid for (and the last day, if that is earlier), then false. No grace. |
| `paid` | A recorded payment covers today (`paid_until` is today or later). | true |
| `due` | The last paid period is over and the next payment has not come: the 14 days of grace the terms give, from the day it fell due (the day after `paid_until`) to 14 days after it. The owners are emailed a week before, the day before and on that day, and when it ends (src/web/daily.js). | true |
| `unpaid` | Anything else: on, nothing paid for today (never paid, or the grace is over). | false |

They are checked in that order. Days are Israel calendar days.

**Migration 7** marked every workspace that existed before it complimentary, for each product it
had on at that moment: those were set up by hand (the owner's own and the first customers), and
nothing that worked stops. A workspace opened after it, by sign-up or by the console, and a
product turned on after it, is not complimentary until the superadmin says so.

### GET /internal/entitlement

On the internal listener (127.0.0.1:4741), with its four locks (loopback socket, loopback Host,
never proxied, `OF_INTERNAL_TOKEN` as a bearer token).

```
GET http://127.0.0.1:4741/internal/entitlement?workspace=<id>&product=<teder|toran>
Authorization: Bearer <OF_INTERNAL_TOKEN>
```

`200`, never cached:

```json
{ "workspace": 7, "product": "teder", "enabled": true, "access": "paid", "allowed": true,
  "paidThrough": "2026-11-21T21:59:59.999Z", "cancelAt": null, "graceUntil": null,
  "plan": { "name": "small", "slideshows": 15, "redos": 4 } }
```

The same, field by field, with an example for every status, is `docs/contracts/entitlement.json`.

| Field | Meaning |
|---|---|
| `enabled` | The product is on and the workspace is neither disabled nor deleted. |
| `access`, `allowed` | The table above. Decide on `allowed`; `access` says why. |
| `paidThrough` | The end of the last day paid for, Israel time, as an ISO instant in UTC (the last millisecond of that day), or `null` when nothing was ever paid. It is given whatever the access, so it can be in the past. |
| `cancelAt` | Set only while `access` is `cancelled`: the end of the last day it works, the same way. Otherwise `null`. |
| `graceUntil` | Set only while `access` is `due`: the end of the grace's last day, the same way. Otherwise `null`. |
| `plan` | Teder only: its plan, `{ name: "full" \| "small", slideshows, redos }` (40 and 10, or 15 and 4), the month Teder counts for the whole workspace. The full plan when none is recorded. Toran's answer has no `plan`. |

`400 {"error":"bad_workspace"}` for a workspace that is not a positive integer, `400
{"error":"bad_product"}` for a missing or unknown product, `404 {"error":"no_workspace"}` for an
id we never had (a deleted workspace is `200` with `off`), `401` without the token, `503` while
the token is unset or short here, `405` for any other method.

### The payment button

"התקבל תשלום לחודש" sends the paid-until date the console showed with it. When the subscription
has moved on since (the button pressed twice, or the page left open after a payment), nothing is
recorded and the console says so ("התשלום הזה כבר נרשם"). Each owner gets "קיבלנו את התשלום על
<product>" with the day it is now paid until.

### The daily jobs

`src/web/daily.js` runs once an Israel day from 09:00 (`npm run daily` by hand, `-- --again` to
run today's again) and keeps each run in `daily_runs`:

- **Billing** (each owner, once of each kind for each paid period, kept in `billing_notices`): a
  week before the payment falls due, the day before, on the day (this is the notice the terms
  speak of; the product works 14 more days), and when the grace ends. `OF_SIGNUP_NOTIFY` hears of
  the last two. Not for a product that is complimentary, cancelled, off or never paid, nor in a
  disabled workspace.
- **Retention**, the periods the privacy policy states: a sign-up never confirmed, 30 days after
  the form; magic links, invites and WhatsApp link codes, 30 days after they ended; sessions, 90
  days after they expired or were signed out; the notification log, 90 days. A workspace never
  paid for, not complimentary, with no invoice, that nobody in it has signed in to or used for six
  months: its owners are emailed ("החשבון של <business> יימחק ב-14 הימים הקרובים"), and 14 days
  later it is deleted the same way an owner deletes it (every product asked first; a product that
  fails holds it to the next day), and `OF_SIGNUP_NOTIFY` gets the list. A sign-in, a payment or
  comp before then takes it off the list (`retention_notices`). Kept on purpose: invoices (the tax
  law) and the audit log.

## Cancelling online

On the home page, each product an owner pays for (or has not paid yet) has "לבטל את המנוי". It
opens a confirmation page (`GET /subscription/<product>/cancel`): it keeps working to the last day
paid for, then stops, and nothing more is charged (with nothing paid for today, it stops today);
it can be taken back until then; no data is deleted. Confirming (`POST`) sets `cancelled_at` and
the last day (`ends_on`), so the entitlement says `cancelled` with its `cancelAt`. Each owner of
the workspace gets an email confirming it, and every address in `OF_SIGNUP_NOTIFY` a notice
("ביטול מנוי: <business>, <product>"). Until the last day the card says "בוטל" and offers
"להמשיך את המנוי" (`POST /subscription/<product>/resume`), which clears both; the owner hears of
that too. Members see neither button; a complimentary product has nothing to cancel; the
superadmin's view-as changes nothing. Clearing the last day on `/admin` also undoes a
cancellation.

## Deleting a workspace

An owner opens `/account/delete` (linked under "הפרטים שלכם"): it says it is permanent, what is
deleted and what is kept, and asks for the business's name (spaces and letter case not counted).
The superadmin can do the same from each workspace on `/admin/accounts`. Then:

1. Each product the workspace has ever had (on or off, or with a subscription) is asked, in
   parallel, for at most 10 seconds:

   ```
   POST <OF_TEDER_INTERNAL or OF_TORAN_INTERNAL>/internal/workspaces/<workspace id>/delete
   Authorization: Bearer <OF_INTERNAL_TOKEN>
   Content-Type: application/json

   {}
   ```

   Any `2xx` means deleted, or nothing of the workspace was there. Anything else (`404` included,
   another status, no answer, no token configured) stops everything: nothing is deleted here, the
   page says which product did not answer and to try again, and the audit log has
   `workspace_delete_failed`. A `404` is a product without the route, never "nothing there": taken
   that way, that product's data would stay while ours is gone. So a product's route answers
   `200` for a workspace it never saw, and again for one it already deleted
   (`docs/contracts/workspaces-delete.json`).
2. Then ours, in one transaction: the memberships, the invites, the products and subscriptions,
   the WhatsApp numbers and link codes, the notification choices and log, the sign-up that opened
   it, and every person who was in this workspace and no other (their email, name, sessions and
   links). Everyone else's sessions leave it. The person who deleted it is signed out everywhere.
3. Kept: the invoices, with their PDFs, as the law asks; each is marked detached
   (`detached_at`) with the business it was for (`customer_name`). The audit log stays too. The
   workspace's row stays, emptied (no name, slug `deleted-<id>-`, disabled, `deleted_at`), so
   its id is never given to another workspace: Teder and Toran key their data by it. It is left
   out of `/admin/accounts` and `/internal/ops/customers`.
4. Every address in `OF_SIGNUP_NOTIFY` gets "חשבון נמחק: <business>", with who deleted it, when,
   what each product answered and how many invoices were kept.

## Product emails: POST /internal/notify

Teder and Toran ask us to email a workspace's people; each person chooses which they get.

```
POST http://127.0.0.1:4741/internal/notify
Authorization: Bearer <OF_INTERNAL_TOKEN>
Content-Type: application/json

{ "workspace": 7, "product": "teder", "kind": "posts_waiting",
  "subject": "3 פוסטים מחכים לאישור", "text": "יש 3 פוסטים חדשים.\n\nאפשר לאשר אותם מהטלפון.",
  "link": "https://teder.openfrequency.co.il/review" }
```

| Field | Rules |
|---|---|
| `workspace` | A positive integer (a JSON number, not a string). |
| `product` | `teder` or `toran`, and on for the workspace. |
| `kind` | `posts_waiting`, `weekly`, `monthly`, `connect_needed` or `publish_failed`. |
| `subject` | A string of at most 200 characters; made one line, without control characters or bidi overrides, and cut to 150. Not empty after that. |
| `text` | A string of at most 5,000 characters; plain text, its line breaks kept (an empty line starts a paragraph), other control characters and bidi overrides removed. Not empty. |
| `html` | Optional, a string of at most 50,000 characters. Checked and **not used**: the email's HTML is made here from `text`, escaped, so nothing a product sends reaches an inbox as markup. |
| `link` | An absolute `https` URL on `openfrequency.co.il` or a subdomain, default port, no user name or password. The email's button ("לפתוח את <product>"). |

Who gets it: the workspace's people (not disabled) who have that kind on for that product. With
no choice saved, an owner (`client_owner`) gets every kind and a member none. Each email ends with
a line to turn it off, linking to `https://<PUBLIC_HOST>/notifications?workspace=<id>`.

Answers: `202 {"ok": true, "sent": <how many emails>}` (also when nobody wants it: `sent` is 0);
`400 {"error": "<bad_workspace|bad_product|bad_kind|bad_subject|bad_text|bad_html|bad_link|bad>"}`
(`bad` for a body that is not a JSON object); `404 {"error":"no_workspace"}` for one we do not
have, or one deleted; `409 {"error":"product_off"}` when the product is not on for it; `413` past
256 KB; `429 {"error":"rate_limited"}` past 3 of one kind for one product to one workspace in 24
hours; `401`, `503` and `405` as for every internal route. Each one sent is in the audit log
(`notify_sent`), and counted in `notify_log` for the limit.

`/notifications` is the page where a signed-in person ticks, for each product the workspace has
on, each kind they want. It is linked from every such email and from the home page. Saving it
writes a choice for every kind of those products (`notify_prefs`), for that person in that
workspace only.

# Sign-up and the setup page

A business can open its own account at `/signup`, and every customer has one page, `/setup`,
that lists what is left before their products work. This is the contract Teder and Toran answer
for that page, and the settings that turn each part on.

## The settings

| Variable | Default | What it does |
|---|---|---|
| `OF_SIGNUP` | unset | `1` opens `/signup`. Anything else: `/signup` says "ההרשמה תיפתח בקרוב" with a link to `https://openfrequency.co.il/join`, and every POST to it is refused (403). |
| `OF_TEDER_INTERNAL` | `http://127.0.0.1:4700` | Where `/setup` reaches Teder's internal routes. |
| `OF_TORAN_INTERNAL` | `http://127.0.0.1:4710` | Where `/setup` reaches Toran's (the same address `/admin` uses). |
| `OF_INTERNAL_TOKEN` | unset | The bearer token for both. Unset or shorter than 32 characters, no product is asked and each says "לא הצלחנו לבדוק כרגע". |
| `OF_BILLING_PROVIDER` | unset | The payment hook. Unset, `billingReady()` is false and payment shows as a step that is coming soon. |

## Sign-up

The form asks for the full name (2 to 80 characters), the business's name (2 to 80), the
products (Toran, Teder or both, at least one), the terms and the privacy policy accepted
(`https://openfrequency.co.il/terms` and `/privacy`), and the email. The acceptance is kept on
the user and on the workspace (`terms_version`, `terms_accepted_at`); the version is the date
the website's legal pages were last updated, `TERMS_VERSION` in `src/accounts/signup.js`.

1. The answers wait in `signups` and the address gets an email with a link to
   `/signup/confirm`: one use, 15 minutes, and a button before it does anything (mail scanners
   open links), like a magic link. The token exists only in the email; the row keeps its SHA-256.
2. Pressing the button opens, in one transaction: the user, the workspace with only the products
   chosen, each with its subscription at the list price and nothing paid yet (the console's own
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
(10 a day) and 5 an IP in an hour (20 a day), in memory like the other limits; a honeypot field
that a person never sees (filled, the page looks the same and nothing is kept or sent); the
address checked like the login's. Each sign-up is in the audit log (`signup_requested`,
`signed_up`), which the console shows; there is no other notification to the superadmin.

Payment is not taken here. The subscription starts in the state the console calls "open" (on,
no payment recorded). `src/accounts/billing.js` has the hooks a card-clearing provider will plug
into: `billingReady(env)` and `checkoutUrl()`, which is null until a provider is connected.

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

- Payment comes first: `soon` while `billingReady()` is false; once it is true, `todo` until
  every subscription the workspace has is paid for, then `done`.
- The count at the top ("3 מתוך 5 צעדים") is the steps done out of every step that can be done
  now: a `soon` step is not counted, nor are the steps of a product that did not answer.
- A product's checklist is finished when it says `ready: true` and every required step is `done`.
- After a customer signs in (link, Google, or opening `/login` already signed in), and only when
  there is no `?next=`: while a product that answered is not finished, or payment is ready and
  not made, they land on `/setup`; otherwise on the home page. A product that does not answer is
  never a reason to land on `/setup`.
- The home page shows a "הגדרת החשבון" card while a product says it is not finished, and a
  "הגדרה" link at the top until every product has said it is.

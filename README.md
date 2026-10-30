# openfrequency-accounts

The one login for the OpenFrequency products, at `accounts.openfrequency.co.il`. Teder
(`teder.openfrequency.co.il`) and Toran (`toran.openfrequency.co.il`) have no login of
their own: they read the shared session cookie and ask this service who it belongs to.

It owns:

- **users**: customers sign in with Google or with an emailed link (single use, 15
  minutes). The superadmin signs in with a password and a TOTP code. A customer's account is
  one we made, one an invite made, or, while `OF_SIGNUP=1`, one they opened at `/signup`
  (below); otherwise Google, like the link, opens nothing.
- **workspaces**: one per customer business, opened by the superadmin, who invites
  its owner (the invite is good for 72 hours), or by the business itself at `/signup`.
- **memberships**: a user's role in a workspace, `client_owner` or `client_member`. A
  workspace's owner invites people from its home page, cancels an invite and removes
  someone; a workspace holds 3 people, its owners and the invites still waiting included,
  and past that the page sends them to support (our WhatsApp, `OF_SUPPORT_WA`). The superadmin's
  console is not limited.
- **products**: which of `teder` and `toran` each workspace may open.
- **invoices**: a copy of each invoice, with its PDF, for the customer's home page. The
  accountant's invoicing service issues them (their numbers and what the law asks of
  them); this service never makes one. The superadmin records each on `/admin`, and a
  workspace's owners see its invoices, and nobody else's: a member sees none.
- **sessions**: a random id in the `__Secure-of_session` cookie for
  `.openfrequency.co.il`. Signing out ends it for every product at once, and "sign out
  on all devices" ends every session the user has.

## Sign-up and the setup page

Public sign-up is built and closed until `OF_SIGNUP=1` is set; until then `/signup` says it opens
soon, with a link to the website's contact page, and refuses every POST. Open, a business gives
its full name, its name, the products it wants (Toran, Teder or both) and its email, and accepts
the terms and the privacy policy. An emailed link (15 minutes, one use, like the sign-in link), or
"continue with Google", opens the user, the workspace with only those products (each with its
subscription at the list price and nothing paid yet) and makes them its owner, without an invite.
An address that already has an account gets a sign-in link instead, never a second workspace.
`OF_SIGNUP_PRODUCTS` (default `teder,toran`) says which products the form offers: one left out
shows as coming soon and is refused (Toran waits for Meta's approval of WhatsApp: `teder`).
Each confirmed sign-up sends a short email to every address in `OF_SIGNUP_NOTIFY` (unset: none),
with who signed up, the business, each product's plan and price, the time, what to do next (in
manual payment, email the customer the payment details) and a link to it on `/admin`, and the
customer a welcome email (pay first, then set up, with the prices and a link to `/setup`). The
form shows each product's price, VAT excluded, with its setup fee, and under Teder's plans that
the setup fee is not refunded.

## The paywall, cancelling and deleting

The products are behind a paywall: a workspace may use one only while a recorded payment covers
today, or while the superadmin has marked it complimentary on `/admin/accounts`. Payments are
recorded on `/admin` ("התקבל תשלום לחודש" moves the paid-until day a month on). How the customer
pays is the switch `OF_PAYMENT` (`src/accounts/billing.js`): `manual` (the default: we email the
payment details, `OF_PAYMENT_METHOD` says how) or `provider` (they pay by card on the provider's
page, `OF_PAYMENT_URL`, which is then required); any other value and the service will not start.
Every page and email that describes paying says the mode's way ([docs/setup.md](docs/setup.md)).
Teder and Toran ask `GET /internal/entitlement?workspace=<id>&product=<p>`: `access` is `paid`,
`comp`, `unpaid`, `cancelled` or `off`, and `allowed` says whether to open. Every workspace that
existed before the paywall (migration 7) is complimentary for the products it had on, so nothing
that worked stops; a new sign-up is not. Until it is paid, `/setup` shows the payment as the
first required step ("לתשלום" to the provider's page, or, in manual mode, our WhatsApp for
questions) and the product's steps locked, and the home page's product card says "להסדיר תשלום".
The home page shows the plan, the price, the day it is paid until, the next payment (with a
provider) and the status in plain words.

An owner cancels a product online from the home page (a confirmation page first): it works to
the last day paid for and then stops, with nothing more charged, and can be taken back until
then; the owners get an email and `OF_SIGNUP_NOTIFY` a notice. An owner (or the superadmin) can
delete the workspace and its data, typing its name to confirm: Teder and Toran are asked first
(`POST /internal/workspaces/<id>/delete`; a 404 does not stop it, any other failure does), then
ours is deleted, the invoices kept and detached as the law asks. Teder and Toran email a
workspace's people through `POST /internal/notify`, and each person chooses which emails they
get, per product and kind, on `/notifications`. All of it is in [docs/setup.md](docs/setup.md).

`/setup` is one checklist per workspace, for the products it has turned on only: each product is
asked for its steps at `GET /internal/setup` (Teder at `OF_TEDER_INTERNAL`, Toran at
`OF_TORAN_INTERNAL`), and a customer lands there after signing up, and after signing in while a
required step is left. The contract and the settings are in [docs/setup.md](docs/setup.md).

## The operator's dashboard, /admin

The superadmin's `/admin` has three tabs. **היום** (`/admin`) is the operator's dashboard,
which used to be on Toran's home page (toran.openfrequency.co.il now shows Toran only).
**חשבונות** (`/admin/accounts`) is the console: workspaces, products, subscriptions,
invoices, invites, view-as and the audit log. **תורן** (`/admin/toran/`) is Toran's operator
dashboard: the leads, a lead's page, the review queue, the follow-ups, the chats, the settings
and the pitch pages' previews, rendered by Toran and proxied from it (below).

The dashboard shows:

- **לפנות היום**: who to write to today about Toran or Teder. Each card has the message,
  which can be edited, a button that copies it and opens the chat, and שלחתי, ענו לי, מחר,
  בעוד שבוע and לא מעוניינים (with the reason). A demo asked for on the website can go out
  from the demo number, and a next step that is due has its own form.
- The demos asked for on the website that have nothing to send yet, and the ready pages
  with no way to reach the store.
- **בשיחה**: who answered, with their next step.
- **המשפך**: each product's funnel, with the rate from each stage to the next.
- **לקוחות וכסף**: the monthly revenue before VAT, who pays, who is late, who has not paid
  yet, and who renews in the next 7 days.

The leads, the messages and the funnels come from Toran, which keeps the outreach: `GET
/internal/ops` at each load, and every button is forwarded to `POST
/internal/ops/<toran|teder>/<id>/<action>` (Toran's `docs/operator.md`, section 4). Accounts
reaches Toran at `OF_TORAN_INTERNAL` (default `http://127.0.0.1:4710`) with
`OF_INTERNAL_TOKEN`. Accounts works out the money and the funnels' last stage, the customers,
from its own subscriptions. When Toran does not answer, its sections say so and the rest of
the page works. The buttons work without JavaScript. With it (`static/admin.js`, the site's one
script), they post in the background and the card goes away. In view-as the dashboard is closed.

### /admin/toran, Toran's pages proxied

Every method on `/admin/toran` and `/admin/toran/*` goes to Toran at `OF_TORAN_INTERNAL` as it
came: the same method, path (with the `/admin/toran` prefix) and query, the body streamed up to
2 MB (413 past that). Superadmin only, outside view-as: anyone else gets the admin login (with
`?next=` back to the page) on a GET and a 403 on anything else, and nothing reaches Toran. A path
with `/internal` under the prefix is 404 here and never asked of Toran.

Toran gets only `content-type`, `accept`, `accept-language`, `accept-encoding`, `origin`,
`referer`, `user-agent`, `x-tn-ajax`, `content-length` and Toran's own cookies (`tn_*`) from the
browser, and from us `host` (Toran's own host:port), `x-of-admin-prefix: /admin/toran`,
`x-forwarded-proto` (https when the browser reached us over HTTPS through Caddy, as accounts
itself decides), `x-of-admin-origin` (`https://<PUBLIC_HOST>`, or this site's own address in
development) and `x-of-operator`: who the superadmin is, signed with `OF_INTERNAL_TOKEN` for that
one request and good for 60 seconds (`docs/contracts/admin-toran-operator.json`). The
superadmin's session cookie never reaches Toran (PRA-SEC-004). Never the browser's
`authorization`, `x-forwarded-for`, `forwarded`, `x-real-ip` or any `x-of-*`. Toran strips the
prefix, keeps it in its links, forms and redirects, and does its own CSRF checks (on the
statement's `ses`).
Toran's answer comes back as it is (status, cookies, location, compression, its own CSP), without
the hop-by-hop headers and without ours. When Toran is down or does not answer in 30 seconds,
the page is a 502 that says "תורן לא ענה כרגע" with a link back to `/admin`.

## Try it

```sh
npm install
npm test               # offline; a throwaway database per test (plus Chromium, if installed)
npm run demo           # everything on http://localhost:4740, a fictional shop, emails printed
```

## Run it for real

```sh
npm ci --omit=dev
npm run init-private                         # private/.env and private/data/
npm run admin:create -- --email <you>        # the superadmin: password, TOTP, recovery codes
pm2 start ecosystem.config.cjs               # of-accounts: 127.0.0.1:4740, internal 127.0.0.1:4741
```

The full steps (DNS, Resend, Caddy, backups, checks) are in [docs/deploy.md](docs/deploy.md).

## For Teder and Toran

- [docs/internal-session.md](docs/internal-session.md): what they send to
  `/internal/session` and every answer they can get back.
- [docs/internal-owner-phone.md](docs/internal-owner-phone.md): who a WhatsApp number is, for
  Toran's owner line: the link code, the claim, consent, and every answer.
- [docs/internal-ops.md](docs/internal-ops.md): `/internal/ops/customers`, every workspace with
  its people, subscriptions and invoices, for Toran; and the other direction, `/admin` calling
  Toran's `/internal/ops`.
- [docs/switch-over.md](docs/switch-over.md): what changes in each product, and in what order.
- [docs/setup.md](docs/setup.md): `/internal/setup`, each product's checklist for the setup page;
  `/internal/entitlement`, the paywall; `/internal/notify`, product emails; the delete route each
  product answers when a workspace is deleted; and the sign-up's settings.

## Where things are

| | |
|---|---|
| `src/db` | the SQLite database (`node:sqlite`) and its migrations |
| `src/core` | paths, the `.env` loader, the clock, the audit log |
| `src/auth` | passwords, TOTP, tokens, rate limits, the `?next=` allowlist, sessions, Google's half of signing in |
| `src/accounts` | magic links and invites, public sign-up, workspaces, the superadmin, subscriptions, the payment hook, the paywall (`entitlement.js`), deleting a workspace (`erase.js`), product emails (`notify.js`), invoices, WhatsApp numbers, the operator's list of customers |
| `src/mail` | Resend (or the outbox folder without a key), and the emails |
| `src/web` | `app.js` the public site, `internal.js` `/internal/session`, `/internal/owner-phone*`, `/internal/ops/customers`, `/internal/entitlement` and `/internal/notify`, `toran.js` the client for Toran's `/internal/ops`, `setup.js` the client for each product's `/internal/setup`, `erase.js` the client for each product's delete route, `dashboard.js` the operator's dashboard, `copy.js` every Hebrew word, `html.js` the pages |
| `scripts` | start, demo, `admin:create`, backup (checked), `daily` (the billing emails and the deletions, by hand), `schema-check`, `release-check`, `check:public`, `init-private` |
| `deploy` | the Caddy block, `deploy.sh` and `rollback.sh` (release folders) |
| `docs/contracts` | each internal API between accounts, Teder and Toran: the request, every status, an example of each |
| `.github/workflows` | CI: `npm run release-check` on every push to main |
| `ecosystem.config.cjs` | the pm2 job, `of-accounts` |

## Security, in short

- Session ids, link tokens and recovery codes are stored only as SHA-256; the password as scrypt.
- Magic links: 15 minutes, one use, a button before they are used (mail scanners open links),
  3 per address and 10 per IP in 15 minutes, the same answer whether or not the address exists.
- Sign-up (while `OF_SIGNUP=1`): the link is a magic link's (15 minutes, one use, a button
  first), 3 per address in 15 minutes and 5 per IP in an hour, a honeypot field, the same answer
  whether or not the address has an account, and never a second workspace for one.
- Google: the authorization code flow with PKCE, a state and a nonce in a signed 10-minute
  cookie, a verified address only; the Google account is tied to the user on first use.
- `?next=` only to `https://<one label>.openfrequency.co.il` or a path here.
- The superadmin: password and TOTP (one use per code), 5 tries per address in 15 minutes, 12-hour
  sessions, every action in the audit log, view-as read-only.
- Every form: a CSRF token and an Origin check. Every page: CSP with our own script files only and nothing inline
  (`static/load.js`, the loading state, on every page; `static/admin.js` on `/admin`), no framing. `/admin/toran/*` is
  Toran's: superadmin only, a foreign Origin refused here, and Toran's own CSRF and CSP on its pages.
- `/internal/session`, `/internal/owner-phone*` and `/internal/ops/customers`: their own port, never proxied, loopback only,
  a bearer token.

## This repository is public

Everything real (the database with every customer's email, the keys, the backups) lives
in `$OF_HOME`, `./private/` by default, which is gitignored. The pre-commit hook runs
`npm run check:public`, which refuses a commit that tracks the private folder, an `.env`
file, a database, a key-shaped string, or the email or business name of any user or
workspace in the local database.

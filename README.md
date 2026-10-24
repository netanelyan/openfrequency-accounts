# openfrequency-accounts

The one login for the OpenFrequency products, at `accounts.openfrequency.co.il`. Teder
(`teder.openfrequency.co.il`) and Toran (`toran.openfrequency.co.il`) have no login of
their own: they read the shared session cookie and ask this service who it belongs to.

It owns:

- **users**: customers sign in with Google or with an emailed link (single use, 15
  minutes). The superadmin signs in with a password and a TOTP code. There is no public
  signup: Google, like the link, opens only an account we made or an invite we sent.
- **workspaces**: one per customer business, opened by the superadmin, who invites
  its owner (the invite is good for 72 hours).
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

Toran gets only `cookie`, `content-type`, `accept`, `accept-language`, `accept-encoding`,
`origin`, `referer`, `user-agent`, `x-tn-ajax` and `content-length` from the browser, and from
us `host` (Toran's own host:port), `x-of-admin-prefix: /admin/toran`, `x-forwarded-proto` (https
when the browser reached us over HTTPS through Caddy, as accounts itself decides) and
`x-of-admin-origin` (`https://<PUBLIC_HOST>`, or this site's own address in development). Never
the browser's `authorization`, `x-forwarded-for`, `forwarded`, `x-real-ip` or any `x-of-*`. Toran
strips the prefix, keeps it in its links, forms and redirects, and does its own CSRF checks.
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

## Where things are

| | |
|---|---|
| `src/db` | the SQLite database (`node:sqlite`) and its migrations |
| `src/core` | paths, the `.env` loader, the clock, the audit log |
| `src/auth` | passwords, TOTP, tokens, rate limits, the `?next=` allowlist, sessions, Google's half of signing in |
| `src/accounts` | magic links and invites, workspaces, the superadmin, subscriptions, invoices, WhatsApp numbers, the operator's list of customers |
| `src/mail` | Resend (or the outbox folder without a key), and the two emails |
| `src/web` | `app.js` the public site, `internal.js` `/internal/session`, `/internal/owner-phone*` and `/internal/ops/customers`, `toran.js` the client for Toran's `/internal/ops`, `dashboard.js` the operator's dashboard, `copy.js` every Hebrew word, `html.js` the pages |
| `scripts` | start, demo, `admin:create`, backup, `check:public`, `init-private` |
| `deploy` | the Caddy block |
| `ecosystem.config.cjs` | the pm2 job, `of-accounts` |

## Security, in short

- Session ids, link tokens and recovery codes are stored only as SHA-256; the password as scrypt.
- Magic links: 15 minutes, one use, a button before they are used (mail scanners open links),
  3 per address and 10 per IP in 15 minutes, the same answer whether or not the address exists.
- Google: the authorization code flow with PKCE, a state and a nonce in a signed 10-minute
  cookie, a verified address only; the Google account is tied to the user on first use.
- `?next=` only to `https://<one label>.openfrequency.co.il` or a path here.
- The superadmin: password and TOTP (one use per code), 5 tries per address in 15 minutes, 12-hour
  sessions, every action in the audit log, view-as read-only.
- Every form: a CSRF token and an Origin check. Every page: CSP with no script (except `/admin`,
  which allows its own `static/admin.js` and nothing inline), no framing. `/admin/toran/*` is
  Toran's: superadmin only, a foreign Origin refused here, and Toran's own CSRF and CSP on its pages.
- `/internal/session`, `/internal/owner-phone*` and `/internal/ops/customers`: their own port, never proxied, loopback only,
  a bearer token.

## This repository is public

Everything real (the database with every customer's email, the keys, the backups) lives
in `$OF_HOME`, `./private/` by default, which is gitignored. The pre-commit hook runs
`npm run check:public`, which refuses a commit that tracks the private folder, an `.env`
file, a database, a key-shaped string, or the email or business name of any user or
workspace in the local database.

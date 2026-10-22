# openfrequency-accounts

The one login for the OpenFrequency products, at `accounts.openfrequency.co.il`. Teder
(`teder.openfrequency.co.il`) and Toran (`toran.openfrequency.co.il`) have no login of
their own: they read the shared session cookie and ask this service who it belongs to.

It owns:

- **users**: customers sign in with an emailed link (single use, 15 minutes). The
  superadmin signs in with a password and a TOTP code. There is no public signup.
- **workspaces**: one per customer business, opened by the superadmin, who invites
  its owner (the invite is good for 72 hours).
- **memberships**: a user's role in a workspace, `client_owner` or `client_member`.
- **products**: which of `teder` and `toran` each workspace may open.
- **sessions**: a random id in the `__Secure-of_session` cookie for
  `.openfrequency.co.il`. Signing out ends it for every product at once, and "sign out
  on all devices" ends every session the user has.

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
- [docs/switch-over.md](docs/switch-over.md): what changes in each product, and in what order.

## Where things are

| | |
|---|---|
| `src/db` | the SQLite database (`node:sqlite`) and its migrations |
| `src/core` | paths, the `.env` loader, the clock, the audit log |
| `src/auth` | passwords, TOTP, tokens, rate limits, the `?next=` allowlist, sessions |
| `src/accounts` | magic links and invites, workspaces, the superadmin |
| `src/mail` | Resend (or the outbox folder without a key), and the two emails |
| `src/web` | `app.js` the public site, `internal.js` `/internal/session`, `copy.js` every Hebrew word, `html.js` the pages |
| `scripts` | start, demo, `admin:create`, backup, `check:public`, `init-private` |
| `deploy` | the Caddy block |
| `ecosystem.config.cjs` | the pm2 job, `of-accounts` |

## Security, in short

- Session ids, link tokens and recovery codes are stored only as SHA-256; the password as scrypt.
- Magic links: 15 minutes, one use, a button before they are used (mail scanners open links),
  3 per address and 10 per IP in 15 minutes, the same answer whether or not the address exists.
- `?next=` only to `https://<one label>.openfrequency.co.il` or a path here.
- The superadmin: password and TOTP (one use per code), 5 tries per address in 15 minutes, 12-hour
  sessions, every action in the audit log, view-as read-only.
- Every form: a CSRF token and an Origin check. Every page: CSP with no script, no framing.
- `/internal/session`: its own port, never proxied, loopback only, a bearer token.

## This repository is public

Everything real (the database with every customer's email, the keys, the backups) lives
in `$OF_HOME`, `./private/` by default, which is gitignored. The pre-commit hook runs
`npm run check:public`, which refuses a commit that tracks the private folder, an `.env`
file, a database, a key-shaped string, or the email or business name of any user or
workspace in the local database.

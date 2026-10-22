# openfrequency-accounts

The one login for the OpenFrequency products, at `accounts.openfrequency.co.il`. Teder
(`teder.openfrequency.co.il`) and Toran (`toran.openfrequency.co.il`) have no login of
their own: they read the shared session cookie and ask this service who it belongs to.

It owns:

- **users**: customers sign in with an emailed link (single use, 15 minutes). The
  superadmin signs in with a password and a TOTP code. There is no public signup.
- **workspaces**: one per customer business, created by the superadmin, who invites
  the first owner (the invite is good for 72 hours).
- **memberships**: a user's role in a workspace, `client_owner` or `client_member`.
- **products**: which of `teder` and `toran` each workspace may open.
- **sessions**: a random id in the `__Secure-of_session` cookie for
  `.openfrequency.co.il`. Signing out ends it everywhere at once.

## Try it

```sh
npm install
npm test               # offline; a throwaway database per test
npm run init-private   # private/.env and private/data/
npm start              # the site on 127.0.0.1:4740, /internal/session on 127.0.0.1:4741
```

## Where things are

| | |
|---|---|
| `src/db` | the SQLite database (`node:sqlite`) and its migrations |
| `src/core` | paths, the `.env` loader, the clock, the audit log |
| `src/auth` | passwords, TOTP, tokens, rate limits, the `?next=` allowlist, sessions |
| `src/web` | the two listeners; `internal.js` is `/internal/session` |
| `docs/internal-session.md` | what Teder and Toran send and get back |
| `scripts` | start, backup, `check:public`, `init-private` |
| `ecosystem.config.cjs` | the pm2 job, `of-accounts` |

## This repository is public

Everything real (the database with every customer's email, the keys, the backups) lives
in `$OF_HOME`, `./private/` by default, which is gitignored. The pre-commit hook runs
`npm run check:public`, which refuses a commit that tracks the private folder, an `.env`
file, a database, a key-shaped string, or the email or business name of any user or
workspace in the local database.

## Status

Built one item at a time:

1. Skeleton: database, migrations, audit log, pm2, `check:public` (done)
2. Auth core ported from Teder: scrypt, rate limits by any key, TOTP, the `?next=` allowlist (done)
3. Sessions and `/internal/session`, with its response format in `docs/internal-session.md` (done)
4. Magic links and email through Resend; the Hebrew login page
5. Superadmin sign-in: password and TOTP
6. Superadmin pages: workspaces, invites, products, disable, view as
7. Deploy: Caddy, pm2, backups, and how Teder and Toran switch over

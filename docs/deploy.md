# Deploy

`of-accounts` runs under pm2 on the same VPS as Teder and Toran, behind Caddy, on Node 22.13
or later. It has no runtime dependencies (`npm ci --omit=dev` installs nothing).

| Port | What | Reached by |
|---|---|---|
| 127.0.0.1:4740 | the public site | Caddy, as `accounts.openfrequency.co.il` |
| 127.0.0.1:4741 | `/internal/session`, `/internal/owner-phone*` | Teder and Toran only, never Caddy |

Teder has 4700, Toran 4710, the website's lead endpoint 4720.

## Once

### 1. DNS

An `A` record for `accounts.openfrequency.co.il` pointing at the VPS (and `AAAA` if it has IPv6).

### 2. Resend

1. In Resend, add the domain the emails come from (`openfrequency.co.il`, or a subdomain such as
   `mail.openfrequency.co.il` to keep the root's mail reputation separate).
2. Add the DNS records Resend shows for it: SPF (`TXT`), DKIM (`TXT`/`CNAME`), and a DMARC `TXT`
   on `_dmarc` if there is none yet (`v=DMARC1; p=none;` to start). Wait for "Verified".
3. Create an API key with **Sending access** only, limited to that domain.

Until it is verified, Resend refuses to send, and the service logs each refusal (the customer
still sees the same "check your email" page).

### 3. The service

```sh
sudo git clone https://github.com/netanelyan/openfrequency-accounts /opt/openfrequency-accounts
cd /opt/openfrequency-accounts
npm ci --omit=dev
npm run init-private          # private/.env (mode 600), private/data/
```

Fill in `private/.env`:

```sh
PUBLIC_HOST=accounts.openfrequency.co.il
OF_INTERNAL_TOKEN=            # openssl rand -base64 48; the same value goes in Teder's and Toran's .env
SESSION_SECRET=               # openssl rand -base64 48
RESEND_API_KEY=
MAIL_FROM=OpenFrequency <accounts@openfrequency.co.il>
MAIL_REPLY_TO=                # where "reply to this email" lands; your own inbox (the billing emails ask customers to reply)
OF_SUPPORT_WA=                # our WhatsApp for "write to us", digits only (972...); unset, "how to pay" opens an email to MAIL_REPLY_TO
OF_ASSISTANT_WA=              # the owner line's WhatsApp number, digits only; the same as TORAN_ASSISTANT_WA in Toran's .env
OF_TORAN_INTERNAL=            # Toran on this machine, for /admin and /admin/toran; empty means http://127.0.0.1:4710
GOOGLE_CLIENT_ID=             # sign in with Google (below); unset, only the emailed link is offered
GOOGLE_CLIENT_SECRET=

# Public sign-up (docs/setup.md):
OF_SIGNUP=                    # 1 opens /signup; anything else, it says it opens soon
OF_SIGNUP_PRODUCTS=           # the products it offers, comma-separated; teder while Toran waits for Meta
OF_SIGNUP_NOTIFY=             # who hears of each sign-up, cancellation, deletion, unpaid payment and ended grace (comma-separated)
OF_SIGNUP_DAILY_EMAILS=       # the most sign-up emails a day, from everyone together; empty means 200
OF_PAYMENT_METHOD=            # how to pay until a provider is connected, in Hebrew ("העברה בנקאית או ביט"); said on /setup and in the emails
OF_BILLING_PROVIDER=          # set only once a payment provider is connected
```

**What a stranger who signs up needs.** With `OF_SIGNUP=1`, the first lines of the log say which of
these is missing, because each one leaves a customer with no way forward:
`OF_SIGNUP_NOTIFY` (otherwise nobody hears of a new customer or an unpaid month), `OF_SUPPORT_WA`
or `MAIL_REPLY_TO` (otherwise "how do I pay" leads to the website's contact form), and
`OF_PAYMENT_METHOD` (otherwise the pages say only that we will send payment details). Whether they
are set on the server today: UNVERIFIED (`grep -c '^OF_SIGNUP_NOTIFY=.' /opt/openfrequency-accounts/private/.env`, and the same
for each name; the values are not printed).

`/admin` is the operator's dashboard. It reads `GET /internal/ops` from Toran on this machine at
each load, and forwards each of its buttons to `POST /internal/ops/<kind>/<id>/<action>`, with
`OF_INTERNAL_TOKEN` (Toran's `docs/operator.md`, section 4). Toran must have the same token. Set
`OF_TORAN_INTERNAL` only if Toran listens somewhere other than `127.0.0.1:4710`.

`/admin/toran/` (the **תורן** tab) is Toran's operator dashboard, proxied from Toran at the same
`OF_TORAN_INTERNAL`, superadmin only. Toran renders it and must know the `/admin/toran` prefix
(`X-OF-Admin-Prefix`); its own subdomain then shows the product only. Nothing to set here beyond
`PUBLIC_HOST`, which gives Toran the address to build links on (`X-OF-Admin-Origin`). See the
README for the headers that are passed.

**Sign in with Google.** In [Google Cloud](https://console.cloud.google.com/), in a project of
OpenFrequency's own, open *Google Auth Platform*:

1. *Get started*: the app name OpenFrequency, the support email, the audience *External*, the
   contact email.
2. *Branding*: the home page `https://openfrequency.co.il`, the privacy policy
   `https://openfrequency.co.il/privacy`, the terms `https://openfrequency.co.il/terms`, and
   `openfrequency.co.il` as an authorised domain. A logo sends the app to Google's review first,
   which can take days; it works without one. The scopes are the three that need no review:
   `openid`, `email`, `profile`.
3. *Audience*: *Publish app*, so it says *In production*; while it is in testing, only the test
   users listed there can sign in.
4. *Clients > Create client*, type *Web application*, with the authorised redirect URI
   `https://accounts.openfrequency.co.il/auth/google/callback`. Google shows the secret once.
5. Its client ID and secret go in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then
   `pm2 reload of-accounts`.

Google signs nobody up: a Google account opens the account of the customer with the same
verified address, or accepts an invite sent to that address. The first sign-in ties the
Google account to the customer, and from then on that Google account is how we know them.

Then the superadmin, with an authenticator app at hand:

```sh
npm run admin:create -- --email <your email>
```

It prints a key to add to the app and saves nothing until a code from the app matches. Keep the
eight recovery codes it prints somewhere other than the phone.

### 4. pm2

```sh
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                   # once per machine, if pm2 does not start at boot yet
pm2 logs of-accounts --lines 20
```

The log's first line says `email: resend`. If it says `outbox`, `RESEND_API_KEY` is not set.

### 5. Caddy

Append [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) to `/etc/caddy/Caddyfile` and
reload Caddy.

### 6. Backups

The database is `private/data/accounts.db`. On the server, `openfrequency-accounts-backup.service`
runs `/opt/node24/bin/node scripts/backup.js --keep 14` in `/opt/openfrequency-accounts`, as root,
nightly at 03:30 UTC (SERVER-FACTS.md). Each copy, `private/data/backups/accounts-<iso>.db`, is
opened and checked before it counts (`PRAGMA integrity_check`, the live schema version, the main
tables counted: `src/db/backup.js`); a bad one is renamed `.bad` and the run exits 1. A failed run
calls `/usr/local/bin/of-alert "<title>" "<body>"` so a person hears of it. That script is not
installed on the server yet (SERVER-FACTS.md): until it is, a failure is only in the unit's journal
(`journalctl -u openfrequency-accounts-backup`). Node 20 at `/usr/bin/node` cannot run the backup
(no `node:sqlite`); always `/opt/node24/bin/node`.

The copies stay on the same disk. The off-site copy is the server's job (the openfrequency-ops
scripts), not this repo's.

### Restore

1. `pm2 stop of-accounts` (that process alone: the same pm2 runs other apps).
2. Move `private/data/accounts.db`, `accounts.db-wal` and `accounts.db-shm` aside (do not delete
   them).
3. Copy the backup in as `private/data/accounts.db`. `/opt/node24/bin/node scripts/schema-check.js private/data/accounts.db`
   says whether this build can open it.
4. `pm2 start of-accounts`, then `curl -s http://127.0.0.1:4740/readyz` (curl's own Host header:
   `Host: accounts.openfrequency.co.il` is refused on that port with 403) answers `{"ok":true,...}`.

No restore has been rehearsed yet (PRA-DB-003): do one into a scratch folder (`OF_HOME=/tmp/restore-test`,
another port) and write the date and how long it took here.

### 7. Check it

```sh
curl -s https://accounts.openfrequency.co.il/healthz                    # ok
curl -s http://127.0.0.1:4740/readyz                                     # {"ok":true,"db":"ok","schema":{...},"commit":...}
curl -s -o /dev/null -w '%{http_code}\n' https://accounts.openfrequency.co.il/internal/session   # 404: not exposed
curl -s -H "Authorization: Bearer $OF_INTERNAL_TOKEN" -H 'X-OF-Session: x' http://127.0.0.1:4741/internal/session
# {"error":"no_session"}
curl -s -H "Authorization: Bearer $OF_INTERNAL_TOKEN" 'http://127.0.0.1:4741/internal/owner-phone?phone=972500000199'
# {"error":"not_linked"}
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OF_INTERNAL_TOKEN" http://127.0.0.1:4710/internal/ops
# 200: Toran answers the dashboard
```

Then sign in at `https://accounts.openfrequency.co.il/admin/login`, open a workspace for yourself
with your second address, and follow the invite from the email.

## Each update

Deploy only a commit that passed CI (`.github/workflows/test.yml`: the whole suite on Node 24, the
browser tests in a real Chromium, check:public), or run `npm run release-check` on a machine with
Chromium first.

**In release folders** (after the one-time move below), as root on the server:

```sh
/opt/openfrequency-accounts/current/deploy/deploy.sh            # origin/main; or name a commit
```

It checks the commit out in `releases/<commit>` beside the running one, installs it, runs the
tests there, takes a checked backup (`accounts-pre-<commit>-<iso>.db`), points `current` at it,
reloads `of-accounts` alone, and waits up to 60 seconds for `/readyz`. If it is not ready, it
rolls back by itself (`deploy/rollback.sh`), restoring that backup when the new build migrated
the database, and calls `of-alert`. `releases/HISTORY` keeps each deploy and its backup.
`deploy/rollback.sh` goes back to the release before by hand; it asks that build first whether it
can open the database (`scripts/schema-check.js`), and without `--restore <backup>` it refuses
when it cannot. A build never starts on a database a newer build migrated, or one whose
migrations differ from its own (src/db/index.js): it says so in the log and stops.

**Until the move**, in place, as before (no rollback but a `git checkout` of the last commit and a
restore):

```sh
cd /opt/openfrequency-accounts
/opt/node24/bin/node scripts/backup.js --keep 14 --tag pre-$(git rev-parse --short=12 origin/main)
git pull --ff-only
PATH=/opt/node24/bin:$PATH npm ci --omit=dev
pm2 reload of-accounts
curl -s http://127.0.0.1:4740/readyz
```

Migrations run on start. Sessions live in the database, so nobody is signed out by a restart.
Deploy order: a product's internal route before the accounts change that calls it (Teder and
Toran first when a contract in `docs/contracts/` changes on both sides).

### Release folders, once

Not done yet; it needs a quiet minute and the owner's go. As root:

```sh
cd /opt/openfrequency-accounts
git status --short                                       # UNVERIFIED: the live folder must have no local changes
diff ecosystem.config.cjs private/ecosystem.config.cjs   # UNVERIFIED: which of the two pm2 was started from
/opt/node24/bin/node scripts/backup.js --keep 14 --tag pre-releases
SHA=$(git rev-parse HEAD)
git worktree add --detach releases/$SHA $SHA
echo $SHA > releases/$SHA/REVISION
(cd releases/$SHA && PATH=/opt/node24/bin:$PATH npm ci --omit=dev)
ln -sfn releases/$SHA current
pm2 delete of-accounts                                   # that process alone
OF_APP_DIR=/opt/openfrequency-accounts/current OF_HOME=/opt/openfrequency-accounts/private \
  pm2 start current/ecosystem.config.cjs --only of-accounts
pm2 save                                                 # writes the list pm2 restores at boot; it stops nothing
pm2 jlist | grep -o '"pm_exec_path":"[^"]*"'             # UNVERIFIED until run: should be .../current/scripts/web.js
curl -s http://127.0.0.1:4740/readyz
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SHA -" >> releases/HISTORY
```

Then change `openfrequency-accounts-backup.service` to `WorkingDirectory=/opt/openfrequency-accounts/current`
with `Environment=OF_HOME=/opt/openfrequency-accounts/private` (`systemctl daemon-reload`). The
clone at `/opt/openfrequency-accounts` stays the git repository every release is checked out
from; `private/` stays where it is, shared by every release.

## When something is wrong

| Symptom | Look at |
|---|---|
| No email arrives | `pm2 logs of-accounts`: a `Resend answered 4xx` line says why (an unverified domain, a key without access). |
| Teder or Toran sends everyone to the login | Their `OF_INTERNAL_TOKEN` must equal this one. `/internal/session` answers `bad_token` when it does not. |
| `/admin` says "תורן לא ענה עכשיו" | Toran is down, or not at `OF_TORAN_INTERNAL`, or its `OF_INTERNAL_TOKEN` differs from this one. `pm2 logs of-accounts` has a `toran GET /internal/ops` line with the status or the error. The money and the console work in the meantime. |
| `/admin/toran/` says "תורן לא ענה כרגע" (502) | Toran is down or took over 30 seconds. `pm2 logs of-accounts` has a `toran GET /admin/toran/...` line with the error. |
| "האתר הזה עובד רק ב-HTTPS" | The request reached 4740 without Caddy's `X-Forwarded-Proto: https`. Check that Caddy proxies it. |
| "Google לא אישר את הכניסה" | `pm2 logs of-accounts`: `google sign-in: refused` is usually a wrong secret, or a redirect URI in Google Cloud that is not exactly `https://accounts.openfrequency.co.il/auth/google/callback`. |
| The superadmin lost the phone | Sign in with a recovery code, then run `npm run admin:create` again for a new key and new codes. |
| All recovery codes are gone too | On the server: `npm run admin:create -- --email <your email>`. It replaces everything. |

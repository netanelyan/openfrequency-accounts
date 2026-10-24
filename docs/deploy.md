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
MAIL_REPLY_TO=                # where "reply to this email" lands; your own inbox
OF_SUPPORT_WA=                # our WhatsApp for "write to us", digits only (972...); unset, the page says to reply to an email
OF_ASSISTANT_WA=              # the owner line's WhatsApp number, digits only; the same as TORAN_ASSISTANT_WA in Toran's .env
OF_TORAN_INTERNAL=            # Toran on this machine, for /admin and /admin/toran; empty means http://127.0.0.1:4710
GOOGLE_CLIENT_ID=             # sign in with Google (below); unset, only the emailed link is offered
GOOGLE_CLIENT_SECRET=
```

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

The database is `private/data/accounts.db`. A nightly copy, keeping 14:

```sh
crontab -e
30 3 * * * cd /opt/openfrequency-accounts && /usr/bin/node scripts/backup.js --keep 14
```

Copy `private/data/backups/` off the machine with the rest of your backups.

### 7. Check it

```sh
curl -s https://accounts.openfrequency.co.il/healthz                    # ok
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

```sh
cd /opt/openfrequency-accounts
git pull
npm ci --omit=dev
pm2 reload of-accounts
```

Migrations run on start. Sessions live in the database, so nobody is signed out by a restart.

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

# Moving Teder and Toran onto accounts

Today each product has its own login: a `users` table, a password form, and a signed
`__Host-of` cookie (Teder's `src/web/auth.js`, Toran's `src/web/auth.ts`). After the switch
they have none of that. They read `__Secure-of_session` and ask
[`/internal/session`](internal-session.md) who it belongs to, on every request.

This is a separate job in each product's repository. What it involves:

## In each product

1. **Settings.** `OF_INTERNAL_TOKEN` (the same value as here) and, if accounts is not on the
   default port, `OF_ACCOUNTS_INTERNAL=http://127.0.0.1:4741`.
2. **The check on every request.** Replace "is there a signed cookie" with the `whoIs()` client
   in [internal-session.md](internal-session.md), sent with `?product=teder` or
   `?product=toran`. On `401`, `409` or `403 no_membership`, redirect to
   `https://accounts.openfrequency.co.il/login?next=<this URL>`. On `403 workspace_disabled` or
   `product_disabled`, show a page that says so, without a redirect loop.
3. **Remove the login.** The `/login` route and form, `bootstrapOwner`, `user:add`, the
   `users` table's passwords, the per-address limiter for passwords. Keep `cookies()`,
   `clientIp()`, `isHttps()` and the CSRF helpers; derive the CSRF token from the accounts
   session id instead of the old cookie.
4. **Sign out.** The product's "יציאה" link goes to `https://accounts.openfrequency.co.il/logout`.
5. **Workspaces.** Every query that reads or writes customer data takes `workspace.id` from the
   answer. This is the real work, and it differs per product:
   - **Teder** has one owner today: its accounts (packs), posts, sources and settings belong to
     nobody in particular. Each needs a `workspace_id`, and the superadmin's operator view
     (`workspace: null`) keeps seeing everything.
   - **Toran** keys its data by store. Each store needs the `workspace_id` of the business that
     owns it; the pitch pages and the WhatsApp webhook stay public and do not change.
6. **Read-only.** When `readOnly` is true, the product refuses every POST, PUT, PATCH and DELETE
   on the server (not only by hiding buttons), and shows this banner at the top of every page:
   `אתם צופים ב-<workspace.name> כמו שהלקוח רואה אותו. זו צפייה בלבד, ושום שינוי לא נשמר.`
   with a "סיום צפייה" link to `https://accounts.openfrequency.co.il/admin`.
7. **Tests.** A fake accounts endpoint on a free port that answers each documented case; one
   test per row of the errors table in internal-session.md.

## The order

1. Deploy accounts ([deploy.md](deploy.md)), make the superadmin, check it.
2. Teder behind a setting (`OF_AUTH=accounts`, the old login while unset), so going back is one
   line in `.env` and a reload.
3. Open a workspace for yourself and sign in to Teder through it for a few days.
4. Toran the same way.
5. Remove the old login code from both once neither has used it for a week.

## In development

Run `npm run demo` here (accounts on `http://localhost:4740`, internal on 4741), and the product
on its usual port with `OF_INTERNAL_TOKEN=demo-internal-token-not-for-production-0000`.
Without `PUBLIC_HOST` the cookie is `of_session`, host-only, and browsers send it to every port on
the same host, so sign in at `http://localhost:4740` and open the product at
`http://localhost:4700`. Use `localhost` for both, not `127.0.0.1` for one of them: they are
different hosts to a cookie.

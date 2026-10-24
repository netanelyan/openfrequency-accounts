# GET /internal/ops/customers

Every customer workspace and its money, for Toran. This is section 1 of Toran's
`docs/operator.md`, as built here. It is read-only: it changes nothing and writes no audit entry.

The operator's dashboard itself is on our `/admin` now (section 4 of the same document), and it
calls Toran the other way: see [/admin and Toran's /internal/ops](#admin-and-torans-internalops),
below. `/admin` reads these same rows directly from the database (`opsCustomers()` in
`src/accounts/ops.js`), for the money and the funnels' last stage. Toran's own operator pages
are on our `/admin/toran/`, proxied from Toran: see [/admin/toran](#admintoran).

## The request

```
GET http://127.0.0.1:4741/internal/ops/customers
Authorization: Bearer <OF_INTERNAL_TOKEN>
```

- The same listener and the same checks as [`/internal/session`](internal-session.md): it
  listens on 127.0.0.1, is never proxied, answers only a loopback socket, and only the Host
  `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`.
- `OF_INTERNAL_TOKEN` is the same value in all three services' `.env`, 32 characters or more.
  While it is unset or short here, every request gets `503 not_configured`.
- Unlike the wording in Toran's `docs/operator.md`, this listener does not look at
  `X-Forwarded-For` (no route on it does): nothing proxies this port, and the loopback socket
  and Host checks refuse anything that did not start on this machine.
- It takes no parameters. Toran checks on its side that the person looking is the superadmin
  outside view-as before it asks.

## The answer

Every answer is JSON with `Cache-Control: no-store`.

### 200

```json
{
  "today": "2026-10-24",
  "workspaces": [
    {
      "id": 3, "slug": "dana-shop", "name": "Dana Shop", "disabled": false, "createdAt": "2026-10-01T09:00:00.000Z",
      "products": ["teder", "toran"],
      "people": 2, "invitesWaiting": 1, "lastLoginAt": "2026-10-23T18:00:00.000Z",
      "subscriptions": [
        { "product": "toran", "monthly": 449, "vat": "excluded", "setup": 990, "startedOn": "2026-10-01",
          "paidUntil": "2026-10-31", "endsOn": null, "state": "paid", "nextChargeOn": "2026-11-01" }
      ],
      "invoices": { "count": 2, "lastIssuedOn": "2026-10-01" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `today` | Today in Israel, `YYYY-MM-DD`. Every `state` below is worked out for this day. |
| `workspaces` | Every workspace, newest first (`createdAt`, then `id`), disabled ones included. The operator has no workspace of their own, so with no customers yet this is `[]`. |
| `disabled` | True when the superadmin disabled the workspace on `/admin`. |
| `products` | The products turned on, sorted. |
| `people` | Its members whose user is not disabled, owners included. |
| `invitesWaiting` | Its invites not used and not expired (72 hours), as `/admin` lists them. An invite sent to someone already in counts too. |
| `lastLoginAt` | The latest `users.last_login_at` of any of its members (disabled ones included), or `null` when none has signed in. That column is set whenever a session is made (`createSession`, every sign-in), per person, not per workspace: a person in two workspaces counts for both. |
| `subscriptions` | Every subscription the workspace has, `teder` then `toran`, including one whose product has since been turned off (it can still be ending, or late). A product with no subscription row is not listed. |
| `monthly`, `setup` | ₪, before VAT when `vat` is `excluded`, with VAT when `included`. Any of `monthly`, `vat`, `setup`, `startedOn` can be `null` if the operator cleared it on `/admin`. |
| `paidUntil` | The last day already paid for, or `null`. |
| `endsOn` | Set once the subscription is stopped: its last day. |
| `state` | Below. |
| `nextChargeOn` | The day after `paidUntil` while `paid` or `late` (for `late`, the day the missed payment was due, in the past); `null` for `waiting`, `ending` and `ended`. |
| `invoices` | How many invoices are recorded for the workspace, and the latest `issued_on` (`null` when none). |

### `state`

The home page's own logic: `describe()` in `src/accounts/subscriptions.js`, called with `today`,
its `status` renamed, in this order (the first that matches):

| `describe()` status | `state` | When |
|---|---|---|
| `ended` | `ended` | `endsOn` is before today. |
| `ending` | `ending` | `endsOn` is set, today or later. |
| `open` | `waiting` | No `paidUntil`: nothing paid yet. |
| `due` | `late` | `paidUntil` is before today, and it has not been stopped. |
| `active` | `paid` | `paidUntil` is today or later. |

One difference from the wording in Toran's `docs/operator.md`: `ending` there is "paid, and
`endsOn` is set", while `describe()` calls a subscription `ending` whenever `endsOn` is today or
later, paid or not (a stopped subscription is not chased for payment). A subscription that is
stopped and unpaid is therefore `ending`, never `late` or `waiting`. Compare `paidUntil` with
`today` to tell the two apart.

### Errors

| Status | `error` | Meaning |
|---|---|---|
| 401 | `bad_token` | Missing or wrong `OF_INTERNAL_TOKEN`. A configuration error: show the section as unavailable, log it. |
| 503 | `not_configured` | `OF_INTERNAL_TOKEN` is not set here. |
| 403 | `not_local`, `bad_host` | Not from this machine. |
| 405 | `method_not_allowed` | Not a GET. |
| 500 | `server_error` | Logged here. |

Anything else (a timeout, a refused connection) means accounts is not answering: the dashboard
shows the section as unavailable and the rest of the page as usual.

## /admin and Toran's /internal/ops

The other direction: the public site's `/admin` is a client of Toran's internal routes
(`src/web/toran.js`). They live on Toran's listener, `OF_TORAN_INTERNAL` (default
`http://127.0.0.1:4710`), and take the same `Authorization: Bearer <OF_INTERNAL_TOKEN>`.

| Call | When | Timeout |
|---|---|---|
| `GET /internal/ops` | each load of `/admin` by the superadmin outside view-as | 3 s |
| `POST /internal/ops/<toran\|teder>/<id>/<action>` | each button on the dashboard | 15 s |

The POST body is JSON with only what the action takes: `by` always (the superadmin's name, else
the email), `text` and `days` for `next`, `days` (1 or 7) for `later`, `reason` for `lost`.
Before forwarding, `/admin` checks the superadmin's session, the CSRF token, that the session is
not in view-as, the action's name and product, and the reason. Toran's `message` comes back as
the flash line at the top of the page (or the page script's toast), and its `400 { error }` as
an error line. A Toran that does not answer, or answers anything else, records nothing, and the
line says so. Each forwarded action is written to our audit log as `ops_action`.

While Toran does not answer, the dashboard's sections that come from it (who to write to, the
conversations, the funnels) say so, and the money and the console work as usual. The funnels'
last stage, `customers`, which Toran sends as null, is counted here: the workspaces, not
disabled, with a subscription to that product that is `paid` or `ending`, and those of them that
started in the last 30 days.

Toran's links (`target.href`, `page`, `leadUrl`) reach the page only when they are `https:`,
`http:` or `mailto:` addresses.

## /admin/toran

Toran's operator dashboard (the leads, a lead's page, the review queue, the follow-ups, the
chats, the settings, the pitch pages' previews) is served on our `/admin/toran/` and rendered by
Toran: `src/web/admin-toran.js` proxies every method there to `OF_TORAN_INTERNAL`, superadmin
only, outside view-as. It is a plain HTTP proxy, not one of these JSON calls, and carries no
bearer token: Toran identifies the superadmin from the session cookie through
`/internal/session`, like any of its pages.

| Sent to Toran | Value |
|---|---|
| method, path, query, body | as the browser sent them; the path keeps `/admin/toran`; the body up to 2 MB |
| from the browser | `cookie`, `content-type`, `accept`, `accept-language`, `accept-encoding`, `origin`, `referer`, `user-agent`, `x-tn-ajax`, `content-length`, and nothing else |
| `host` | Toran's host:port from `OF_TORAN_INTERNAL` |
| `x-of-admin-prefix` | `/admin/toran` |
| `x-forwarded-proto` | `https` when the browser reached us over HTTPS through Caddy, else `http` |
| `x-of-admin-origin` | our public origin, `https://<PUBLIC_HOST>` (in development, this site's own address) |

Any path with an `/internal` segment under the prefix is 404 here and never reaches Toran.
Toran's answer comes back as it is, minus `connection`, `keep-alive`, `transfer-encoding` and
`upgrade`, with none of our headers added. 30 seconds without an answer, or Toran unreachable:
our 502 page.

## Changes to this format

Fields may be added. None will be removed or change meaning without a new version of this
document and a change to Toran first.

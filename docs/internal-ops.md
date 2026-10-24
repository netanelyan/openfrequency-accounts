# GET /internal/ops/customers

The customers and the money, for the operator's dashboard on Toran (the section "לקוחות וכסף"
on Toran's home page). Toran reads it at each page load. This is section 1 of Toran's
`docs/operator.md`, as built here. It is read-only: it changes nothing and writes no audit entry.

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

## Changes to this format

Fields may be added. None will be removed or change meaning without a new version of this
document and a change to Toran first.

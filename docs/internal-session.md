# GET /internal/session

How Teder and Toran find out who is signed in. They have no login of their own: the browser
carries one cookie for every `*.openfrequency.co.il` site, and the product asks this service
what it belongs to, on every request.

## The cookie

| | Production (behind HTTPS) | Development (http://localhost) |
|---|---|---|
| Name | `__Secure-of_session` | `of_session` |
| Domain | `.openfrequency.co.il` | none (the host it came from) |
| Flags | `HttpOnly; Secure; SameSite=Lax; Path=/` | `HttpOnly; SameSite=Lax; Path=/` |
| Value | 43 characters, base64url: a random session id, nothing else | same |

The value is a secret that signs its holder in everywhere. Never log it, put it in a URL, or
send it anywhere but this endpoint.

## The request

```
GET http://127.0.0.1:4741/internal/session?product=teder
Authorization: Bearer <OF_INTERNAL_TOKEN>
X-OF-Session: <the cookie value>
```

- Only from this machine: the port listens on 127.0.0.1, is never proxied, answers only a
  loopback socket, and only the Host `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`.
- `OF_INTERNAL_TOKEN` is the same value in all three services' `.env`, 32 characters or more.
  While it is unset or short here, every request gets `503 not_configured`.
- `product` is optional and should always be sent: with it, this service refuses a session
  whose workspace does not have that product turned on, so the product does not have to.
- The session id goes in a header, never the query string, so it does not end up in a log.

## The answers

Every answer is JSON with `Cache-Control: no-store`.

### 200: signed in

```json
{
  "user": { "id": 12, "email": "dana@example.com", "name": "Dana", "superadmin": false },
  "workspace": { "id": 3, "slug": "dana-shop", "name": "Dana Shop", "disabled": false },
  "role": "client_owner",
  "products": ["teder", "toran"],
  "readOnly": false,
  "viewAs": null,
  "expiresAt": "2026-11-21T10:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `user` | Who is signed in. `superadmin` is true only for the operator. |
| `workspace` | The customer business this session is in. `null` only for the superadmin outside view-as. `disabled` is only ever true in view-as (a customer of a disabled workspace gets a 403 instead). |
| `role` | `client_owner`, `client_member`, or `superadmin`. Read fresh on every call. |
| `products` | The products this workspace may open, sorted. For the superadmin outside view-as, every product. |
| `readOnly` | When true the product must refuse every change: hide the buttons and reject every POST, PUT, PATCH and DELETE on the server. |
| `viewAs` | `null`, or `{ "by": { "id", "email" }, "since": iso }` when the superadmin is viewing this workspace as its customer would. The product must show a banner saying so, on every page. `readOnly` is always true here. |
| `expiresAt` | The session's absolute end. Idleness can end it sooner (14 days for a customer, 12 hours for the superadmin). |

The three shapes a 200 takes:

| Who | `workspace` | `role` | `products` | `readOnly` | `viewAs` |
|---|---|---|---|---|---|
| a customer | theirs | `client_owner` / `client_member` | the workspace's | `false` | `null` |
| the superadmin | `null` | `superadmin` | all | `false` | `null` |
| the superadmin, viewing as | the one viewed | `superadmin` | the workspace's | `true` | set |

### Errors

| Status | `error` | Meaning | What the product does |
|---|---|---|---|
| 401 | `no_session` | No cookie, a malformed one, unknown, signed out, expired, idle too long, or the user is disabled. | Send the browser to the login (below). |
| 409 | `choose_workspace` | A member of several workspaces who has not picked one yet. | Send the browser to the login; it shows the picker. |
| 403 | `no_membership` | The user was removed from the workspace this session was in. | Send the browser to the login. |
| 403 | `workspace_disabled` | The superadmin disabled this workspace. | Show "this account is closed" with no way in. Do not redirect. |
| 403 | `product_disabled` | `?product=` was sent and this workspace does not have it. | Show "not part of your plan" and a link to accounts. |
| 400 | `bad_product` | `?product=` is not `teder` or `toran`. | A bug in the product. |
| 401 | `bad_token` | Missing or wrong `OF_INTERNAL_TOKEN`. | A configuration error: fail closed, log it. |
| 503 | `not_configured` | `OF_INTERNAL_TOKEN` is not set here. | Fail closed. |
| 403 | `not_local`, `bad_host` | Not from this machine. | Never happens when called as above. |

Anything else (a timeout, a refused connection, a 5xx) means **not signed in**. Fail closed.

## Rules for the product

1. **Ask on every request.** Do not cache the answer. Signing out, "sign out on all devices",
   removing a member, turning a product off and disabling a workspace all take effect on the
   next request only because nobody caches. The call is one indexed lookup over loopback.
2. **Send the browser to the login** with where it was going:
   `https://accounts.openfrequency.co.il/login?next=<the full URL, encoded>`. Only `https://`
   addresses on one subdomain of `openfrequency.co.il` are honoured; anything else lands on the
   accounts home page.
3. **Sign out** is a link to `https://accounts.openfrequency.co.il/logout` (a page with a
   button, so it carries a CSRF token). It ends the session for every product at once.
4. **Enforce `readOnly` on the server**, not just by hiding buttons.
5. **Scope every query to `workspace.id`.** The product keeps its own data per workspace and
   must never show one workspace's data to another's session.
6. **Keep CSRF protection** on the product's own forms: derive the token from the session id
   as today (`csrfFor` in Teder's `auth.js`).

## A client, for Node

```js
// src/web/accounts.js in the product
const ACCOUNTS = process.env.OF_ACCOUNTS_INTERNAL || 'http://127.0.0.1:4741';

export async function whoIs(req, product) {
  const jar = cookies(req);
  const sid = jar['__Secure-of_session'] || jar.of_session;
  if (!sid) return { status: 401, body: { error: 'no_session' } };
  try {
    const r = await fetch(`${ACCOUNTS}/internal/session?product=${product}`, {
      headers: { authorization: `Bearer ${process.env.OF_INTERNAL_TOKEN}`, 'x-of-session': sid },
      signal: AbortSignal.timeout(2000),
    });
    return { status: r.status, body: await r.json() };
  } catch {
    return { status: 503, body: { error: 'accounts_unreachable' } };
  }
}
```

## Changes to this format

Fields may be added. None will be removed or change meaning without a new version of this
document and a change to both products first.

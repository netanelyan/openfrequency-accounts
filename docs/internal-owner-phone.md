# /internal/owner-phone

Who a WhatsApp number is, for the owner line: the one WhatsApp number on which a business
owner talks to Toran and Teder. Toran asks this service about the number on every message,
and tells it which number sent a link code. This is section 1 of Toran's `docs/owner-line.md`,
as built here.

A number belongs to one user in one workspace. This service never sends anything to a phone.
The number proves itself by writing: the customer asks for a link code on their home page,
sends it from their WhatsApp to the owner line, and Toran says which number sent it (the same
pattern as the website's demo requests).

## The flow

1. On their home page (`/`), a customer (`client_owner` or `client_member`) presses
   "לחבר את הוואטסאפ". The form has one box: whether they agree to get Teder's and Toran's
   updates on WhatsApp. That answer is kept with the code, with the time the code was made.
2. This service makes a code `LINK-XXXXXX`: six of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, O,
   1, I or L), from `crypto.randomInt`, good for 30 minutes and for one use. A new code ends the
   person's previous open one. The page shows the code, until when it works, and a button to
   `https://wa.me/<OF_ASSISTANT_WA>?text=LINK-XXXXXX`. While `OF_ASSISTANT_WA` is unset it shows
   the code and says the number is not set yet.
3. The customer sends it. Toran calls `POST /internal/owner-phone/claim` with the code and the
   number that sent it. This service links the number to that user and workspace, marks it
   verified now, and copies the box's answer as an opt-in with the time the code was made.
4. The home page lists the linked numbers: a member sees their own, the workspace's owner sees
   every number in it. A number can be removed by its own person or by the owner. Its updates
   are turned on or off by its own person only; turning them on there is an opt-in, now, with
   the source `accounts`.

## The tables

```
phone_links  code PK, user_id, workspace_id, opt_in (0/1), created_at, expires_at, used_at, used_phone
user_phones  phone PK (international digits), user_id, workspace_id, verified_at, opt_in_at, opt_in_source,
             opt_out_at, opt_out_source, created_at
```

- The code is stored as it is, not hashed: it signs nobody in, it only links the number that
  sends it, for 30 minutes, once.
- A removed number is deleted from `user_phones`. The `audit` table keeps every code made
  (never the code itself), every link, every removal and every consent: `phone_link_created`,
  `phone_linked` (`again: true` for a number verified again), `phone_removed`, `phone_opt_in`,
  `phone_opt_out` (each with the phone, the time and the source).
- A number counts as linked only while its user is still a member of its workspace and is not
  disabled. Otherwise every route answers as if it were not linked, and the number can be
  claimed again by anyone.

## The request

```
GET http://127.0.0.1:4741/internal/owner-phone?phone=972500000123
Authorization: Bearer <OF_INTERNAL_TOKEN>
```

- The same locks as `/internal/session` (docs/internal-session.md): the port listens on
  127.0.0.1 and is never proxied, answers only a loopback socket and a loopback Host, and needs
  `OF_INTERNAL_TOKEN` (32 characters or more; `503 not_configured` while it is unset or short).
- A phone is international digits only: a country code and the number, 8 to 15 digits, no `+`,
  no spaces, no leading 0 (`972500000123`, not `+972 50-000-0123` or `0500000123`). Anything
  else is `400 bad_phone`.
- A POST body is a JSON object of 4096 bytes or less.

## The owner

Every route answers with this object, or a list of them:

```json
{
  "phone": "972500000123",
  "verifiedAt": "2026-10-24T09:00:00.000Z",
  "user": { "id": 12, "name": "Dana", "email": "dana@example.com" },
  "workspace": { "id": 3, "slug": "dana-shop", "name": "Dana Shop", "disabled": false },
  "role": "client_owner",
  "products": ["teder", "toran"],
  "optIn": { "at": "2026-10-24T09:00:00.000Z", "source": "accounts" },
  "optOut": null
}
```

| Field | Meaning |
|---|---|
| `verifiedAt` | The last time this number sent a code. |
| `user.name` | Their name, or `""` when they did not give one. |
| `workspace.disabled` | True: the superadmin closed this workspace. Nothing may be done for this number; treat it as not linked. |
| `role` | `client_owner` or `client_member`, read fresh. |
| `products` | The workspace's enabled products, sorted. |
| `optIn` | The latest opt-in, `{ "at", "source" }`. `null` when they never agreed. |
| `optOut` | The latest opt-out, `{ "at", "source" }`, only when it is later than the latest opt-in (or the same moment). Otherwise `null`. |

The later of the two speaks for now, and on a tie the opt-out. So: **updates may be sent only
when `optIn` is set and `optOut` is null.** Sources are `accounts` (the box on the link form,
the toggle on the home page) and whatever Toran sends (`whatsapp`).

## The routes

| Route | Answers |
|---|---|
| `GET /internal/owner-phone?phone=<digits>` | `200` the owner; `404 not_linked` |
| `GET /internal/owner-phones?workspace=<id>` | `200 { "phones": [owner, ...] }`, every linked number of that workspace, oldest first, possibly empty (also for an id that is no workspace); `400 bad_workspace` when the id is not a positive integer |
| `POST /internal/owner-phone/claim` with `{ "code": "LINK-XXXXXX", "phone": "<digits>" }` | `200` the owner; `404 unknown_code`; `410 expired`; `409 used`; `409 phone_taken` |
| `POST /internal/owner-phone/consent` with `{ "phone": "<digits>", "optIn": true\|false, "source": "whatsapp" }` | `200` the owner; `404 not_linked` |

### The claim

- `code` is matched without regard to case or surrounding spaces. Anything that is not
  `LINK-` and six letters of the alphabet is `404 unknown_code`, as is a code whose person has
  left the workspace or was disabled.
- `409 used`: the code was used already, by any number, even if it has expired since.
- `410 expired`: 30 minutes have passed, or the person made a newer code.
- `409 phone_taken`: the number is linked to someone else, in another workspace or in this
  one. It has to be removed there first (on that home page). A refused claim spends nothing:
  the code still works from another number.
- The same number, the same user and workspace: verified again now, and the code's answer is
  taken. A ticked box is an opt-in at the time the code was made; an unticked one, on a number
  whose updates were on, is an opt-out at that time.

### Consent

- `optIn` must be a boolean. `source` is optional (default `whatsapp`) and is lower-case
  letters, digits and `_`, 32 at most.
- It is recorded at the time of the request. Each kind keeps only its latest, so a repeated
  "התחל" changes nothing but its time.

### Errors on every route

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_phone` | The phone is not international digits. |
| 400 | `bad` | The body is not a JSON object, or a field is missing or of the wrong type. |
| 413 | `too_large` | The body is over 4096 bytes. |
| 401 | `bad_token` | Missing or wrong `OF_INTERNAL_TOKEN`. Fail closed, log it. |
| 503 | `not_configured` | `OF_INTERNAL_TOKEN` is not set here. Fail closed. |
| 403 | `not_local`, `bad_host` | Not from this machine. |
| 405 | `method_not_allowed` | `GET` on the two POST routes, or anything but `GET` on the others. |
| 500 | `server_error` | A bug here. Fail closed. |

Anything else (a timeout, a refused connection) means **nobody is an owner**. Fail closed.

## Rules for Toran

1. **Ask on every message.** Do not cache the owner: a number removed, a member removed, a
   product turned off and a workspace disabled all take effect on the next call only because
   nobody caches.
2. **A `workspace.disabled` owner is not an owner.**
3. **Send only to `optIn` set and `optOut` null**, and tell this service every "הפסק" and
   "התחל" through `consent`, so the home page shows the same.

## Changes to this format

Fields may be added. None will be removed or change meaning without a new version of this
document and a change to Toran first.

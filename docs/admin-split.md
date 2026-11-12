# The admin split: Toran and Teder stay products, the operator's work lives on /admin

The owner, 2026-11-10: "Make teder and toran of natikyan153@gmail.com regular, just like a customer's. Everything else,
leads etc should be in other places. The admin dashboard is for that. Toran and teder should stay toran and teder, even
for admins", and "Toran and teder dashboards should be consistent".

## What the operator saw until now

The operator is the superadmin outside view-as. accounts' `/internal/session` gives them `workspace: null`, and both
products read that as "every workspace, and the whole server's settings".

**Toran.** On `toran.openfrequency.co.il` the operator was sent to accounts' `/admin/toran/...` for every page (a 303,
or a 409 for a form): accounts proxies that prefix to Toran (`src/web/admin-toran.js`), signing who the operator is in
`X-OF-Operator`. There Toran shows its operator desk: the nav לידים, לבדיקה, שיחות (every store's), העוזר, מעקב,
הגדרות; the operator's Today (the funnel, what to send); a lead's page, its pitch, outreach and Teder demo; the review
queue; the follow-ups; `/queue` and `/job/<id>`; the brand page; Settings with the costs per store in tokens (dollars in
developer mode), lead discovery, the offer, the channels of our own number, the keys and developer mode; in a chat, the
agent's tool calls, the handoff reason in English and the cost. So the owner never saw Toran as a store owner sees it.

**Teder.** There was no `/admin/teder`. On `teder.openfrequency.co.il` the operator saw every workspace's accounts in
the switcher, the nav item לידים, `/leads` and `/demos` (Settings links to both), `/all` with every workspace's health
and the "posts only written to disk" banner, Settings with when posts are written, the kill switch, the month's costs
and every customer's quotas (developer mode), and on the pages: format names, the publisher used ("דרך zernio"), the
voice checker, stored English reasons, source errors, the catalogue of sources by niche, the onboarding's operator notes
and hidden sources. accounts' `/admin` linked to Teder's host for its tab "תדר" and the tools row.

**accounts' /admin.** Tabs היום, לידים, חשבונות, then תורן (`/admin/toran/`) and תדר (Teder's own host). Today has
the contact cards, the stuck demo requests, Teder's demos that are not up, the website's leads, the conversations, the
funnels and the money; a tools row links to Teder's leads, demos and all accounts, and the waitlist.

## The decision

1. **The operator gets a workspace of their own on the products' hosts.** The superadmin cannot be a member of a
   workspace (`workspaces.js` and the invites refuse their email), so accounts names one: `OF_OPERATOR_WORKSPACE`, a
   workspace id (on the live server it should be 1, the company's own workspace, the one Teder's `OF_OWN_WORKSPACES`
   names). For the superadmin outside view-as, `/internal/session` answers that workspace as an owner of it would see
   it: `workspace` set, `role: client_owner`, the workspace's `products`, `readOnly: false`, `viewAs: null`, and
   `user.superadmin: true`. When it is unset, closed or missing, the answer stays the
   operator's (`workspace: null`), and the product shows a short page pointing to `/admin`. A new case in
   `docs/contracts/session.json`.
2. **Both products then show that workspace exactly as a customer sees it**, because both already key every operator
   line on "no workspace". What changes in each product is only what used to look at the superadmin itself:
   - the paywall never asks about the superadmin's own workspace (Teder: `OF_OWN_WORKSPACES` already does; Toran:
     `user.superadmin`),
   - developer mode (Teder's seven taps, Toran's version line) is open to the superadmin in their workspace, and may
     keep its diagnostics there,
   - an old operator address on the product's host (a bookmark, an email, a WhatsApp alert: `/leads`, `/review`,
     `/followups`, `/queue`, `/lead/<id>`, `/chat/<id>` of a store outside the workspace, Teder's `/demos`, `/leads`)
     sends the superadmin to the same page under `/admin/toran` or `/admin/teder`. A customer still gets what they got.
3. **Every operator page is reached through accounts' /admin.** Toran's already is (`/admin/toran/...`). Teder gets the
   same: `/admin/teder/...`, proxied by accounts to Teder on this machine (`OF_TEDER_INTERNAL`, 127.0.0.1:4700) with the
   same signed `X-OF-Operator` (one contract, `docs/contracts/admin-toran-operator.json`, now naming both prefixes).
   Teder takes the prefix off, answers as the operator, and puts it back on every link, form, redirect and poll. Its
   own cookies travel under `td_*` names on accounts' host, so they never meet accounts' `of_flash` or `of_session`.
   Under the prefix: never `/internal`, the assistant's API, the signed slide links or the connect returns.
   On a laptop (127.0.0.1, no `PUBLIC_HOST`) both products keep showing the operator everything, for development and
   for the tests.
4. **accounts' /admin groups it.** The tabs become היום, לידים, תורן, תדר, חשבונות; תורן and תדר open the products'
   own sites, the company's workspace there (2026-11-11: "me as an admin i want a regular teder for the openfrequency
   accounts"), and each group's "לכל הדפים" opens its operator home under /admin. Today's tools row becomes two
   groups of links: תורן (לבדיקה, מעקב, החנויות והלידים, השירות שלנו בהגדרות) and תדר (דמואים, לידים, כל החשבונות,
   הגדרות השרת: מתי נכתבים, עצירת חירום, עלויות במצב מפתח). Teder's links from Toran's ops data (`TEDER_URL/demos/<id>`)
   keep working through the redirect in point 2.

## 2026-11-11: the same data, on a customer's screens

The owner, on the products' short page: "why isnt it set up? it was before we moved to regular toran and teder. i
wanted to have the same data but just see it like a customer". Point 1's workspace gave the owner a different set of
data (the company's workspace held Teder's three accounts and no Toran store), and on the live server it was closed or
gone, so both products showed their short page. So `OF_OPERATOR_WORKSPACE` is unset on the live server, the superadmin
there is the operator again (`workspace: null`), and each product, on its own name, shows the operator what they had
(Toran: every customer's store and every chat; Teder: every account) on a customer's screens: the customer's nav,
Today and Settings, nothing of the operator's. What they may do stays the operator's. The operator's pages still go to
/admin/toran and /admin/teder. The short page is gone. `OF_OPERATOR_WORKSPACE` still works where it is set, and /admin
says when the workspace it names is closed or gone.

## Where each operator feature lives now

| Feature | Before | Now |
|---|---|---|
| Shared leads | `/admin/leads` | the same, and everything about a lead is there since 2026-11-12 (below) |
| Toran's review queue, follow-ups, leads, a lead's page, queue, jobs, brand | `toran.../x`, sent to `/admin/toran/x` | `/admin/toran/x` (the old address still sends there); a lead's work is on `/admin/leads` |
| Toran's costs, discovery, offer, our number's channels, keys | `/admin/toran/settings` | the same |
| Teder's demos, a demo's page | `teder.../demos` | `/admin/teder/demos` |
| Teder's leads | `teder.../leads` | `/admin/teder/leads`; a lead's work is on `/admin/leads` |
| Teder's every workspace's accounts and health | `teder.../all` (operator) | `/admin/teder/all`; `teder.../all` is the workspace's own, as for a customer |
| Teder's kill switch, when posts are written, costs and quotas | `teder.../settings` (operator) | `/admin/teder/settings` |
| Teder's format names, publishers, English reasons, notes | Teder's pages (operator) | the same pages under `/admin/teder` |

## Leads are /admin/leads alone (2026-11-12)

The owner: "i want https://accounts.openfrequency.co.il/admin/leads to have everything i need for creating and doing
leads ... it MUST not send me to old fronts like https://accounts.openfrequency.co.il/admin/teder/leads". So
`/admin/leads` adds a store by its address and runs discovery, says each store in a few words, checks and fixes
Toran's page (what holds it back, the name, the colour, the sample chat, approve and hold), works Teder's demo (again,
another topic, taken down), and has where it stands, the take-down and the delete; Toran does each through its
`/internal/leads` (docs/contracts/admin-leads.json), and Teder's part through Teder's own internal routes. Nothing on it
links to `/admin/toran` or `/admin/teder`, and the tools on `/admin` no longer offer Toran's review queue, follow-ups and
stores, or Teder's leads. Those pages still answer at their addresses.

The same day: "On the leda page, those that were already reached to, move them to a different page". The stores we
wrote to (a message went from either product, from our number or by hand, or they are talking to us) are on
`/admin/leads/reached`, "פנינו אליהם", with its own tabs (waiting for an answer, talking, closed); `/admin/leads` keeps
the ones we have not written to (new, ready, and those closed before any message) and links to it with its count. Toran
is asked for its list once, with the search, and accounts cuts it (src/web/toran.js `leadsOfPage`). A lead's page goes
back to the list it is on. And "Lead page shouldnt let me send a message while a demo is being built": while Toran's
page is built or built again (`toran.state` building, `review.building`) or Teder's demo is written (`teder.state`
building), the lead's page says so in place of what to send and looks again every 20 seconds, and a send posted from a
page opened before is refused here.

## Consistency (Toran and Teder in the pro look)

The same rules in each repo's `docs/design-pro.md`, section "The two desks side by side": the nav's order (היום, the
product's main work, results, settings), the header (mark and name, the account's name, the side toggle), the side
bar's foot (usage ring, theme, sign-out), the page head, empty states, Settings in one column, folds, buttons.

## Toran's mark on a phone

Checked on a 390px screen: the top bar, the install card, the manifest and apple-touch icons. What differs is fixed in
Toran (see its commit).

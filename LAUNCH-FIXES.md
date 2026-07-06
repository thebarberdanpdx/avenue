# Vero — launch fix log (2026-07)

Running record of pre-launch security/hardening fixes. Each entry: the issue, the fix,
and status. **DB (SQL) fixes are pasted into the Supabase SQL editor and are LIVE the
moment they run. CODE fixes (api/, src/) live on this branch and are NOT live until
deployed to Vercel prod.**

## Status legend
✅ live & confirmed · 🛠️ code done, needs deploy · 🧠 needs decision/bigger work

---

## ✅ Fix #1 — Deleted leftover/duplicate RLS policies (DB, live)
Old migrations left two classes of bad policies that later hardening never removed;
Postgres OR-combines permissive policies so `(good check) OR true = true`:
- `anon INSERT` on `appointments`/`clients` → anyone with the public key could write
  straight to those tables, **bypassing `book_public`**. Dropped + revoked.
- `= true` policies on `providers`/`services`/`shops`/`waitlist`/`reviews` sitting beside
  the correct `auth_can_access_shop()` policy → any signed-in staff could read/write every
  shop's data and read PIN/comp / self-promote to owner. Dropped the `true` ones.
- Also dropped `anon_read_providers` + revoked anon SELECT on providers.
Confirmed: owner still sees calendar/clients/staff; public booking still works.

## ✅ Fix #2 — Stopped client-account takeover (DB, live)
`save_booking_client` let an anon caller overwrite an existing client's **email/phone**
(matched by an id `lookup_client_by_email` hands out) → redirect their login code → takeover.
Rewrote it to only refresh name/activity on existing clients; email/phone/savedCard are
never changed by the public path. New clients still insert fully.

## ✅ Fix #3 — app_state lockdown + card/family hardening (DB, live)
- `app_state` was `ALL` to `public` and unused by the app → RLS on, policy dropped, grants revoked.
- `save_client_card` → only sets a card when none is on file (no anon overwrite of a saved card).
- `append_family_member` → strips owner-only keys (`customPrices`/`customDurations`/`cadenceDays`/
  `blocked`/`blockReason`) from the incoming member and caps the family array at 25.

## 🛠️ Fix #4 — Rate-limited the send endpoints (CODE — needs table + env + deploy)
`notify.js`/`push.js` were gated only by an Origin check (spoofable) → anyone could spam/phish
a shop's staff by email/SMS/push and burn the SMS budget. Added a DB-backed limiter
(`lib/ratelimit.js`): 30 requests / 10 min per shop+IP on both endpoints. The one trusted
internal caller (`client-code.js` → notify) is exempted via an `INTERNAL_API_KEY` header.
Also stopped `push.js` echoing device-token prefixes to the caller.
**To go live, all three:** (a) create the `rate_limits` table [SQL below], (b) set
`INTERNAL_API_KEY` in Vercel env, (c) deploy to prod. Fails open if the table is missing,
so nothing breaks pre-deploy — the limiter is just inert until the table exists.

## ✅ Fix #5 — Blocked clients can't rebook (DB, live)
`book_public`'s block check only ran for new-client objects (first-timers). Added a second
guard that tests every appointment against the STORED client record by clientId/phone/email,
so a blocked returning client — or a caller omitting the client object — is refused.

## ✅ Fix #6 — Price/status sanity in book_public (DB, live)
Rejects negative / non-numeric / absurd (>100000) prices; forces a public booking's status
to `confirmed`/`pending` (can never arrive `done`/`paid`/`block`). Stops report poisoning.

## ✅ Fix #7 — Public bookings can't fake "paid" (DB, live)
`book_public` now strips `prepaid`/`prepaidTotal`/`prepaidTip`/`prepaidIntentId`/`deposit`/`paid`
from public writes → a caller can't create a "paid in full" appointment without paying.
Card-on-file (no-show) is unaffected (it lives on the client record, charged staff-side).
⚠️ **GATE:** this DB-disables online deposit/prepay *recording*. Do NOT enable the deposit/
prepay setting until the Stripe-verification step (below) is built, or a customer could be
charged online without the booking recording it.

---

## 🧠 Remaining — bigger/decision work (not yet done)
- **Online deposit/prepay verification** — when you want to turn the deposit setting ON:
  build a server step that verifies the Stripe PaymentIntent (succeeded, amount, not reused)
  before a booking is trusted as paid; the client flow must also carry a deposit intent id.
- **Backups (C4)** — enable Supabase Pro / point-in-time recovery before real bookings;
  `supabase db dump --schema-only` into version control (schema currently un-versioned).
- **Session tokens** — client session lives 90 days (not the intended 2h), stored plaintext.
- **Timezone** — `book_public` hardcodes `America/Los_Angeles`; off-tz bookers get wrong
  reminder timing. Fine for a single Pacific shop; must fix before multi-tenant.
- **CSP header**, Stripe webhook signature, `avenue2026` staff password, input length caps,
  cross-shop refund scoping, perf/pagination, a11y — see the full audit.

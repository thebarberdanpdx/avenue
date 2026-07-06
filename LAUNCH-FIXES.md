# Vero — launch fix log (2026-07)

Running record of pre-launch security/hardening fixes. Each entry: the issue, the fix,
and status. SQL fixes are pasted into the Supabase SQL editor (no migration framework);
this file is the record of what was run and why.

> Companion to the full audit. Ordered most-important-first.

## Status legend
✅ done & confirmed · 🔧 in progress · ⏳ queued · 🧠 needs decision/code work

---

## ✅ Fix #1 — Deleted leftover/duplicate RLS policies (ran in Supabase)
**Issue:** Old migrations left behind two classes of bad policies that later hardening
never removed. Postgres OR-combines permissive policies, so `(good check) OR true = true`:
- `anon INSERT` on `appointments`/`clients` (`with_check=true`) → anyone with the public
  key could write straight to those tables, **bypassing `book_public`** (double-book,
  blocked-client, and spam protections all skippable).
- `= true` "allow everything" policies on `providers`/`services`/`shops`/`waitlist`/`reviews`
  sitting next to the correct `auth_can_access_shop(shop_id)` policy → any signed-in staff
  could read/write **every shop's** data and read staff PIN/comp / self-promote to owner.

**Fix:** dropped the `anon_insert` policies + revoked anon INSERT; dropped the stale `true`
policies + `anon_read_providers` + revoked anon SELECT on providers. Booking still works
because the public path goes through `SECURITY DEFINER` RPCs (`book_public`,
`save_booking_client`, `join_waitlist`), verified in `src/App.jsx:4415-6669`.

**Safe because:** `clients`/`appointments` already relied solely on `auth_can_access_shop()`
and the app worked → that check is valid for the real owner; the tightened tables now match.
**Confirmed:** owner can still see calendar/clients/staff; public booking still works.

## ✅ Fix #2 — Stopped client-account takeover (ran in Supabase)
**Issue (C1):** `save_booking_client` let an anonymous caller overwrite the **email/phone**
on an *existing* client (matched only by an id that `lookup_client_by_email` returns).
Redirect a client's email → their login code is sent to the attacker → account takeover
(read visit history, cancel appointments).

**Fix:** rewrote `save_booking_client` so an existing client only ever gets name/activity
refreshed — email/phone/savedCard are **never** changed by the public booking path. New
clients still insert fully.
**Confirmed:** new-client and returning-client bookings both still complete.

---

## ⏳ Fix #3 — Batched: app_state lockdown + save_client_card + append_family_member
- `app_state` table is currently `ALL` to `public` (anon + authenticated) — world
  read/write. Not referenced anywhere in `src/App.jsx`; lock it.
- `save_client_card` — same anon-overwrite class as C1 (anon can set any client's card).
- `append_family_member` — anon can append arbitrary family members to any client.
_(pending: exact `append_family_member` body before writing the batch)_

## 🧠 Needs code work (not pure SQL) — tracked, not yet done
- **notify.js / push.js** unauthenticated → anyone can spam/phish a shop's staff by email/
  SMS/push. Fix = real auth + rate limiting (code change, push to branch).
- **Server-authoritative pricing (C3)** — `book_public` trusts client-sent `price`/deposit/
  paid flags. Impact: online prepay/deposit bypass, no-show-fee defeat, poisoned reports.
  In-person checkout limits the "free haircut." Needs price re-derived server-side.
- **Blocked-client bypass** — `book_public`'s block check only runs when `p_client` is set,
  which is only for brand-new bookers; returning/blocked clients skip it.
- **Backups (C4)** — enable Supabase Pro / point-in-time recovery before real bookings;
  `supabase db dump --schema-only` into version control (schema currently un-versioned).
- **Session tokens** — client session lives 90 days (not the intended 2h), stored plaintext.
- **CSP header**, cron-secret fail-closed, Stripe webhook signature, no test suite — see audit.

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

## ✅ Fix #3 — app_state lockdown + save_client_card + append_family_member (ran in Supabase)
Single batched migration:
- **app_state** was `ALL` to `public` (world read/write) and unused by `src/App.jsx` →
  enabled RLS, dropped the `allow all` policy, revoked anon/authenticated grants
  (service-role server access is unaffected — it bypasses RLS).
- **save_client_card** let anon overwrite *any* client's saved card by id → now only
  sets a card when none is on file yet; replacing an existing card is a logged-in/staff
  action. (Low-severity griefing hole; closed.)
- **append_family_member** let anon append arbitrary family members (with self-set
  `customPrices`/`customDurations`) to any client → now strips owner-only keys
  (`customPrices`, `customDurations`, `cadenceDays`, `blocked`, `blockReason`) from the
  incoming member and caps the family array at 25 to stop bloat/spam.

## 🔧 Fix #4 — Rate-limit notify.js / push.js (code pushed; 2 manual steps to activate)
**Issue:** `notify.js` and `push.js` were gated only by an Origin header check, which a
scripted attacker can forge — so both were effectively open: send email/SMS to a shop's
staff (toll-fraud + phishing) or push arbitrary alerts to their iPhones.

**Code (done, on branch):**
- New `lib/ratelimit.js` — DB-backed limiter (per endpoint+shop+IP), fails open.
- `api/notify.js` — public callers now pass Origin **and** a 30-per-10-min rate limit;
  trusted internal caller (`client-code.js`) is exempt via an `x-internal-key` secret.
- `api/push.js` — same 30-per-10-min limit; also stopped echoing device-token prefixes
  back to the caller.
- `api/client-code.js` — sends `x-internal-key` so login-code emails stay exempt.

**2 steps to activate (only you can do these):**
1. Create the table — run in Supabase SQL editor:
   ```sql
   create table if not exists public.rate_limits (
     bucket text not null,
     created_at timestamptz not null default now()
   );
   create index if not exists rate_limits_bucket_time on public.rate_limits (bucket, created_at);
   alter table public.rate_limits enable row level security; -- no policies: service-role only
   ```
2. In Vercel → project → Settings → Environment Variables, add **`INTERNAL_API_KEY`** =
   any long random string. (Optional but recommended — without it, login-code sends fall
   under the same public limit, which is fine at low volume.)
3. Deploy: `npx vercel --prod --force`.

_Note: this bounds flooding; it is not full auth (a public booking endpoint can't fully
authenticate an anonymous booker). Deeper content/blast-radius hardening tracked separately._

## 🧠 Needs code work (not pure SQL) — tracked, not yet done
- **Server-authoritative pricing (C3)** — `book_public` trusts client-sent `price`/deposit/
  paid flags. Impact: online prepay/deposit bypass, no-show-fee defeat, poisoned reports.
  In-person checkout limits the "free haircut." Needs price re-derived server-side.
- **Blocked-client bypass** — `book_public`'s block check only runs when `p_client` is set,
  which is only for brand-new bookers; returning/blocked clients skip it.
- **Backups (C4)** — enable Supabase Pro / point-in-time recovery before real bookings;
  `supabase db dump --schema-only` into version control (schema currently un-versioned).
- **Session tokens** — client session lives 90 days (not the intended 2h), stored plaintext.
- **CSP header**, cron-secret fail-closed, Stripe webhook signature, no test suite — see audit.

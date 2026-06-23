# Vero — database blueprint (recovery & audit reference)

> **What this is:** a human-readable map of the Supabase/Postgres backend, **derived from the application code** (`src/App.jsx` + `api/*`), written 2026-06-23.
>
> **What this is NOT:** an exact schema dump. Column types, constraints, the SQL of the Row-Level-Security (RLS) policies, and the bodies of the `rpc()` functions live only in Supabase and are **not** reproduced here. Capturing those verbatim needs a `pg_dump --schema-only` (or `supabase db dump`) against the database — that's the remaining piece of "schema → git" and should be done before launch when database access is available. **Verify against a real dump before relying on this to rebuild.**

- **Project ref:** `iufgznminbujcabqeesk` · **URL:** `https://iufgznminbujcabqeesk.supabase.co`
- **Client keys:** publishable key `sb_publishable_…` (in `src/supabaseClient.js`, safe/public). Server-only `SUPABASE_SERVICE_ROLE_KEY` lives in Vercel env and **bypasses RLS** — used by the `api/*` serverless functions.

## Security model (the important part)

Three access paths, by design:

1. **Public / not-logged-in (the booking page).** Never reads tables directly for sensitive data. Instead calls **`SECURITY DEFINER` RPCs** that return only safe, limited fields:
   - `get_availability(p_shop)` → **open/busy time slots ONLY** — never client names or phones.
   - `get_public_providers(p_shop)` → bookable staff (sanitized).
   - All writes go through RPCs (`book_public`, `save_booking_client`, `save_client_card`, `join_waitlist`).
   - Client self-service is gated by an emailed 6-digit code (`verify_client_code`) or a per-appointment token (`manage_*_by_token`).
2. **Logged-in staff (the dashboard).** Loads full rows directly (`.from('clients'/'appointments'/…').eq('shop_id', …)`), protected by **RLS** so a session only sees its own shop. ✅ Verified 2026-06-23: an anonymous read of `clients`/`appointments` returns **0 rows** even though data exists.
3. **Server (`api/*` serverless functions).** Use the **service-role key** → bypass RLS. These are now individually locked (owner-login / per-shop key / origin / cron-secret guards — see `HARDENING-SHOP.md`).

> ⚠️ **Known (Track B):** `providers`, `services`, and **`shops`** are readable by anonymous users because the booking page needs hours/policy/rules. `shops.settings` currently exposes the whole settings blob to anon (business config + business email; no secrets / no calendar URL). Tighten to a sanitized public view before multi-tenant launch.

## Tables (all appear to follow `{ id, shop_id, data(jsonb) }` unless noted)

| Table | Shape (inferred) | Notes |
|---|---|---|
| `shops` | `id` (slug, e.g. `avenue-phi`), `name`, `settings` (jsonb) | `settings` holds hours, policy, booking rules, tipping, checkout, branding, `calSync`. Anon-readable. |
| `clients` | `id`, `shop_id`, `data` (jsonb) | `data` = name, phone, email, photo, notes, timeline[], gallery[], family[], customDurations{}, customPrices{}, blocked, cadenceDays… **RLS-protected (PII).** |
| `appointments` | `id`, `shop_id`, `data` (jsonb) | `data` = clientId, providerId, serviceId, bookedFor, start/end, status, price, `paid{paymentIntentId,total,tip,refunded,disputed,…}`, lineItems[]. **RLS-protected.** Synced calendar rows carry `source:"sync"`/`_synced`. |
| `providers` | `id`, `shop_id`, `data` (jsonb) | staff: name, color, hours, comp, permissions. Anon-readable (sanitized for booking). |
| `services` | `id`, `shop_id`, `data` (jsonb) | name, category, price, duration, staff overrides. Anon-readable. |
| `waitlist` | `id`, `shop_id`, `data` (jsonb) | waitlist entries. |
| `device_tokens` | `token`, `shop_id`, `platform` | APNs push tokens for staff devices (used by `api/push`). |
| `client_login_codes` | `id`, `shop_id`, `email`, `client_id`, `code`, `expires_at`, `created_at` | 6-digit email sign-in codes (issued by `api/client-code`, 10-min expiry, rate-limited 5/15min; verified server-side by `verify_client_code`). |
| `message_log` | (jsonb log) | sent-message audit/dedup for reminders & notifications. |

## RPC functions (27) — grouped by purpose

**Public booking (no login):**
- `get_availability(p_shop)` — open/busy times only (no PII)
- `get_public_providers(p_shop)` — bookable staff
- `lookup_client_by_phone(p_shop, p_phone)` / `lookup_client_by_email(p_shop, p_email)` — match a returning client
- `save_booking_client(p_shop, p_client)` — upsert the booking client
- `book_public(p_shop, p_client, p_appts)` — create the appointment(s)
- `save_client_card(p_shop, p_client_id, p_card)` — store card-on-file ref
- `join_waitlist(p_shop, p_entry)`

**Client self-service (after email-code or token):**
- `verify_client_code(p_shop, p_email, p_code)` — verify the 6-digit sign-in code (server-side; brute-force protection lives here — audit when DDL is captured)
- `get_client_appointments(p_shop, p_client_id)`
- `cancel_my_appointment(p_shop, p_client_id, p_appt_id)`
- `append_family_member(p_shop, p_client_id, p_member)`

**Manage-by-token (magic links in reminder emails):**
- `manage_lookup_by_token` · `manage_cancel_by_token` · `manage_checkin_by_token` · `manage_reschedule_by_token`

**Account / shop / staff management (owner):**
- `whoami` · `create_shop` · `shop_slug_available` · `get_my_shops` · `get_account_locations`
- `claim_my_invites` · `invite_member` · `cancel_invite` · `list_members` · `remove_member` · `set_member_role` · `set_member_shops`

**Push:**
- `save_device_token(p_token, p_shop, p_platform)`

## To complete a true backup (future task)
1. `pg_dump --schema-only` (or `supabase db dump`) against the DB → commit `db/schema.sql` (captures exact tables, RLS policy SQL, and RPC function bodies — currently the unaudited part of the security surface).
2. Confirm Supabase **automated backups** are enabled for the data itself (plan-dependent — free tier has none; this is the real protection for the irreplaceable client/appointment **data**). Set up before taking real bookings.

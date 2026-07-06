-- Staff push targeting — buzz ONLY the assigned barber, not the whole shop.
-- 2026-07-06
--
-- Today api/push.js sends a new-booking/reschedule/cancel/waitlist push to EVERY device
-- registered for the shop (device_tokens rows are keyed by shop_id only). To target the one
-- barber an appointment is for, we tag each device with the barber signed in on it, and let
-- api/push.js filter device_tokens by provider_id.
--
-- This migration is ADDITIVE and safe to run on a live DB:
--   1. Adds a nullable provider_id column to device_tokens (no-op if it already exists).
--   2. Adds set_device_provider(...) — a tiny function the app calls right after the existing
--      save_device_token(...) to stamp the signed-in barber onto that token row. We do NOT touch
--      save_device_token itself (its body lives only in the DB), so nothing existing changes.
--
-- Rollout order: run this SQL FIRST, then deploy the app. The app is written to tolerate either
-- order — set_device_provider is called in a try/catch, so before this runs it just no-ops and the
-- token still saves; and api/push.js falls back to shop-wide until a barber's device is tagged.
-- After deploying, each staff device stamps its provider_id the next time the app is opened
-- (the push-registration effect runs on every launch), and pushes become per-barber from then on.

alter table public.device_tokens add column if not exists provider_id text;

-- Stamp the signed-in barber onto an already-saved device token (matched by token + shop).
-- security definer so the app's session role can update the row under RLS, mirroring the trust
-- model of save_device_token. Narrow by design: only ever sets provider_id for a matching token.
create or replace function public.set_device_provider(p_token text, p_shop text, p_provider text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.device_tokens
     set provider_id = p_provider
   where token = p_token and shop_id = p_shop;
$$;

grant execute on function public.set_device_provider(text, text, text) to anon, authenticated;

-- Optional: speeds up the per-barber token lookup in api/push.js on large shops.
create index if not exists device_tokens_shop_provider_idx
  on public.device_tokens (shop_id, provider_id);

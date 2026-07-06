-- ── FIX: save_booking_client must MERGE, never full-replace ──────────────────
-- Closes the two worst data-loss bugs from the functional stress-test:
--   #1 (CRITICAL): a guest booking that matches an existing client by email (but
--       isn't signed in) rebuilt the client record from empty defaults and
--       full-replaced it at the client's TRUE id — wiping visits, gallery,
--       timeline, family, private notes, customDurations/customPrices. Irreversible.
--   #3 (HIGH): a signed-in returning client's owner-set fields (customPrices,
--       cadenceDays, blocked, blockReason, smsConsent) were dropped on every
--       public rebook — reverting custom pricing and letting a BLOCKED client
--       clear their own block flag.
--
-- Root cause: save_booking_client overwrote clients.data wholesale. Fix: for an
-- EXISTING client, overlay ONLY the profile/contact fields the booking flow may
-- legitimately refresh (name, email, phone, savedCard, lastActivity) and leave
-- everything else — the entire history + owner-managed fields — untouched. A
-- brand-new client is still inserted with their full record.
--
-- Run once in the Supabase SQL editor. Transactional.

begin;

create or replace function public.save_booking_client(p_shop text, p_client jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Existing client: refresh ONLY contact/profile fields; preserve visits, gallery,
  -- timeline, family, notes, customDurations, customPrices, cadenceDays, blocked,
  -- blockReason, smsConsent, and anything else already on the record.
  update clients
     set data = data || jsonb_strip_nulls(jsonb_build_object(
           'name',         p_client->>'name',
           'firstName',    p_client->>'firstName',
           'lastName',     p_client->>'lastName',
           'email',        p_client->>'email',
           'phone',        p_client->>'phone',
           'lastActivity', p_client->>'lastActivity',
           'savedCard',    p_client->'savedCard'
         ))
   where shop_id = p_shop
     and id = p_client->>'id';

  -- Brand-new client only: insert the full record (nothing to preserve). Skipped
  -- when the id already exists, so a booking can never clobber an existing profile.
  insert into clients (id, shop_id, data)
  select p_client->>'id', p_shop, p_client
  where not exists (
    select 1 from clients where shop_id = p_shop and id = p_client->>'id'
  );
end;
$function$;

grant execute on function public.save_booking_client(text, jsonb) to anon, authenticated;

commit;

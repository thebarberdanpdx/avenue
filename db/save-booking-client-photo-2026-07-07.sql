-- ── save_booking_client: also persist `photo` (the profile selfie) ───────────
-- The $5 profile selfie now gets added on the post-booking confirmation screen and
-- written to the client with save_booking_client. But that function's merge list
-- did not include `photo`, so the selfie was silently dropped and never became the
-- client's profile picture. This adds `photo` to the merged fields — nothing else
-- changes. jsonb_strip_nulls still protects every field, so a partial patch never
-- wipes anything (a null photo is ignored, not cleared).
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
           'photo',        p_client->>'photo',
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

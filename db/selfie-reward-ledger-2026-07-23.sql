-- ── Selfie $5 credit: make it a durable, ONE-TIME-per-client reward (server backstop) ────────────
-- Problem: the $5 "profile selfie" credit was only blocked from repeating by "does the client
-- already have a profile photo?" — mutable state. A client (or anyone replaying the public RPC with
-- an appointment's manageToken) could clear/skip the photo and farm the $5 on booking after booking.
-- There was NO per-client ledger.
--
-- Fix: turn set_selfie_discount_by_token into the ledger's enforcement point. When granting ($5 on):
--   1. find the appointment's client (via its manageToken, same possession model as before),
--   2. if that client's data.selfieRewarded is already true → DO NOTHING (never grant twice),
--   3. otherwise apply the $5 to the appointment AND stamp clients.data.selfieRewarded = true.
-- Removing the selfie ($5 off) still clears the discount on that appointment, but does NOT clear the
-- ledger — one-time is one-time (the app also locks the photo on add, so removal is staff/edge only).
--
-- Safe: touches only the appointment's `discount` and the client's `selfieRewarded` flag. Never
-- writes any other client field, never clears contact info, sends no message (no cost). Idempotent.
--
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).

create or replace function public.set_selfie_discount_by_token(p_token text, p_on boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shop     text;
  v_client   text;
  v_rewarded boolean;
begin
  if coalesce(p_token, '') = '' then
    return;
  end if;

  if p_on then
    -- Resolve the appointment's shop + client from the private token.
    select shop_id, data->>'clientId'
      into v_shop, v_client
      from appointments
     where data->>'manageToken' = p_token
     limit 1;

    -- Ledger check: has this client already claimed their one-time selfie credit?
    if v_client is not null and v_client <> '' then
      select coalesce((data->>'selfieRewarded')::boolean, false)
        into v_rewarded
        from clients
       where shop_id = v_shop and id = v_client;
    end if;

    if coalesce(v_rewarded, false) then
      return; -- already rewarded once — never grant the $5 again
    end if;

    -- Grant: $5 onto the appointment …
    update appointments
       set data = data || jsonb_build_object(
             'discount', jsonb_build_object('id', 'selfie', 'name', 'Profile photo', 'type', 'amount', 'value', 5)
           )
     where data->>'manageToken' = p_token;

    -- … and stamp the durable ledger flag on the client so it can never repeat.
    if v_client is not null and v_client <> '' then
      update clients
         set data = data || jsonb_build_object('selfieRewarded', true)
       where shop_id = v_shop and id = v_client;
    end if;
  else
    -- Remove the selfie credit from this appointment. Do NOT clear the ledger flag.
    update appointments
       set data = data - 'discount'
     where data->>'manageToken' = p_token;
  end if;
end;
$function$;

-- Public booking runs without a signed-in session, so anon must be able to call it
-- (auth is possession of the private token, checked inside the function).
grant execute on function public.set_selfie_discount_by_token(text, boolean) to anon, authenticated;

-- NOTE: no retroactive backfill. The app isn't live to real clients yet — the handful of existing
-- selfie-credit records are test bookings, and marking them "rewarded" would only stop those test
-- accounts from re-testing the $5. The one-time rule takes effect for every credit granted from here
-- on. If you ever want to stamp a specific already-rewarded real client later, it's a one-liner.

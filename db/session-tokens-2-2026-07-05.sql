-- ── Returning-client session tokens — STEP 2 of 2 (TURN ON ENFORCEMENT) ───────
-- Run this ONLY AFTER the app deploy that sends p_session is live, and after you
-- confirm a real returning-client login still loads appointments. This flips
-- get_client_appointments and cancel_my_appointment to REQUIRE a valid session
-- token (issued by verify_client_code in step 1). After this:
--   • a signed-in returning client (app sends its token) → works as before
--   • an anonymous caller with just a client id (no valid token) → gets nothing /
--     cannot cancel. This closes the anon visit-history read and anon-cancel holes.
--
-- SAFE ROLLBACK: if a real login breaks, re-run db/session-tokens-1-2026-07-05.sql
-- to revert these two functions to the token-ignoring (fail-open) versions.
--
-- Run once in the Supabase SQL editor. Wrapped in a transaction.

begin;

-- View appointments: require a valid token bound to (shop, client).
create or replace function public.get_client_appointments(p_shop text, p_client_id text, p_session text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if p_session is null or not exists (
    select 1 from client_sessions s
    where s.token = p_session and s.shop_id = p_shop and s.client_id = p_client_id and s.expires_at >= now()
  ) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',             a.data->>'id',
             'clientId',       a.data->>'clientId',
             'familyMemberId', a.data->'familyMemberId',
             'serviceId',      a.data->>'serviceId',
             'providerId',     a.data->>'providerId',
             'bookedFor',      a.data->>'bookedFor',
             'start',          (a.data->>'start')::numeric,
             'end',            (a.data->>'end')::numeric,
             'status',         a.data->>'status',
             'title',          a.data->>'title',
             'price',          a.data->'price',
             'lineItems',      coalesce(a.data->'lineItems', '[]'::jsonb)
           )), '[]'::jsonb)
    from public.appointments a
    where a.shop_id = p_shop and a.data->>'clientId' = p_client_id
  );
end;
$function$;

-- Cancel: require a valid token bound to (shop, client).
create or replace function public.cancel_my_appointment(p_shop text, p_client_id text, p_appt_id text, p_session text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_session is null or not exists (
    select 1 from client_sessions s
    where s.token = p_session and s.shop_id = p_shop and s.client_id = p_client_id and s.expires_at >= now()
  ) then
    return;  -- no valid session → do nothing
  end if;
  update appointments
     set data = data || jsonb_build_object('status','cancelled')
   where shop_id = p_shop
     and id = p_appt_id
     and data->>'clientId' = p_client_id
     and coalesce(data->>'status','') not in ('cancelled','done','block');
end;
$function$;

commit;

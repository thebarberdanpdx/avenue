-- ── Returning-client session tokens — STEP 1 of 2 (SAFE / no behavior change) ──
-- Closes (in step 2) two live-confirmed holes: an anon who knows a client's
-- email/phone can read that client's visit history (get_client_appointments) or
-- cancel their appointments (cancel_my_appointment) — neither required proof.
--
-- The fix: verify_client_code (the code-gated login) now issues a short-lived
-- SESSION TOKEN, and viewing/cancelling appointments will require it. This STEP 1
-- only lays the groundwork and CHANGES NO BEHAVIOR: it creates the session table,
-- issues a token on login, and adds an (ignored) `p_session` parameter to the two
-- functions so the app can start sending it. Enforcement is turned on in step 2,
-- AFTER the app is deployed to send the token — so no client breaks mid-login.
--
-- Run this whole file once in the Supabase SQL editor. Wrapped in a transaction.

begin;

-- Session store. RLS on with NO policies → unreachable by anon/authenticated
-- directly; only the SECURITY DEFINER functions below (and the service role) touch it.
create table if not exists public.client_sessions (
  token       text primary key,
  shop_id     text not null,
  client_id   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '90 days'  -- matches the app's "stay logged in" persistence so a token never expires mid-session
);
create index if not exists client_sessions_lookup on public.client_sessions (shop_id, client_id);
alter table public.client_sessions enable row level security;

-- ── verify_client_code (email): issue a session token on success ─────────────
-- Identical to db/hardening-2026-06-24.sql EXCEPT the two NEW lines before the
-- final return that mint + return a `sessionToken`.
create or replace function public.verify_client_code(p_shop text, p_email text, p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_client_id text; v_out jsonb; v_attempts int; v_token text;
begin
  delete from client_login_codes where expires_at < now();
  update client_login_codes set attempts = coalesce(attempts,0)+1
   where shop_id = p_shop and lower(email) = lower(p_email) and expires_at >= now();
  select max(coalesce(attempts,0)) into v_attempts from client_login_codes
   where shop_id = p_shop and lower(email) = lower(p_email) and expires_at >= now();
  if coalesce(v_attempts,0) > 5 then
    delete from client_login_codes where shop_id = p_shop and lower(email) = lower(p_email);
    return null;
  end if;
  select c.client_id into v_client_id from client_login_codes c
   where c.shop_id = p_shop and lower(c.email) = lower(p_email) and c.code = p_code and c.expires_at >= now()
   order by c.created_at desc limit 1;
  if v_client_id is null then return null; end if;
  delete from client_login_codes where shop_id = p_shop and lower(email) = lower(p_email);
  select cl.data || jsonb_build_object('id', cl.id) into v_out
   from clients cl where cl.shop_id = p_shop and cl.id = v_client_id;
  -- NEW: mint a 2-hour session token bound to this client and hand it back.
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into client_sessions(token, shop_id, client_id) values (v_token, p_shop, v_client_id);
  return v_out || jsonb_build_object('sessionToken', v_token);
end;
$function$;

-- ── verify_client_code_phone: same token issuance ────────────────────────────
create or replace function public.verify_client_code_phone(p_shop text, p_phone text, p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_client_id text; v_out jsonb; v_attempts int; v_token text;
  v_digits text := regexp_replace(coalesce(p_phone,''),'\D','','g');
begin
  delete from client_login_codes where expires_at < now();
  update client_login_codes set attempts = coalesce(attempts,0)+1
   where shop_id = p_shop and regexp_replace(coalesce(phone,''),'\D','','g') = v_digits and expires_at >= now();
  select max(coalesce(attempts,0)) into v_attempts from client_login_codes
   where shop_id = p_shop and regexp_replace(coalesce(phone,''),'\D','','g') = v_digits and expires_at >= now();
  if coalesce(v_attempts,0) > 5 then
    delete from client_login_codes where shop_id = p_shop and regexp_replace(coalesce(phone,''),'\D','','g') = v_digits;
    return null;
  end if;
  select c.client_id into v_client_id from client_login_codes c
   where c.shop_id = p_shop and regexp_replace(coalesce(c.phone,''),'\D','','g') = v_digits
     and c.code = p_code and c.expires_at >= now()
   order by c.created_at desc limit 1;
  if v_client_id is null then return null; end if;
  delete from client_login_codes where shop_id = p_shop and regexp_replace(coalesce(phone,''),'\D','','g') = v_digits;
  select cl.data || jsonb_build_object('id', cl.id) into v_out
   from clients cl where cl.shop_id = p_shop and cl.id = v_client_id;
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into client_sessions(token, shop_id, client_id) values (v_token, p_shop, v_client_id);
  return v_out || jsonb_build_object('sessionToken', v_token);
end;
$function$;

-- ── get_client_appointments: add p_session param, IGNORED for now (no change) ──
-- Same body as the live version; the new parameter has a default so existing
-- 2-arg calls keep working unchanged.
drop function if exists public.get_client_appointments(text, text);
create function public.get_client_appointments(p_shop text, p_client_id text, p_session text default null)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
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
  where a.shop_id = p_shop and a.data->>'clientId' = p_client_id;
$function$;
grant execute on function public.get_client_appointments(text, text, text) to anon, authenticated;

-- ── cancel_my_appointment: add p_session param, IGNORED for now ───────────────
-- Not in the repo, so this is a fresh definition modeled on the secure
-- manage_cancel_by_token + the app's own behavior (mark the client's own,
-- not-yet-cancelled/done appointment as cancelled). Behavior matches today.
drop function if exists public.cancel_my_appointment(text, text, text);
create function public.cancel_my_appointment(p_shop text, p_client_id text, p_appt_id text, p_session text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  update appointments
     set data = data || jsonb_build_object('status','cancelled')
   where shop_id = p_shop
     and id = p_appt_id
     and data->>'clientId' = p_client_id
     and coalesce(data->>'status','') not in ('cancelled','done','block');
end;
$function$;
grant execute on function public.cancel_my_appointment(text, text, text, text) to anon, authenticated;

commit;

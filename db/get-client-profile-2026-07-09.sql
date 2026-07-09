-- ── get_client_profile — refresh a signed-in client's pricing/duration on the booking side ──
-- WHY: the booking page remembers a returning client's login (localStorage) and restores that
-- snapshot on reload, but it never re-pulled their per-client custom durations/prices. So a time
-- an owner set STAFF-SIDE after that client last logged in never reached the client's booking —
-- the "biz card isn't wired to client-facing" bug. The app now calls this on restore to merge the
-- CURRENT customDurations / customPrices / family back into the cached login.
--
-- Security: identical session gate to get_client_appointments (session-tokens-2). A caller must
-- present a valid, unexpired token bound to (shop, client); otherwise it returns null. Returns only
-- the client's OWN pricing/family fields — nothing another person's, no cross-client data.
--
-- SAFE: additive, read-only, SECURITY DEFINER. Run once in the Supabase SQL editor.

begin;

create or replace function public.get_client_profile(p_shop text, p_client_id text, p_session text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if p_session is null or not exists (
    select 1 from client_sessions s
    where s.token = p_session and s.shop_id = p_shop and s.client_id = p_client_id and s.expires_at >= now()
  ) then
    return null;
  end if;
  return (
    select jsonb_build_object(
             'id',              cl.id,
             'name',            cl.data->>'name',
             'customDurations', coalesce(cl.data->'customDurations', '{}'::jsonb),
             'customPrices',    coalesce(cl.data->'customPrices',    '{}'::jsonb),
             'family',          coalesce(cl.data->'family',          '[]'::jsonb)
           )
    from public.clients cl
    where cl.shop_id = p_shop and cl.id = p_client_id
  );
end;
$function$;

grant execute on function public.get_client_profile(text, text, text) to anon, authenticated;

commit;

-- ============================================================================
-- NEW-CLIENT DAILY CAP — server-side enforcement
-- ----------------------------------------------------------------------------
-- Pairs with the per-provider `prov.newClients` setting (NewClientsEditor in
-- src/App.jsx). Run this whole file once in the Supabase SQL editor. It is a
-- drop-in replacement for book_public: byte-for-byte your current function with
-- ONE new guard added (the "NEW-CLIENT DAILY CAP GUARD" block). Everything else —
-- the shop check, double-booking guard, client + appointment upserts — is
-- unchanged, so existing booking behavior is identical.
--
-- WHAT IT DOES
--   • "New" client = has no earlier non-cancelled booking at this shop.
--   • Each provider's cap comes from providers.data->'newClients'
--       capMode 'same'  -> capSame   (int | null)
--       capMode 'week'  -> capWeek[weekday]  (int | null per mon..sun)
--     null = no limit (never blocks), 0 = take no new clients.
--   • When a NEW client tries to book a provider whose new-client count for that
--     calendar day already meets the cap, the booking is rejected with
--     'newclient_cap'. The app catches that and offers the waitlist instead.
--   • Returning clients are never affected. Staff-side bookings never hit this
--     function, so manual adds always bypass the cap (online-only, like maxPerDay).
--
-- TIMEZONE: the cap buckets bookings by calendar day in v_tz (set below). It must
--   match how the booking page shows days. Sanctuary = Portland = Pacific.
--   If you add shops in other timezones later, thread the shop's tz in here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.book_public(p_shop text, p_client jsonb, p_appts jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e        jsonb;
  v_prov   text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_client text;
  v_when   timestamptz;
  v_cap    int;
  v_count  int;
  v_tz     text := 'America/Los_Angeles';   -- shop timezone for "calendar day" bucketing
begin
  if coalesce(p_shop, '') = '' then
    raise exception 'shop required';
  end if;

  -- Double-booking guard: lock the provider for this transaction, then reject overlaps.
  if p_appts is not null and jsonb_typeof(p_appts) = 'array' then
    for e in select value from jsonb_array_elements(p_appts) loop
      v_prov := e->>'providerId';
      if v_prov is not null and (e ? 'bookedFor') and (e ? 'start') and (e ? 'end') then
        perform pg_advisory_xact_lock(hashtext(p_shop || ':' || v_prov)::bigint);
        v_start := (e->>'bookedFor')::timestamptz;
        v_end   := v_start + make_interval(mins => ((e->>'end')::int - (e->>'start')::int));
        if exists (
          select 1 from appointments a
          where a.shop_id = p_shop
            and a.id <> (e->>'id')
            and a.data->>'providerId' = v_prov
            and coalesce(a.data->>'status', '') <> 'cancelled'
            and (a.data ? 'bookedFor') and (a.data ? 'start') and (a.data ? 'end')
            and (a.data->>'bookedFor')::timestamptz < v_end
            and (a.data->>'bookedFor')::timestamptz
                + make_interval(mins => ((a.data->>'end')::int - (a.data->>'start')::int)) > v_start
        ) then
          raise exception 'slot_taken' using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  -- ========================================================================
  -- NEW-CLIENT DAILY CAP GUARD  (added)
  -- For each leg booked by a brand-new client, block if the provider has already
  -- met their new-client limit for that calendar day. All-or-nothing: the first
  -- capped leg rejects the whole submission, so nothing is half-booked.
  -- ========================================================================
  if p_appts is not null and jsonb_typeof(p_appts) = 'array' then
    for e in select value from jsonb_array_elements(p_appts) loop
      if coalesce(e->>'status', '') not in ('cancelled', 'block')
         and (e ? 'providerId') and (e ? 'clientId') and (e ? 'bookedFor') then
        v_prov   := e->>'providerId';
        v_client := e->>'clientId';
        v_when   := (e->>'bookedFor')::timestamptz;

        -- Is this booker NEW? (no earlier non-cancelled booking at this shop)
        if not exists (
          select 1 from appointments a
          where a.shop_id = p_shop
            and a.data->>'clientId' = v_client
            and coalesce(a.data->>'status', '') not in ('cancelled', 'block')
            and (a.data->>'bookedFor')::timestamptz < v_when
        ) then
          -- Resolve this provider's cap for the local weekday of this booking.
          -- (Plain := assignment, NOT "select … into" — the Supabase editor's
          -- auto-RLS helper misreads INTO targets as new tables and corrupts the paste.)
          v_cap := (
            select case
              when pd->'newClients' is null then null
              when coalesce(pd->'newClients'->>'capMode', 'same') = 'week'
                then nullif(
                  pd->'newClients'->'capWeek'
                    ->> (array['sun','mon','tue','wed','thu','fri','sat'])
                         [extract(dow from (v_when at time zone v_tz))::int + 1],
                  '')::int
              else nullif(pd->'newClients'->>'capSame', '')::int
            end
            from (select data as pd from providers
                   where shop_id = p_shop and data->>'id' = v_prov limit 1) s
          );

          -- null cap = unlimited; only enforce a real number (0 included).
          if v_cap is not null then
            -- Count OTHER new clients already booked with this provider on the
            -- same local day. The "no earlier booking" test means a multi-service
            -- visit counts its client once, so this is effectively distinct people.
            v_count := (
              select count(*)
              from appointments a
              where a.shop_id = p_shop
                and a.data->>'providerId' = v_prov
                and coalesce(a.data->>'status', '') not in ('cancelled', 'block')
                and ((a.data->>'bookedFor')::timestamptz at time zone v_tz)::date
                    = ((v_when) at time zone v_tz)::date
                and not exists (
                  select 1 from appointments b
                  where b.shop_id = p_shop
                    and b.data->>'clientId' = a.data->>'clientId'
                    and coalesce(b.data->>'status', '') not in ('cancelled', 'block')
                    and (b.data->>'bookedFor')::timestamptz
                        < (a.data->>'bookedFor')::timestamptz
                )
            );

            if v_count >= v_cap then
              raise exception 'newclient_cap' using errcode = 'P0001';
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;
  -- ===================== end new-client cap guard ==========================

  if p_client is not null and (p_client ? 'id') then
    delete from clients where id = p_client->>'id' and shop_id = p_shop;
    insert into clients (id, shop_id, data) values (p_client->>'id', p_shop, p_client);
  end if;

  if p_appts is not null and jsonb_typeof(p_appts) = 'array' then
    delete from appointments
      where shop_id = p_shop
        and id in (select el->>'id' from jsonb_array_elements(p_appts) as t(el));
    insert into appointments (id, shop_id, data)
      select el->>'id', p_shop, el from jsonb_array_elements(p_appts) as t(el);
  end if;
end;
$function$;

-- ============================================================================
-- DEFERRED (not in this file): hiding "walk-ins only" saved windows from the
-- online grid. That lives in get_availability and needs synthetic busy blocks
-- generated from each provider's newClients.savedTimes — a separate change once
-- the cap is confirmed working. The cap above is the core "New clients/day" gate.
-- ============================================================================

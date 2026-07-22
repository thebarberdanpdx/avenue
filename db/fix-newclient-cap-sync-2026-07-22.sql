-- ============================================================================
-- FIX: new-client cap counted SYNCED calendar appointments as "new clients"
-- ----------------------------------------------------------------------------
-- BUG (found 2026-07-22, live): appointments imported from the calendar sync
-- carry NO clientId. The cap's "is this client new?" test (NOT EXISTS earlier
-- booking by the same clientId) treats every null-clientId row as brand new,
-- so a fully synced day (e.g. 8 imported appointments) instantly exceeds any
-- cap. Result: EVERY genuinely new client was rejected ('newclient_cap') on
-- every synced day where a cap was set — the go-live blocker Heather hit
-- booking Fri Jul 31 (cap 2, but 8 synced appts counted as 8 "new clients").
--
-- THE FIX (count block only — everything else byte-identical):
--   • Only count rows with a REAL clientId (synced/imported rows have none).
--   • Never count rows whose source is the calendar sync.
--   • Respect the master `enabled` switch (off = unlimited).
--
-- Run this WHOLE file once in Supabase → SQL Editor → Run.
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
  -- NEW-CLIENT DAILY CAP GUARD (fixed 2026-07-22 — see header)
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
          -- FIX: a disabled cap (enabled=false / missing) means NO limit.
          v_cap := (
            select case
              when pd->'newClients' is null then null
              when coalesce(pd->'newClients'->>'enabled', 'false') <> 'true' then null
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
            -- same local day.
            -- FIX: only real client bookings count. Synced/imported calendar rows
            -- have no clientId (and source='sync') — they must NEVER count as
            -- "new clients," or a synced day trips the cap for everyone.
            v_count := (
              select count(*)
              from appointments a
              where a.shop_id = p_shop
                and a.data->>'providerId' = v_prov
                and coalesce(a.data->>'status', '') not in ('cancelled', 'block')
                and coalesce(a.data->>'source', '') <> 'sync'
                and nullif(a.data->>'clientId', '') is not null
                and a.data->>'clientId' <> 'guest'
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

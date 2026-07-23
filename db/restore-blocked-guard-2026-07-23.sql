-- ============================================================================
-- ⚠️ URGENT — RESTORE the blocked-client guard to book_public
-- ----------------------------------------------------------------------------
-- REGRESSION (found live 2026-07-23): the new-client-cap replacement of
-- book_public (fix-newclient-cap-sync-2026-07-22.sql) was rebuilt without the
-- "blocked client" guard that block-online-appts-guard-2026-07-16.sql had
-- added — so running it silently DROPPED that protection. Verified on prod:
-- book_public accepted a booking for a blocked client. Blocked clients could
-- book online.
--
-- This file is the COMPLETE, correct book_public: the blocked-client guard
-- (GUARD 1 + 1b) AND the new-client-cap fix (synced rows / real clientId only,
-- respects `enabled`) AND the double-booking guard — all together. It's a
-- CREATE OR REPLACE, safe to run once now (and idempotent).
--
-- Run this WHOLE file once in Supabase -> SQL Editor -> Run.
-- After: a blocked client's online booking is refused (the app shows the
-- neutral "online booking unavailable" notice — never "you're blocked").
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

  -- GUARD 1: a blocked client cannot book, tested against the STORED record
  -- (never the caller-supplied p_client, which can't be trusted).
  if p_client is not null then
    if exists (
      select 1 from clients
      where shop_id = p_shop
        and data->>'blocked' = 'true'
        and (
          id = p_client->>'id'
          or (coalesce(p_client->>'phone','') <> '' and
              regexp_replace(coalesce(data->>'phone',''),'\D','','g') =
              regexp_replace(p_client->>'phone','\D','','g'))
          or (coalesce(p_client->>'email','') <> '' and
              lower(coalesce(data->>'email','')) = lower(p_client->>'email'))
        )
    ) then
      raise exception 'client_blocked' using errcode = 'P0001';
    end if;
  end if;

  -- GUARD 1b: also reject when ANY appointment's clientId belongs to a blocked stored client.
  -- Closes the hole where a blocked client already on file books as "new" (the app can't sign
  -- them in) and the lookup hands back their existing id with p_client=null.
  if p_appts is not null and jsonb_typeof(p_appts) = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_appts) as t(el)
      join clients c on c.shop_id = p_shop and c.id = el->>'clientId'
      where c.data->>'blocked' = 'true'
    ) then
      raise exception 'client_blocked' using errcode = 'P0001';
    end if;
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
  -- NEW-CLIENT DAILY CAP GUARD (synced rows / real clientId only; respects enabled)
  -- ========================================================================
  if p_appts is not null and jsonb_typeof(p_appts) = 'array' then
    for e in select value from jsonb_array_elements(p_appts) loop
      if coalesce(e->>'status', '') not in ('cancelled', 'block')
         and (e ? 'providerId') and (e ? 'clientId') and (e ? 'bookedFor') then
        v_prov   := e->>'providerId';
        v_client := e->>'clientId';
        v_when   := (e->>'bookedFor')::timestamptz;

        if not exists (
          select 1 from appointments a
          where a.shop_id = p_shop
            and a.data->>'clientId' = v_client
            and coalesce(a.data->>'status', '') not in ('cancelled', 'block')
            and (a.data->>'bookedFor')::timestamptz < v_when
        ) then
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

          if v_cap is not null then
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

-- ── Booking: a DONE (completed) appointment must FREE its slot ────────────────
-- Bug: the booking screen (computeFreeSlots) already treats a "done" appointment
-- as FREE and offers its time — but book_public's double-book guard treated every
-- status except 'cancelled' as busy, so it counted a completed appointment as
-- occupying the chair. Result: a time shown as available got rejected as
-- "slot_taken" / "That time was just taken." A completed visit's chair is free.
--
-- Fix: the ONLY change vs db/hardening-2026-06-24.sql is the conflict test on
-- line marked below — it now excludes BOTH 'cancelled' AND 'done', matching the
-- booking screen and the client. Everything else is byte-for-byte identical.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).

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
  v_tz     text := 'America/Los_Angeles';
begin
  if coalesce(p_shop, '') = '' then
    raise exception 'shop required';
  end if;

  -- M5: a client the owner has BLOCKED cannot book through the public page, even if
  -- the booking screen's check is bypassed. Tests the STORED client record(s) by
  -- id / phone / email — never the caller-supplied p_client (which can't be trusted).
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
            -- CHANGED: a completed ('done') appointment frees its slot, so it no longer
            -- blocks a new booking. (Was: <> 'cancelled'.) Matches computeFreeSlots + client.
            and coalesce(a.data->>'status', '') not in ('cancelled', 'done')
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
              when coalesce(pd->'newClients'->>'capMode', 'same') = 'week'
                then nullif(pd->'newClients'->'capWeek'->> (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from (v_when at time zone v_tz))::int + 1], '')::int
              else nullif(pd->'newClients'->>'capSame', '')::int
            end
            from (select data as pd from providers where shop_id = p_shop and data->>'id' = v_prov limit 1) s
          );

          if v_cap is not null then
            v_count := (
              select count(*)
              from appointments a
              where a.shop_id = p_shop
                and a.data->>'providerId' = v_prov
                and coalesce(a.data->>'status', '') not in ('cancelled', 'block')
                and ((a.data->>'bookedFor')::timestamptz at time zone v_tz)::date = ((v_when) at time zone v_tz)::date
                and not exists (
                  select 1 from appointments b
                  where b.shop_id = p_shop
                    and b.data->>'clientId' = a.data->>'clientId'
                    and coalesce(b.data->>'status', '') not in ('cancelled', 'block')
                    and (b.data->>'bookedFor')::timestamptz < (a.data->>'bookedFor')::timestamptz
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

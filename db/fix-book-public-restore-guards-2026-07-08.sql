-- ── RESTORE the three booking guards that 07-07 silently reverted ────────────
-- 2026-07-08 · run ONCE in the Supabase SQL editor (Dashboard → SQL → New query
-- → paste → Run). Wrapped in a transaction: all-or-nothing, no downtime — if it
-- fails it rolls back and the current function stays.
--
-- WHY: db/newclient-cap-respect-enabled-2026-07-07.sql added a needed fix (honor
-- the new-client cap master switch) but was built from a PRE-lockdown copy of
-- book_public, so it accidentally reverted three protections that
-- db/lockdown-2026-07-05.sql + db/booking-done-slot-2026-07-03.sql had shipped.
-- Confirmed LIVE on 2026-07-08 by reading the deployed function body.
--
-- WHAT THIS RESTORES (all three), while KEEPING the 07-07 `enabled` cap fix:
--   1. BLOCKED-CLIENT GUARD (M5) — a client the owner blocked cannot book online.
--      Tested against the STORED client record (by id / phone / email), never the
--      caller-supplied p_client (which can't be trusted). Was gone → a blocked
--      client could book.
--   2. INSERT-ONLY WRITES (#21) — the final write blocks no longer delete-then-
--      insert on caller-supplied ids. A public booker can ADD new rows but can no
--      longer overwrite/destroy an existing client or appointment by naming its
--      id. This was the data-destruction hole: lookup_client_by_phone hands an
--      anon caller a real client id, and the reverted delete-then-insert would
--      let that id's full record (notes, saved-card link, family, history) be
--      wiped and replaced with a stub. Returning-client profile updates still
--      happen — through save_booking_client (merge-safe), not here — so making
--      book_public insert-only loses no legitimate update.
--   3. DONE FREES ITS SLOT — the double-book test excludes BOTH 'cancelled' AND
--      'done' again (07-07 checked only 'cancelled'), so a COMPLETED appointment
--      no longer blocks its own time and a genuinely-free slot stops being
--      rejected as "that time was just taken".
--
-- KEPT FROM 07-07: the new-client cap treats the cap as unlimited whenever the
-- provider's newClients.enabled master switch is not true (the one line marked
-- below), matching the app exactly.
--
-- This function body = db/lockdown-2026-07-05.sql's book_public VERBATIM, plus
-- that single `enabled` line in the cap resolution. Nothing else changed.
--
-- ROLLBACK: re-run db/newclient-cap-respect-enabled-2026-07-07.sql (reverts to
-- the flawed version) — but you would not want to; that reopens all three holes.
--
-- SCOPE NOTE: this touches ONLY book_public. The other lockdown-2026-07-05
-- statements (revoke anon SELECT on providers; the get_public_providers strip)
-- are NOT replaced here and should still be in place from when you ran that file.
-- Verify separately if unsure (query at the bottom).

begin;

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

  -- GUARD 1 (restored): a blocked client cannot book, tested against the STORED
  -- record (never the caller-supplied p_client, which can't be trusted).
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

  -- Double-booking guard: lock the provider for this transaction, then reject
  -- overlaps. GUARD 3 (restored): a 'done' appointment frees its slot.
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

  -- New-client daily cap. All-or-nothing: the first capped leg rejects the whole
  -- submission, so nothing is half-booked.
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
              -- KEPT FROM 07-07: master switch OFF (or missing) → unlimited,
              -- matching the app. This is the fix 07-07 was meant to add.
              when coalesce(pd->'newClients'->>'enabled', 'false') <> 'true' then null
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

  -- GUARD 2 (restored): INSERT-ONLY. Never delete-then-insert on caller-supplied
  -- ids, so a public booker can add new rows but can't overwrite/destroy existing
  -- ones. Returning-client profile updates flow through save_booking_client
  -- (merge-safe), not here.
  if p_client is not null and (p_client ? 'id') then
    insert into clients (id, shop_id, data)
    select p_client->>'id', p_shop, p_client
    where not exists (
      select 1 from clients c where c.id = p_client->>'id' and c.shop_id = p_shop
    );
  end if;

  if p_appts is not null and jsonb_typeof(p_appts) = 'array' then
    insert into appointments (id, shop_id, data)
    select el->>'id', p_shop, el
    from jsonb_array_elements(p_appts) as t(el)
    where not exists (
      select 1 from appointments a where a.id = el->>'id' and a.shop_id = p_shop
    );
  end if;
end;
$function$;

commit;

-- ── Verify AFTER running (each should return true) ───────────────────────────
-- 1) All three guards present in the live function:
--   select
--     position('client_blocked' in prosrc) > 0        as has_blocked_guard,
--     position('not in (''cancelled'', ''done'')' in prosrc) > 0 as done_frees_slot,
--     position('where not exists' in prosrc) > 0       as insert_only_writes,
--     position('newClients''->>''enabled''' in prosrc) > 0 as keeps_enabled_fix
--   from pg_proc where proname = 'book_public';
--
-- 2) The other lockdown-2026-07-05 protections are still in place:
--   select has_function_privilege('anon','get_public_providers(text)','execute') as feed_ok;   -- true
--   select has_table_privilege('anon','public.providers','select') as anon_can_read_providers;  -- should be FALSE

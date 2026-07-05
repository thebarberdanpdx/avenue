-- ── Zero-trust lockdown — closes 3 live-confirmed anon holes + cleans test rows ──
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- The web deploy does NOT touch the database. Wrapped in a transaction: all-or-nothing.
--
-- What it fixes (all proven exploitable today with only the public anon key):
--   #26  providers table is anon-readable  -> revoke anon SELECT (public booking
--        reads staff via the get_public_providers RPC, which is SECURITY DEFINER and
--        unaffected, so the booking page keeps working; only direct anon reads die).
--   #26/#2  get_public_providers over-shares -> strip sensitive keys from the feed
--        (comp/permissions/roles/goals/etc.), keeping every field the booking page uses.
--   #21  book_public overwrites/destroys rows via caller-supplied ids -> INSERT-ONLY
--        (never delete-then-insert), so a booking can only ADD new rows, never clobber
--        an existing client or appointment. All booking guards are unchanged.
--   cleanup: remove the labeled security-test rows created during testing.

begin;

-- ── #26a: stop anonymous reads of the staff table ────────────────────────────
-- The public booking page never reads this table directly on its happy path — it
-- goes through get_public_providers (a SECURITY DEFINER RPC that bypasses this grant).
-- Signed-in staff use the `authenticated` role, which keeps its access. So this only
-- removes the anonymous leak of email/phone/comp/permissions.
revoke select on public.providers from anon;

-- ── #26b: the public staff feed must not expose sensitive fields ──────────────
-- Return every provider for the shop MINUS the sensitive keys. Denylist (not
-- allowlist) so no field the booking page relies on is accidentally dropped —
-- only the known-sensitive keys are removed.
drop function if exists public.get_public_providers(text);
create function public.get_public_providers(p_shop text)
 returns setof jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select data - 'comp' - 'permissions' - 'pulseRole' - 'userType'
              - 'dailyGoal' - 'weeklyGoal' - 'notifications'
              - 'pin' - 'email' - 'phone'
  from providers
  where shop_id = p_shop;
$function$;
grant execute on function public.get_public_providers(text) to anon, authenticated;

-- ── #21: book_public must never overwrite an existing client/appointment ──────
-- Byte-for-byte identical to db/booking-done-slot-2026-07-03.sql EXCEPT the two
-- final write blocks: delete-then-insert on caller ids -> insert-only (skip ids
-- that already exist). A public booker can create new rows but can no longer
-- clobber a real client's record or destroy/rewrite an existing appointment by
-- naming its id. All guards above (blocked-client, double-book, new-client cap)
-- are unchanged.
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

  -- M5: a blocked client cannot book, tested against the STORED record (never the
  -- caller-supplied p_client, which can't be trusted).
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

  -- WRITES (changed): insert-only. Never delete-then-insert on caller-supplied ids,
  -- so a public booker can add new rows but can't overwrite/destroy existing ones.
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

-- ── cleanup: remove the labeled security-test rows from the live test ─────────
delete from appointments where shop_id = 'sanctuary' and id like 'sectest\_%';
delete from clients      where shop_id = 'sanctuary' and id like 'sectest\_%';

commit;

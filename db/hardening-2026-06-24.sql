-- ─────────────────────────────────────────────────────────────────────────────
-- Vero — database security hardening applied 2026-06-24
-- ─────────────────────────────────────────────────────────────────────────────
-- These changes are LIVE in Supabase (project iufgznminbujcabqeesk), applied by
-- the owner via the SQL Editor. They are NOT auto-applied from this repo — this
-- file is the version-controlled record so the changes can be reviewed, audited,
-- or re-applied if the database is ever rebuilt. (See DATABASE.md for the full
-- backend map; the eventual `pg_dump --schema-only` will supersede this.)
--
-- Tracker: AUDIT-TRACKER.md — M5 (blocked-client enforcement) + H7 (login-code
-- brute-force cap). The remaining H1 lookup-PII redesign is intentionally deferred
-- (it's entangled with returning-client autofill + SMS-gated verification).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── M5 · Enforce "blocked client can't book" on the SERVER ───────────────────
-- book_public previously guarded only double-booking + new-client caps. A client
-- the owner blocked could still book if the booking SCREEN's check was bypassed.
-- Added an early guard that tests the STORED client record(s) by id / phone /
-- email (never the caller-supplied p_client, which can't be trusted). Everything
-- else in the function is unchanged, so normal bookings behave exactly as before.

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


-- ── H7 · Brute-force cap on the email sign-in code ───────────────────────────
-- verify_client_code had no per-code attempt limit, so a 6-digit code could be
-- hammered within its 10-minute window. Added an `attempts` counter: every verify
-- increments the active code(s) for that address; after 5 wrong tries the code is
-- burned and a new one must be requested (and code issuance is already rate-limited
-- to 5 / 15 min in api/client-code.js). Real clients typing the right code are
-- unaffected (they match on the first try).

alter table public.client_login_codes
  add column if not exists attempts int not null default 0;

CREATE OR REPLACE FUNCTION public.verify_client_code(p_shop text, p_email text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id text;
  v_out jsonb;
  v_attempts int;
begin
  -- housekeeping: clear anything expired
  delete from client_login_codes where expires_at < now();

  -- H7 brute-force guard: every verify attempt counts against the active code(s)
  -- for this address; after 5 wrong tries the code is burned (a fresh one must be
  -- requested, which is itself rate-limited), making 6-digit guessing futile.
  update client_login_codes
     set attempts = coalesce(attempts, 0) + 1
   where shop_id = p_shop and lower(email) = lower(p_email) and expires_at >= now();

  select max(coalesce(attempts, 0)) into v_attempts
    from client_login_codes
   where shop_id = p_shop and lower(email) = lower(p_email) and expires_at >= now();

  if coalesce(v_attempts, 0) > 5 then
    delete from client_login_codes where shop_id = p_shop and lower(email) = lower(p_email);
    return null;
  end if;

  select c.client_id into v_client_id
  from client_login_codes c
  where c.shop_id = p_shop
    and lower(c.email) = lower(p_email)
    and c.code = p_code
    and c.expires_at >= now()
  order by c.created_at desc
  limit 1;

  if v_client_id is null then
    return null;
  end if;

  -- single use: burn every outstanding code for this address
  delete from client_login_codes where shop_id = p_shop and lower(email) = lower(p_email);

  select cl.data || jsonb_build_object('id', cl.id) into v_out
  from clients cl
  where cl.shop_id = p_shop and cl.id = v_client_id;

  return v_out;
end;
$function$;

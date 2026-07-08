-- ── Cancel/reschedule window — SERVER-SIDE enforcement ───────────────────────
-- 2026-07-08 · pairs with the app-side "GUARD: cancel-window-lock" changes.
--
-- WHY: until now the change/cancel window (No-show Protection) was enforced
-- only by JavaScript in the browser. The buttons grey out, but the underlying
-- RPCs (cancel_my_appointment, manage_cancel_by_token, manage_reschedule_by_
-- token) would happily cancel or move an appointment 5 minutes before it
-- starts if called directly. This trigger is the real wall: it runs INSIDE
-- Postgres on every UPDATE of an appointment, so no client-side bug or
-- direct API call can slip a late cancel/move past it.
--
-- WHAT IT BLOCKS — only when ALL of these are true:
--   • the caller is the PUBLIC (anon) key — i.e. the booking page / manage
--     links. Signed-in staff (authenticated) and server jobs (service_role)
--     are exempt: the shop can always cancel or move anything.
--   • the update cancels the appointment, or changes its date/time
--     (bookedFor / start). Notes, photos, check-in status etc. stay allowed.
--   • the appointment's CURRENT time is inside the shop's change window
--     (minus a 3-minute grace — see below).
--
-- WINDOW RESOLUTION — mirrors the app's cancelWindowMinutes() exactly:
--   booking.cancelWindowMin (0 = owner chose "No minimum", respected)
--   → legacy booking.leadTimeMin ONLY if > 0
--   → legacy root cancelWindowHrs ONLY if > 0
--   → default 720 minutes (12 hours).
--
-- 3-MINUTE GRACE: a home-page reschedule books the NEW time first, then
-- releases the old slot. The app refuses to start that flow inside the
-- window, but the release can land a few seconds after the boundary. The
-- grace keeps that from stranding a client double-booked; it does not
-- meaningfully weaken the wall.
--
-- FAIL-CLOSED: if the appointment's date or the shop settings can't be
-- parsed while evaluating a guarded anon change, the change is refused
-- (call the shop) rather than allowed on garbage data.
--
-- Run once in the Supabase SQL editor. Wrapped in a transaction.
-- ROLLBACK: drop trigger trg_enforce_cancel_window on public.appointments;

begin;

create or replace function public.enforce_cancel_window()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_role      text;
  v_settings  jsonb;
  v_win_min   numeric;
  v_booked    timestamptz;
  v_grace_min constant numeric := 3;
  v_cancelling boolean;
  v_moving     boolean;
begin
  -- Who is calling? PostgREST sets request.jwt.claims per request; absent
  -- (SQL editor, service jobs) or non-anon roles pass straight through.
  begin
    v_role := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
  exception when others then
    v_role := '';
  end;
  if v_role <> 'anon' then
    return new;
  end if;

  -- Is this update even a guarded change? (cancelling, or moving date/time)
  v_cancelling := coalesce(new.data->>'status','') = 'cancelled'
              and coalesce(old.data->>'status','') <> 'cancelled';
  v_moving := (new.data->>'bookedFor') is distinct from (old.data->>'bookedFor')
           or (new.data->>'start')     is distinct from (old.data->>'start');
  if not (v_cancelling or v_moving) then
    return new;
  end if;

  -- Inside the shop's window? Any parse failure here → refuse (fail closed).
  begin
    v_booked := nullif(old.data->>'bookedFor','')::timestamptz;
    select s.settings into v_settings from shops s where s.id = old.shop_id;
    v_win_min := case
      when jsonb_typeof(v_settings->'booking'->'cancelWindowMin') = 'number'
        then (v_settings->'booking'->>'cancelWindowMin')::numeric
      when coalesce((v_settings->'booking'->>'leadTimeMin')::numeric, 0) > 0
        then (v_settings->'booking'->>'leadTimeMin')::numeric
      when coalesce((v_settings->>'cancelWindowHrs')::numeric, 0) > 0
        then (v_settings->>'cancelWindowHrs')::numeric * 60
      else 720
    end;
  exception when others then
    raise exception 'cancel_window: could not verify the change window — please call the shop';
  end;
  if v_booked is null then
    -- No readable appointment time on a guarded anon change → refuse.
    raise exception 'cancel_window: could not verify the appointment time — please call the shop';
  end if;

  if v_booked - now() < make_interval(mins => greatest(0, v_win_min - v_grace_min)::int) then
    raise exception 'cancel_window: too close to the appointment to change online — please call the shop';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_cancel_window on public.appointments;
create trigger trg_enforce_cancel_window
  before update on public.appointments
  for each row execute function public.enforce_cancel_window();

comment on function public.enforce_cancel_window() is
  'Refuses anon (public-key) cancels/moves of an appointment inside the shop''s change window (No-show Protection; default 12h). Staff and service_role exempt. Pairs with the app''s GUARD: cancel-window-lock.';

commit;

-- Sanity check after running (should list the trigger):
--   select tgname from pg_trigger where tgrelid = 'public.appointments'::regclass and not tgisinternal;

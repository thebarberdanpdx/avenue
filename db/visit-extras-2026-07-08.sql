-- ── Client "Notes & photos" on any upcoming visit, with a staff in-app alert ──
-- Two pieces, run once in the Supabase SQL editor:
--
-- 1) attach_booking_extras_by_token now also stamps `clientExtrasAt` on the
--    appointment. The staff app's notification watcher keys on that stamp, so
--    the barber gets an in-app alert whenever a CLIENT adds/changes notes or
--    photos — even on staff-booked appointments — and a staff edit never
--    self-notifies. Everything else about the function is unchanged.
--
-- 2) attach_visit_extras_by_client: the signed-in portal's fallback when the
--    device doesn't hold the appointment's manage token (e.g. email-code login
--    on a new phone). Auth = the client's server-issued session token, same as
--    cancel/reschedule. It resolves the appointment, verifies it belongs to
--    that client, and performs the exact same write as the token function.

create or replace function public.attach_booking_extras_by_token(p_token text, p_note text, p_photos jsonb, p_selfie text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  v_count  int   := case when jsonb_typeof(v_photos) = 'array' then jsonb_array_length(v_photos) else 0 end;
  v_shop   text;
  v_client text;
  v_when   text := to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_new    jsonb;
begin
  if coalesce(p_token, '') = '' then
    return;
  end if;

  -- 1) Appointment: note + reference photos + the client-write stamp the staff
  --    notification watcher keys on. Capture shop + client for the client writes.
  update appointments
     set data = data || jsonb_build_object(
           'note',           coalesce(p_note, ''),
           'hasNote',        (coalesce(p_note, '') <> ''),
           'photoData',      v_photos,
           'photos',         v_count,
           'hasPhotos',      (v_count > 0),
           'clientExtrasAt', v_when
         )
   where data->>'manageToken' = p_token
   returning shop_id, data->>'clientId' into v_shop, v_client;

  if v_client is null or v_shop is null then
    return;
  end if;

  -- 2) Client profile photo (the selfie) — only when one was provided.
  if p_selfie is not null and p_selfie <> '' then
    update clients
       set data = data || jsonb_build_object('photo', p_selfie)
     where shop_id = v_shop and id = v_client;
  end if;

  -- 3) Client gallery — append each reference photo as a dated entry, idempotently
  --    (re-saves replace this booking's entries, never duplicate).
  if v_count > 0 then
    select jsonb_agg(
             jsonb_build_object(
               'id',     p_token || '_' || (ord - 1)::text,
               'photo',  photo,
               'note',   '',
               'date',   v_when,
               'source', 'client'
             ) order by ord)
      into v_new
      from jsonb_array_elements_text(v_photos) with ordinality as t(photo, ord);

    update clients c
       set data = jsonb_set(c.data, '{gallery}',
             coalesce(v_new, '[]'::jsonb)
             || coalesce((
                  select jsonb_agg(g)
                    from jsonb_array_elements(coalesce(c.data->'gallery', '[]'::jsonb)) g
                   where left(g->>'id', length(p_token) + 1) <> p_token || '_'
                ), '[]'::jsonb))
     where c.shop_id = v_shop and c.id = v_client;
  end if;
end;
$function$;

grant execute on function public.attach_booking_extras_by_token(text, text, jsonb, text) to anon, authenticated;

-- Fallback for signed-in portal sessions that don't hold the appointment's manage token.
-- Auth model: possession of the client's server-issued session token (the same credential
-- the portal already uses to list/cancel appointments). Verifies the appointment belongs
-- to this client, then reuses the token write above so behavior stays identical.
create or replace function public.attach_visit_extras_by_client(p_shop text, p_client_id text, p_session text, p_appt_id text, p_note text, p_photos jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
begin
  if coalesce(p_session, '') = '' or coalesce(p_client_id, '') = '' then
    return;
  end if;
  -- session must match the client record (either storage shape: a single token or a token list)
  if not exists (
    select 1 from clients c
     where c.shop_id = p_shop and c.id = p_client_id
       and (c.data->>'sessionToken' = p_session
            or (jsonb_typeof(c.data->'sessionTokens') = 'array' and c.data->'sessionTokens' ? p_session))
  ) then
    return;
  end if;
  -- the appointment must belong to this client (self or a family member's booking on their account)
  select data->>'manageToken' into v_token
    from appointments
   where shop_id = p_shop and id = p_appt_id and data->>'clientId' = p_client_id;
  if coalesce(v_token, '') = '' then
    return; -- no token on the appointment (or not theirs) — nothing to do
  end if;
  perform attach_booking_extras_by_token(v_token, p_note, p_photos, null);
end;
$function$;

grant execute on function public.attach_visit_extras_by_client(text, text, text, text, text, jsonb) to anon, authenticated;

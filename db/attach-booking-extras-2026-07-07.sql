-- ── Save ALL post-booking confirmation extras in ONE reliable token write ────
-- The confirmation screen lets a client add a note, reference photos, and a $5
-- profile selfie AFTER the booking is written. A public (anon) client's React
-- state never syncs to the server — only explicit RPCs write — and the old path
-- used several RPCs, some of which weren't landing:
--   • the deployed save_booking_client merge dropped `photo` (selfie lost),
--   • the selfie write also carried the whole base64 gallery (bloated → failed),
--   • nothing ever wrote client.gallery, so uploaded photos vanished on reload.
--
-- This is ONE function, the same "possession of the appointment's private code =
-- may touch just this one appointment" model as the manage link and the $5-discount
-- write (which is proven working). It writes, atomically:
--   • APPOINTMENT → note + reference photos (by manageToken)
--   • CLIENT      → profile photo (the selfie)
--   • CLIENT      → gallery: each reference photo appended with a date, idempotently
--                   (re-saves replace this booking's entries, never duplicate)
-- It sends NO text/email and costs nothing. Run once in the Supabase SQL editor.

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

  -- 1) Appointment: note + reference photos. Capture its shop + client for the client writes.
  update appointments
     set data = data || jsonb_build_object(
           'note',      coalesce(p_note, ''),
           'hasNote',   (coalesce(p_note, '') <> ''),
           'photoData', v_photos,
           'photos',    v_count,
           'hasPhotos', (v_count > 0)
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

  -- 3) Client gallery — append each reference photo as a dated entry. Ids are scoped to this
  --    appointment's token so a re-save (debounce + "Update Appt") replaces this booking's entries
  --    instead of duplicating them, and never disturbs staff- or other-booking entries.
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

-- Public booking runs without a signed-in session; auth is possession of the private token.
grant execute on function public.attach_booking_extras_by_token(text, text, jsonb, text) to anon, authenticated;

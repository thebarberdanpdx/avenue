-- ── Save a public client's post-booking NOTE + reference PHOTOS to their appointment ──────────
-- Bug (audit #3): the note + inspiration photos a customer adds on the "You're in" screen are
-- added AFTER the booking is already written, and the public flow only updated the phone's local
-- state — never the server. So the barber never received them and they vanished on reload.
--
-- This function saves those details straight onto the appointment, matched by the appointment's own
-- private code (manageToken) — the exact same "possession of the code = access to just this one
-- appointment" model the /manage?t= link already uses. It touches NOTHING else and sends NO message,
-- so there is no cost and no text/email. Staff bookings already persist via the dashboard.
--
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).

create or replace function public.attach_booking_details_by_token(p_token text, p_note text, p_photos jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  v_count  int   := case when jsonb_typeof(v_photos) = 'array' then jsonb_array_length(v_photos) else 0 end;
begin
  if coalesce(p_token, '') = '' then
    return;
  end if;
  update appointments
     set data = data || jsonb_build_object(
           'note',      coalesce(p_note, ''),
           'hasNote',   (coalesce(p_note, '') <> ''),
           'photoData', v_photos,
           'photos',    v_count,
           'hasPhotos', (v_count > 0)
         )
   where data->>'manageToken' = p_token;
end;
$function$;

-- Public booking runs without a signed-in session, so the anon role must be able to call it
-- (auth is possession of the private token, checked inside the function).
grant execute on function public.attach_booking_details_by_token(text, text, jsonb) to anon, authenticated;

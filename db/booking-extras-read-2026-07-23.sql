-- ============================================================================
-- get_booking_extras_by_token — let a signed-in client RELOAD their own note +
-- photos for a booking they hold the manage token for.
-- ----------------------------------------------------------------------------
-- WHY: after booking, a client's note/selfie/reference-photos ARE saved to the
-- appointment (attach_booking_extras_by_token). But when they come back to their
-- home screen and tap "Edit photos & notes," the app reloads the appointment via
-- manage_lookup_by_token, which returns time/status/service only — NOT the note
-- or photos. So the edit sheet opened BLANK and the button read "Add," as if
-- they were entering notes for the first time. Photos are also stripped from the
-- device's local storage (to stay under the browser quota), so the SERVER is the
-- only place to get them back on a fresh load.
--
-- This is a NEW, additive, read-only function — it does not touch
-- manage_lookup_by_token or any booking/availability logic. It returns ONLY the
-- extras, and ONLY to whoever holds that appointment's manage token (the same
-- possession credential the manage-by-link page already uses), so it exposes
-- nothing a client can't already see for their own visit.
--
-- Run this WHOLE file once in Supabase -> SQL Editor -> Run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_booking_extras_by_token(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select jsonb_build_object(
    'note',      coalesce(a.data->>'note', ''),
    'hasNote',   coalesce((a.data->>'hasNote')::boolean, length(trim(coalesce(a.data->>'note',''))) > 0),
    'photos',    coalesce((a.data->>'photos')::int, jsonb_array_length(coalesce(a.data->'photoData','[]'::jsonb))),
    'hasPhotos', coalesce((a.data->>'hasPhotos')::boolean, jsonb_array_length(coalesce(a.data->'photoData','[]'::jsonb)) > 0),
    'photoData', coalesce(a.data->'photoData', '[]'::jsonb)
  )
  from appointments a
  where coalesce(p_token,'') <> ''
    and a.data->>'manageToken' = p_token
  limit 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_extras_by_token(text) TO anon, authenticated;

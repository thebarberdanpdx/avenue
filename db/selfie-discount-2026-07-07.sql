-- ── Apply / clear the $5 "profile selfie" discount on an appointment by its private code ──────────
-- The selfie ($5-off) offer now lives on the post-booking confirmation screen. When a client adds a
-- selfie there (after the booking is already written), the app records the $5 discount straight onto
-- their appointment, matched by the appointment's own private code (manageToken) — the same
-- "possession of the code = access to just this one appointment" model the /manage?t= link uses.
-- Staff then see the discount at checkout. It touches NOTHING else and sends NO message (no cost).
--
-- p_on = true  → set data.discount to the selfie $5 credit
-- p_on = false → remove the discount (client removed the selfie)
--
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).

create or replace function public.set_selfie_discount_by_token(p_token text, p_on boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(p_token, '') = '' then
    return;
  end if;
  if p_on then
    update appointments
       set data = data || jsonb_build_object(
             'discount', jsonb_build_object('id', 'selfie', 'name', 'Profile photo', 'type', 'amount', 'value', 5)
           )
     where data->>'manageToken' = p_token;
  else
    update appointments
       set data = data - 'discount'
     where data->>'manageToken' = p_token;
  end if;
end;
$function$;

-- Public booking runs without a signed-in session, so the anon role must be able to call it
-- (auth is possession of the private token, checked inside the function).
grant execute on function public.set_selfie_discount_by_token(text, boolean) to anon, authenticated;

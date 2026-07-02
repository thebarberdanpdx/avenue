-- ── Card-on-file persistence for returning clients ──────────────────────────
-- The booking flow calls supabase.rpc('save_client_card', …) right after a
-- booking to store the client's Stripe payment method on their profile, so the
-- NEXT time they book they're recognized and never re-enter the card. That read
-- path already works (verify_client_code / lookup_client_by_* return the full
-- clients.data blob, which includes savedCard) — but the WRITE function was
-- never committed here, so if it's missing on the database the save silently
-- fails and no client ever ends up with a card on file.
--
-- This defines it. It merges the card JSON into clients.data.savedCard, leaving
-- everything else on the record untouched. Runs as SECURITY DEFINER (bypasses
-- RLS, like the other client RPCs) and is idempotent — safe to run repeatedly.
--
-- DEPLOY: run this whole file in the Supabase SQL editor (same as the other
-- db/*.sql files). The web auto-deploy does NOT touch the database.

CREATE OR REPLACE FUNCTION public.save_client_card(p_shop text, p_client_id text, p_card jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out jsonb;
begin
  update clients
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('savedCard', p_card)
   where shop_id = p_shop and id = p_client_id
  returning data || jsonb_build_object('id', id) into v_out;

  return v_out; -- null if no such client row (nothing to update)
end;
$function$;

grant execute on function public.save_client_card(text, text, jsonb) to anon, authenticated;

-- ── Harden save_client_card: stop returning the full client record ──────────
-- Supersedes db/save-client-card-2026-07-01.sql.
--
-- THE HOLE: save_client_card is SECURITY DEFINER and granted to `anon`, and it
-- RETURNED `data || {id}` — the client's ENTIRE record (name, phone, email,
-- private notes, timeline, savedCard…). So an unauthenticated caller who knows
-- or guesses a client id could call
--   supabase.rpc('save_client_card', { p_shop:'victimshop', p_client_id:'…', p_card:'{}' })
-- with only the public anon key and get that client's whole profile back as the
-- return value — a card-write endpoint doubling as a PII read endpoint.
--
-- THE FIX: return a plain boolean (true = a row was updated, false = no such
-- client). The booking flow only checks `error` and updates its own local state
-- from the card payload it already holds (src/App.jsx ~4414), so it never used
-- the returned row — this change is invisible to the app and leaks nothing.
--
-- NOTE (still open, needs a booking-session proof): this does NOT yet stop an
-- anon caller from OVERWRITING a known client's savedCard with junk. Closing the
-- write side without breaking the post-booking save (which has no code round-trip)
-- needs the card write tied to the just-created booking/session — tracked
-- separately with the lookup_client_by_* lockdown.
--
-- DEPLOY: run this whole file in the Supabase SQL editor (same as the other
-- db/*.sql files). The web auto-deploy does NOT touch the database. Changing the
-- return type requires dropping the old function first (CREATE OR REPLACE cannot
-- change a function's return type).

drop function if exists public.save_client_card(text, text, jsonb);

CREATE FUNCTION public.save_client_card(p_shop text, p_client_id text, p_card jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows integer;
begin
  update clients
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('savedCard', p_card)
   where shop_id = p_shop and id = p_client_id;

  get diagnostics v_rows = row_count;  -- rows updated: >0 → found, 0 → no such client
  return v_rows > 0;
end;
$function$;

grant execute on function public.save_client_card(text, text, jsonb) to anon, authenticated;

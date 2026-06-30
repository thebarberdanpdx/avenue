-- ── Phone sign-in codes for returning clients ───────────────────────────────
-- Mirrors the email sign-in flow (verify_client_code / api/client-code.js) so a
-- returning client can verify by TEXT instead of email. Adds a `phone` column to
-- the existing code table and a phone-matching verify function with the same
-- 5-attempt brute-force cap and single-use burn as the email version.
--
-- DEPLOY: run this whole file in the Supabase SQL editor (same as db/hardening-*.sql).
-- It is idempotent — safe to run more than once.

alter table public.client_login_codes
  add column if not exists phone text;

-- Codes are stored with digits-only phone numbers; match on digits so formatting
-- (dashes, spaces, +1) never blocks a valid code.
CREATE OR REPLACE FUNCTION public.verify_client_code_phone(p_shop text, p_phone text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id text;
  v_out jsonb;
  v_attempts int;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  -- housekeeping: clear anything expired
  delete from client_login_codes where expires_at < now();

  -- brute-force guard: every verify attempt counts against the active code(s) for
  -- this number; after 5 wrong tries the code is burned (a fresh one must be
  -- requested, which is itself rate-limited in api/client-code.js).
  update client_login_codes
     set attempts = coalesce(attempts, 0) + 1
   where shop_id = p_shop
     and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
     and expires_at >= now();

  select max(coalesce(attempts, 0)) into v_attempts
    from client_login_codes
   where shop_id = p_shop
     and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
     and expires_at >= now();

  if coalesce(v_attempts, 0) > 5 then
    delete from client_login_codes
     where shop_id = p_shop and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits;
    return null;
  end if;

  select c.client_id into v_client_id
  from client_login_codes c
  where c.shop_id = p_shop
    and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits
    and c.code = p_code
    and c.expires_at >= now()
  order by c.created_at desc
  limit 1;

  if v_client_id is null then
    return null;
  end if;

  -- single use: burn every outstanding code for this number
  delete from client_login_codes
   where shop_id = p_shop and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits;

  select cl.data || jsonb_build_object('id', cl.id) into v_out
  from clients cl
  where cl.shop_id = p_shop and cl.id = v_client_id;

  return v_out;
end;
$function$;

grant execute on function public.verify_client_code_phone(text, text, text) to anon, authenticated;

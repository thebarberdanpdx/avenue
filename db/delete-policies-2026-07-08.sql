-- ── Allow signed-in staff to actually DELETE rows ─────────────────────────────
-- Deleting a (test) appointment looked like it worked, then the appointment came
-- back on the next refresh. Cause: the staff tables have INSERT/UPDATE/SELECT
-- policies but no DELETE policy — and in Supabase a .delete() with no DELETE
-- policy "succeeds" while removing ZERO rows. The app now detects that and shows
-- a save-failed banner; this adds the missing permission so deletes really delete.
--
-- Idempotent: each policy is created ONLY if the table has no DELETE policy yet,
-- so tables where deleting already works are left exactly as they are.
-- Scope: authenticated (signed-in staff) only — anonymous visitors still can't
-- delete anything. Run once in the Supabase SQL editor.

do $$
declare
  t text;
begin
  foreach t in array array['appointments', 'clients', 'waitlist', 'reviews', 'services', 'providers'] loop
    if to_regclass('public.' || t) is null then
      continue; -- table doesn't exist in this project — skip
    end if;
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t and cmd = 'DELETE'
    ) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (true)',
        'staff_delete_' || t, t
      );
      raise notice 'created DELETE policy on %', t;
    else
      raise notice 'DELETE policy already exists on % — untouched', t;
    end if;
  end loop;
end $$;

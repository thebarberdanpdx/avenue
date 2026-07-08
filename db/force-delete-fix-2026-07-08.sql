-- ── DELETE still blocked: diagnose + FORCE-fix + prove + purge, in one paste ──
-- The previous migration only added a DELETE policy when none existed. If a
-- DELETE (or restrictive) policy already existed with a USING clause that never
-- matches, or the GRANT layer lacks DELETE, deletes still silently remove 0 rows.
-- This script:
--   1. RECORDS the current policy + privilege state (so we can see what it was),
--   2. DROPS every DELETE policy on the staff tables and recreates a clean
--      "signed-in staff may delete" policy, plus an explicit GRANT DELETE,
--   3. PROVES it: inserts a probe row, deletes it AS the authenticated role,
--      and reports exactly how many rows that delete removed,
--   4. HARD-DELETES the test appointments (Test Golden / ZZ Claude E2E Test)
--      so the calendar is clean immediately.
-- The final SELECT shows everything it found and did. Run once; safe to re-run.

create temp table _diag (seq serial, step text, detail text);

-- 1+2) record state, then force-recreate DELETE policies + grants
do $$
declare
  t text; r record; n int;
begin
  foreach t in array array['appointments', 'clients', 'waitlist', 'reviews', 'services', 'providers'] loop
    if to_regclass('public.' || t) is null then
      insert into _diag(step, detail) values ('table ' || t, 'does not exist — skipped');
      continue;
    end if;

    -- record RLS + privilege state BEFORE
    insert into _diag(step, detail)
    select 'before · ' || t,
           'rls=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity ||
           ' grant_delete=' || has_table_privilege('authenticated', 'public.' || t, 'DELETE')
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = t;

    -- record EVERY existing policy (any command) so nothing is invisible
    insert into _diag(step, detail)
    select 'policy · ' || t,
           policyname || ' [' || cmd || '/' || permissive || '] roles=' || array_to_string(roles, ',') ||
           ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
      from pg_policies where schemaname = 'public' and tablename = t;

    -- drop ALL delete policies (whatever their name/clauses) and recreate a clean one
    for r in select policyname from pg_policies
              where schemaname = 'public' and tablename = t and cmd = 'DELETE' loop
      execute format('drop policy %I on public.%I', r.policyname, t);
      insert into _diag(step, detail) values ('dropped · ' || t, r.policyname);
    end loop;
    execute format('create policy %I on public.%I for delete to authenticated using (true)',
                   'staff_delete_' || t, t);
    execute format('grant delete on public.%I to authenticated', t);
    insert into _diag(step, detail) values ('fixed · ' || t, 'clean DELETE policy + GRANT DELETE in place');
  end loop;
end $$;

-- 3) PROVE it: a real delete as the authenticated role must remove the probe row
do $$
declare n int;
begin
  insert into appointments (id, shop_id, data)
  values ('zz_probe_delete', 'sanctuary', '{"status":"probe"}'::jsonb)
  on conflict (id) do nothing;
  begin
    execute 'set local role authenticated';
    delete from appointments where id = 'zz_probe_delete' and shop_id = 'sanctuary';
    get diagnostics n = row_count;
    execute 'reset role';
    insert into _diag(step, detail)
    values ('PROOF · delete as signed-in staff', n || ' row removed — ' || case when n = 1 then 'DELETES NOW WORK' else 'STILL BLOCKED' end);
  exception when others then
    execute 'reset role';
    insert into _diag(step, detail) values ('PROOF · delete as signed-in staff', 'ERROR: ' || sqlerrm);
  end;
  delete from appointments where id = 'zz_probe_delete'; -- cleanup either way
end $$;

-- 4) purge the TEST appointments right now (appointments only — the test client
--    records themselves are kept, so the pending reminder test still works)
do $$
declare n int;
begin
  delete from appointments a
   where a.shop_id = 'sanctuary'
     and (a.data->>'name' in ('Test Golden', 'ZZ Claude E2E Test')
          or a.data->>'clientId' in (
              select c.id from clients c
               where c.shop_id = 'sanctuary'
                 and c.data->>'name' in ('Test Golden', 'ZZ Claude E2E Test')));
  get diagnostics n = row_count;
  insert into _diag(step, detail) values ('purged test appointments', n || ' removed from the calendar');
end $$;

select step, detail from _diag order by seq;

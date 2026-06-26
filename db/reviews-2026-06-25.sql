-- ─────────────────────────────────────────────────────────────────────────────
-- Vero — Customer Reviews feature: table + RPCs (2026-06-25)
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this ONCE in the Supabase SQL Editor (project iufgznminbujcabqeesk) to turn
-- on the reviews feature. It is NOT auto-applied from the repo — this file is the
-- version-controlled record (see DATABASE.md). Safe to re-run (idempotent).
--
-- What it creates:
--   1. reviews table  { id, shop_id, data(jsonb), created_at }  — same shape as the
--      other list tables. RLS is CLONED from the waitlist table so staff get the
--      exact same shop-scoped access (no anon reads); public writes go through the
--      SECURITY DEFINER RPCs below, which bypass RLS by design.
--   2. review_lookup_by_token(p_token)        — public review page reads safe context
--   3. submit_review_by_token(...)            — public review page writes the review
--   4. get_published_reviews(p_shop)          — storefront reads published reviews
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Table ─────────────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id          text primary key,
  shop_id     text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists reviews_shop_idx on public.reviews (shop_id);

alter table public.reviews enable row level security;

-- Clone every RLS policy from `waitlist` onto `reviews` (identical staff-only model:
-- a signed-in member sees/edits only their own shop's rows; anon gets nothing). This
-- copies the EXACT membership predicate without hard-coding it here, so reviews can
-- never be more permissive than the already-vetted waitlist table.
do $$
declare p record; n int := 0;
begin
  for p in select * from pg_policies where schemaname = 'public' and tablename = 'waitlist' loop
    execute format('drop policy if exists %I on public.reviews', p.policyname || '_rev');
    execute format(
      'create policy %I on public.reviews as %s for %s to %s %s %s',
      p.policyname || '_rev',
      p.permissive,
      p.cmd,
      array_to_string(p.roles, ','),
      case when p.qual       is not null then 'using ('      || p.qual       || ')' else '' end,
      case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end
    );
    n := n + 1;
  end loop;
  if n = 0 then
    raise notice 'No waitlist policies found to clone — reviews has RLS ON with NO policies (staff load will be blocked). Add policies manually.';
  else
    raise notice 'Cloned % waitlist policy(ies) onto reviews.', n;
  end if;
end $$;


-- ── 2. review_lookup_by_token — public review page reads safe appointment context ─
-- Token possession (the unguessable manageToken from the email link) scopes to ONE
-- appointment, exactly like manage_lookup_by_token. Returns only what the client
-- already knows about their own visit, plus the shop's Google link + whether they
-- already reviewed. No emails/phones/other clients.
create or replace function public.review_lookup_by_token(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_appt record;
  v_shop text;
  v_prov text;
  v_google text;
  v_already boolean;
  v_date text;
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false); end if;
  select id, shop_id, data into v_appt from appointments where data->>'manageToken' = p_token limit 1;
  if v_appt.id is null then return jsonb_build_object('ok', false); end if;
  v_shop := v_appt.shop_id;
  select data->>'name' into v_prov from providers where shop_id = v_shop and data->>'id' = v_appt.data->>'providerId' limit 1;
  select exists(select 1 from reviews where shop_id = v_shop and data->>'apptId' = v_appt.id) into v_already;
  select settings->'reviews'->>'googleReviewUrl' into v_google from shops where id = v_shop;
  begin v_date := to_char((v_appt.data->>'bookedFor')::timestamptz, 'Mon DD'); exception when others then v_date := null; end;
  return jsonb_build_object(
    'ok', true,
    'provider', v_prov,
    'service', coalesce(v_appt.data->>'serviceName', v_appt.data->>'title'),
    'date', v_date,
    'already', coalesce(v_already, false),
    'google', coalesce(v_google, '')
  );
end; $$;


-- ── 3. submit_review_by_token — public review page writes one review per appt ─────
-- Rating clamped 1–5; comment/name length-capped; clientId/providerId taken from the
-- STORED appointment (never caller-supplied). One review per appointment. Lands as
-- 'pending' for the owner to approve (unless the shop opted into auto-publish 4–5★).
create or replace function public.submit_review_by_token(p_token text, p_rating int, p_comment text, p_name text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_appt record;
  v_shop text;
  v_prov text;
  v_google text;
  v_auto boolean;
  v_id text;
  v_status text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then return jsonb_build_object('ok', false); end if;
  select id, shop_id, data into v_appt from appointments where data->>'manageToken' = p_token limit 1;
  if v_appt.id is null then return jsonb_build_object('ok', false); end if;
  v_shop := v_appt.shop_id;
  if exists(select 1 from reviews where shop_id = v_shop and data->>'apptId' = v_appt.id) then
    return jsonb_build_object('ok', false, 'already', true);
  end if;
  select data->>'name' into v_prov from providers where shop_id = v_shop and data->>'id' = v_appt.data->>'providerId' limit 1;
  select coalesce(settings->'reviews'->>'googleReviewUrl', ''),
         coalesce((settings->'reviews'->>'autoApprove')::boolean, false)
    into v_google, v_auto from shops where id = v_shop;
  v_status := case when v_auto and p_rating >= 4 then 'published' else 'pending' end;
  v_id := 'rev_' || v_appt.id || '_' || floor(extract(epoch from now()))::text;
  insert into reviews(id, shop_id, data) values (
    v_id, v_shop,
    jsonb_build_object(
      'id', v_id,
      'apptId', v_appt.id,
      'clientId', v_appt.data->>'clientId',
      'providerId', v_appt.data->>'providerId',
      'providerName', v_prov,
      'serviceName', coalesce(v_appt.data->>'serviceName', v_appt.data->>'title'),
      'rating', p_rating,
      'comment', left(coalesce(p_comment, ''), 1000),
      'displayName', left(nullif(trim(coalesce(p_name, '')), ''), 60),
      'status', v_status,
      'featured', false,
      'createdAt', v_now,
      'publishedAt', case when v_status = 'published' then v_now else null end
    )
  );
  return jsonb_build_object('ok', true, 'google', v_google);
end; $$;


-- ── 4. get_published_reviews — storefront social proof (safe public fields only) ──
create or replace function public.get_published_reviews(p_shop text)
 returns jsonb language sql security definer set search_path to 'public' stable as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rating', (data->>'rating')::int,
      'comment', data->>'comment',
      'displayName', data->>'displayName',
      'featured', coalesce((data->>'featured')::boolean, false),
      'publishedAt', data->>'publishedAt'
    )
    order by coalesce((data->>'featured')::boolean, false) desc, data->>'publishedAt' desc
  ), '[]'::jsonb)
  from reviews
  where shop_id = p_shop and data->>'status' = 'published';
$$;


-- ── Grants: these RPCs are callable by the public booking page (anon) + staff ─────
grant execute on function public.review_lookup_by_token(text) to anon, authenticated;
grant execute on function public.submit_review_by_token(text, int, text, text) to anon, authenticated;
grant execute on function public.get_published_reviews(text) to anon, authenticated;

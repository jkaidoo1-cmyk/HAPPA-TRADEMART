-- 007_rls_lockdown.sql
-- The canonical row-level-security state for every table in `public`.
--
-- POSTURE
--   The browser never talks to Postgres. Every read and write goes through
--   api/index.js or server.js using SUPABASE_KEY, which is the **service_role**
--   key (service_role has the BYPASSRLS attribute), and HANDOFF.md §7 forbids
--   shipping the anon key. There is no Supabase client in js/, no Realtime
--   subscription, no Edge Function.
--
--   Therefore the correct policy set for anon/authenticated is: NONE.
--   RLS on, zero policies, no grants = default deny for everyone except the
--   server. Nothing in this file creates a policy — that is the whole point. If
--   a future feature genuinely needs a browser-side client, add a narrowly
--   scoped policy for that one table and extend test/rls-coverage.test.js
--   alongside it; do not reach for `using (true)`.
--
-- WHAT THIS REPLACES
--   * 005_security_hardening.sql created `anon_read ... using (true)` on eight
--     catalog tables (including `settings`, which holds platform config) and
--     only dropped policies under the literal name `anon_read` — a policy
--     renamed by hand would survive.
--   * 001_push_subscriptions.sql created `"Service role full access" FOR ALL
--     USING (true) WITH CHECK (true)` with no `to` clause, i.e. PUBLIC. service_role
--     already bypasses RLS, so that policy granted nobody anything they needed
--     and granted every anonymous visitor full read/write on push endpoints.
--   * Neither migration revoked anything from anon/authenticated, so PostgREST
--     default grants plus any leftover GRANT left tables reachable even with
--     RLS on.
--
-- RUN ORDER: after 000-006. Re-runnable: every statement is idempotent.
--
-- VERIFY AFTER RUNNING:
--     select * from public.rls_audit();
--   Every row must read rls_enabled = true, policies = 0, anon_grants = ''.

-- ── 0. Roles ───────────────────────────────────────────────────────────────
-- Supabase already has anon/authenticated/service_role; a self-hosted Postgres
-- does not, and `revoke ... from anon` would then abort the whole script. A
-- missing CREATE privilege is not fatal — the sweep below notices and carries on.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
exception when others then
  raise notice 'roles: % — the revokes below will skip any role that does not exist', sqlerrm;
end $$;

-- ── 1. Sweep every table, every sequence ───────────────────────────────────
do $$
declare
  t record;
  p record;
begin
  for t in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'S')
     order by c.relkind, c.relname
  loop
    if t.relkind = 'S' then
      -- Sequences: an anon-usable sequence leaks row counts and lets a caller
      -- advance the sequence of an id column.
      begin
        execute format('revoke all on sequence public.%I from public, anon, authenticated', t.relname);
      exception when others then
        raise notice 'sequence %: %', t.relname, sqlerrm;
      end;
    else
      -- Enable RLS. An extension-owned table (PostGIS spatial_ref_sys, …)
      -- must not abort the run.
      begin
        execute format('alter table public.%I enable row level security', t.relname);
      exception when others then
        raise notice 'enable RLS on %: %', t.relname, sqlerrm;
      end;

      -- Drop EVERY policy on the table, whatever it is called and whatever
      -- role it targets. 005 only ever looked for the name `anon_read`.
      for p in
        select policyname from pg_policies
         where schemaname = 'public' and tablename = t.relname
      loop
        begin
          execute format('drop policy if exists %I on public.%I', p.policyname, t.relname);
        exception when others then
          raise notice 'drop policy % on %: %', p.policyname, t.relname, sqlerrm;
        end;
      end loop;

      -- Deny-by-default at the grant layer too: RLS only decides WHICH rows a
      -- role may see, not whether it may talk to the table at all.
      begin
        execute format('revoke all on table public.%I from public, anon, authenticated', t.relname);
      exception when others then
        raise notice 'revoke on %: %', t.relname, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- ── 2. Functions (RPC) ─────────────────────────────────────────────────────
-- Postgres grants EXECUTE on a new function to PUBLIC by default, so
-- /rest/v1/rpc/wallet_move was callable with the anon key. It cannot succeed
-- now that RLS denies every row, but a caller should never reach the body.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    exception when others then
      raise notice 'revoke execute on %: %', f.signature, sqlerrm;
    end;
  end loop;

  -- The server's own RPCs keep working.
  begin
    execute 'grant execute on all functions in schema public to service_role';
  exception when others then
    raise notice 'grant execute to service_role: %', sqlerrm;
  end;
end $$;

-- ── 3. Objects created later ───────────────────────────────────────────────
-- These apply to objects created by the role running this migration (postgres
-- on Supabase), which is what creates tables here in practice: a future
-- `create table` starts closed instead of depending on someone remembering.
alter default privileges in schema public revoke all on tables
  from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences
  from public, anon, authenticated;
alter default privileges in schema public revoke all on functions
  from public, anon, authenticated;

-- ── 4. The contract: every table this app owns ─────────────────────────────
-- Step 1 is generic; this list is what the app is allowed to expect. A table
-- added to the app without being added here (and to test/rls-coverage.test.js)
-- fails CI. Missing tables only raise a notice, so running this before an
-- earlier migration is harmless.
do $$
declare
  t text;
  expected text[] := array[
    'users', 'stores', 'storefronts', 'products', 'orders', 'packages',
    'wallet_transactions', 'notifications', 'order_notifications',
    'ad_campaigns', 'services', 'service_orders', 'settings', 'reviews',
    'delivery_rates', 'referrals', 'platform_revenue', 'support_tickets',
    'push_subscriptions', 'audit_logs', 'otps', 'upload_chunks', 'categories'
  ];
begin
  foreach t in array expected loop
    if not exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relkind in ('r', 'p')
    ) then
      raise notice 'public.% does not exist yet — run the earlier migrations (RLS posture is still deny-by-default for it)', t;
    end if;
  end loop;
end $$;

-- ── 5. Audit hook ──────────────────────────────────────────────────────────
-- One query the operator (or a support ticket) can run to see the real state
-- of the database instead of trusting this file.
--   select * from public.rls_audit();  -- every row must show rls_enabled = true,
--                                    -- policies = 0, anon_grants = ''
create or replace function public.rls_audit()
returns table (
  table_name   text,
  rls_enabled  boolean,
  policies     integer,
  anon_grants  text
)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.relname::text,
         c.relrowsecurity,
         coalesce((
           select count(*)::int
             from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
         ), 0),
         coalesce((
           select string_agg(distinct g.grantee || ':' || g.privilege_type, ', ' order by g.grantee || ':' || g.privilege_type)
             from information_schema.role_table_grants g
            where g.table_schema = 'public'
              and g.table_name = c.relname
              and g.grantee in ('anon', 'authenticated', 'PUBLIC')
         ), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
   order by c.relname;
$$;

revoke all on function public.rls_audit() from public, anon, authenticated;
grant execute on function public.rls_audit() to service_role;

-- NOTE: FORCE ROW LEVEL SECURITY is deliberately NOT set. It would also bind
-- the table owner, which on Supabase is `postgres` — that is the role the SQL
-- editor uses, so every manual query would silently return zero rows. service_role
-- bypasses RLS either way, and the app only ever connects as service_role.

-- ── 6. Bootstrap hook ───────────────────────────────────────────────────────
-- api/index.js used to auto-create push_subscriptions through `rpc('exec_sql',\n-- …)`. No migration ever defines exec_sql (it cannot be defined safely: Postgres\n-- grants EXECUTE on a new function to PUBLIC by default, and a general SQL\n-- executor is exactly the privilege escalation we are removing above), so that\n-- call has always failed silently, and the SQL it carried was invalid anyway\n-- (`CREATE POLICY IF NOT EXISTS` does not exist in Postgres) and permissive\n-- (`FOR ALL USING (true)` to PUBLIC).\n--\n-- This replaces it with ONE narrow, idempotent function: it creates or repairs\n-- this single table and nothing else, and only service_role may call it.\ncreate or replace function public.ensure_push_subscriptions()\nreturns boolean\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_catalog\nas $$\ndeclare\n  p record;\nbegin\n  create table if not exists public.push_subscriptions (\n    id         text primary key,\n    user_id    text default 'anonymous',\n    endpoint   text,\n    keys       jsonb default '{}'::jsonb,\n    created_at timestamptz default now()\n  );\n\n  -- Databases that ran the old 001 first have `endpoint` as the PK and no id,\n  -- which is the column the code actually writes.\n  alter table public.push_subscriptions add column if not exists id text;\n  update public.push_subscriptions\n     set id = endpoint\n   where (id is null or id = '') and endpoint is not null;\n\n  create unique index if not exists push_subscriptions_endpoint_uniq\n    on public.push_subscriptions (endpoint);\n  create unique index if not exists push_subscriptions_id_uniq\n    on public.push_subscriptions (id);\n  create index if not exists push_subscriptions_user_idx\n    on public.push_subscriptions (user_id);\n\n  -- Close it, then take away the PUBLIC policy 001 left behind.\n  alter table public.push_subscriptions enable row level security;\n  for p in\n    select policyname from pg_policies\n     where schemaname = 'public' and tablename = 'push_subscriptions'\n  loop\n    execute format('drop policy if exists %I on public.push_subscriptions', p.policyname);\n  end loop;\n  revoke all on table public.push_subscriptions from public, anon, authenticated;\n  return true;\nend;\n$$;

revoke all on function public.ensure_push_subscriptions() from public, anon, authenticated;
grant execute on function public.ensure_push_subscriptions() to service_role;
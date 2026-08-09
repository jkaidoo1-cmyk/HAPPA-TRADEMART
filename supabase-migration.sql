-- ═════════════════════════════════════════════════════════════════════════════
--  HAPPA TRADEMART — Supabase migration
--  How to run: open your Supabase Dashboard → SQL Editor → New query,
--  paste this whole file, then click Run. (It is safe to run more than once.)
--
--  These tables are written by the app but were missing from this Supabase
--  project. Without them, writes fell back to a temporary store that other
--  server instances can't see — which is why a submitted support ticket never
--  appeared for the admin even though the notification came through, and why
--  platform-fee / subscription revenue never showed in the admin charts.
-- ═════════════════════════════════════════════════════════════════════════════

-- Support tickets (js/support.js)
create table if not exists public.support_tickets (
  id          text primary key,
  user_id     text,
  user_name   text,
  user_email  text,
  user_role   text,
  subject     text,
  category    text,
  priority    text,
  status      text,
  message     text,
  messages    jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Platform revenue records (orders, storefront fees, subscriptions)
create table if not exists public.platform_revenue (
  id          text primary key,
  source      text,
  amount      numeric default 0,
  reference   text,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists platform_revenue_created_at_idx
  on public.platform_revenue (created_at);

-- Product categories (read by the catalog pages)
create table if not exists public.categories (
  id         text primary key,
  name       text,
  created_at timestamptz default now()
);

-- These tables are left with row-level security disabled (the default), so the
-- app's API key can read/write them like the rest of the project's tables.

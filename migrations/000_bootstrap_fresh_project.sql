-- 000_bootstrap_fresh_project.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- NEW-PROJECT BOOTSTRAP: creates every table the Happa servers read/write on a
-- brand-new (empty) Supabase project. The repo's migrations 001–006 are
-- incremental patches that assume the original schema already exists; this file
-- is that missing base, reconstructed from the code itself:
--   • TABLE_COLUMNS in api/index.js (the per-table write/read allowlist),
--   • the extra columns migration 005's wallet_move writes
--     (balance_before/balance_after/payment_method/status/note/network/
--      account_number/reviewed_by/package_id),
--   • observed row shapes in the local db.json snapshot.
--
-- Run order on the new project:  000 → 005 → 006. Nothing else.
--   001/003/004 are SUPERSEDED by this file (their columns/tables are included
--   here, and 001's shape lacks the `id` column the code writes while its
--   policy opens push_subscriptions to anon — do not run it).
--   002 is a data cleanup for the retired DB — meaningless on empty tables.
--   005 supplies RLS on every table, otps, upload_chunks and wallet_move.
--   006 is a no-op on empty data but is idempotent and safe to run.
--
-- Design rules, deliberately conservative:
--   • text primary keys — the app generates string ids itself (generateId()).
--   • almost nothing NOT NULL: the app has written partial rows for years and
--     writeWithCandidates() retries schema errors, but a NOT NULL violation is
--     fatal. Columns carry defaults only where the app expects them.
--   • jsonb for every array/object field (images, keywords, items, messages,
--     keys, extra, …): supabase-js sends JS arrays/objects straight through.
--   • numeric for money, integer for counters, boolean for flags, timestamptz
--     for timestamps (the app sends ISO strings — Postgres casts them).
--   • no RLS here: migration 005 enables it everywhere and creates the anon
--     catalog-read policies. Do not skip 005.
--   • no data: per product decision the new project starts empty. Create the
--     admin/vendor accounts through the app afterwards.

-- ── users ────────────────────────────────────────────────────────────────────
create table if not exists users (
  id                        text primary key,
  name                      text,
  email                     text,
  phone                     text,
  password_hash             text,
  role                      text default 'buyer',
  status                    text,
  location                  text,
  wallet_balance            numeric default 0,
  referral_code             text,
  referred_by               text,
  registered_at             timestamptz,
  created_at                timestamptz default now(),
  updated_at                timestamptz,
  is_verified               boolean default false,
  id_verified               boolean default false,
  rendor_display_name       text,
  rendor_service_cat        text,
  rendor_bio                text,
  rendor_starting_price     numeric,
  rendor_tags               jsonb,
  rendor_whatsapp           text,
  rendor_email              text,
  rendor_instagram          text,
  rendor_twitter            text,
  rendor_facebook           text,
  rendor_website            text,
  rendor_contact_other      text,
  rendor_sub_status         text,
  rendor_sub_expiry         timestamptz,
  rendor_sub_plan           text,
  rendor_sub_price_override numeric,
  avatar_url                text,
  extra                     jsonb default '{}'::jsonb,
  referral_earnings         numeric default 0,
  referral_count            integer default 0,
  preferred_store_name      text,
  preferred_store_cat       text,
  preferred_store_desc      text,
  preferred_store_kws       jsonb,
  sub_request_status        text,
  sub_quote_monthly         numeric,
  sub_quote_quarterly       numeric,
  sub_quote_biannual        numeric,
  sub_payment_status        text,
  sub_payment_months        integer,
  sub_payment_amount        double precision,
  sub_paid_at               text,
  sub_payment_ref           text,
  push_enabled              boolean default true
);
create index if not exists users_email_idx      on users (email);
create index if not exists users_phone_idx      on users (phone);
create index if not exists users_referral_idx   on users (referral_code);

-- ── stores ───────────────────────────────────────────────────────────────────
create table if not exists stores (
  id                  text primary key,
  name                text,
  slug                text,
  vendor_id           text,
  category            text,
  location            text,
  status              text,
  logo_url            text,
  banner_url          text,
  description         text,
  keywords            jsonb,
  avg_rating          numeric default 0,
  review_count        integer default 0,
  total_sales         numeric default 0,
  total_orders        integer default 0,
  store_price         numeric default 0,
  is_paid             boolean default false,
  storefront_status   text,
  slogan              text,
  primary_color       text,
  secondary_color     text,
  tertiary_color      text,
  theme               text,
  font_family         text,
  hero_image_url      text,
  gallery_images      jsonb,
  business_hours      jsonb,
  return_policy       text,
  whatsapp            text,
  instagram           text,
  facebook            text,
  twitter             text,
  subscription_plan   text,
  subscription_status text,
  subscription_start  timestamptz,
  subscription_end    timestamptz,
  subscription_months integer,
  subscription_method text,
  created_at          timestamptz default now(),
  updated_at          timestamptz,
  extra               jsonb default '{}'::jsonb
);
create index if not exists stores_vendor_idx on stores (vendor_id);
create index if not exists stores_slug_idx   on stores (slug);
create index if not exists stores_cat_idx    on stores (category);

-- ── products ─────────────────────────────────────────────────────────────────
create table if not exists products (
  id               text primary key,
  store_id         text,
  vendor_id        text,
  name             text,
  category         text,
  price            numeric,
  original_price   numeric,
  stock_qty        integer default 0,
  images           jsonb,
  is_flash_sale    boolean default false,
  flash_pct        numeric,
  status           text,
  is_available     boolean default true,
  description      text,
  location         text,
  avg_rating       numeric default 0,
  review_count     integer default 0,
  total_sold       integer default 0,
  weight_kg        numeric,
  allow_buyer_note boolean default false,
  buyer_note_prompt text,
  tags             jsonb,
  commission_pct   numeric,
  campus           text,
  flash_sale_end   timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz,
  extra            jsonb default '{}'::jsonb
);
create index if not exists products_store_idx on products (store_id);
create index if not exists products_cat_idx   on products (category);

-- ── orders (single-item legacy shape) ────────────────────────────────────────
create table if not exists orders (
  id                text primary key,
  buyer_id          text,
  vendor_id         text,
  store_id          text,
  product_id        text,
  product_name      text,
  quantity          integer,
  unit_price        numeric,
  subtotal          numeric,
  platform_fee      numeric,
  delivery_fee      numeric,
  total             numeric,
  status            text,
  payment_method    text,
  delivery_name     text,
  delivery_phone    text,
  delivery_address  text,
  delivery_location text,
  package_code      text,
  notes             text,
  items             jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz,
  extra             jsonb default '{}'::jsonb
);
create index if not exists orders_buyer_idx  on orders (buyer_id);
create index if not exists orders_vendor_idx on orders (vendor_id);
create index if not exists orders_store_idx  on orders (store_id);

-- ── packages (consolidated cart/checkouts) ───────────────────────────────────
create table if not exists packages (
  id                text primary key,
  code              text,
  buyer_id          text,
  vendor_id         text,
  store_id          text,
  items             jsonb,
  status            text,
  total             numeric,
  delivery_fee      numeric,
  payment_method    text,
  delivery_name     text,
  delivery_phone    text,
  delivery_address  text,
  delivery_location text,
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz,
  extra             jsonb default '{}'::jsonb
);
create index if not exists packages_buyer_idx on packages (buyer_id);
create index if not exists packages_vendor_idx on packages (vendor_id);
create index if not exists packages_code_idx   on packages (code);

-- ── wallet ledger (full shape incl. the columns 005's wallet_move writes) ───
create table if not exists wallet_transactions (
  id             text primary key,
  user_id        text,
  type           text,
  amount         numeric,
  balance_before numeric,
  balance_after  numeric,
  description    text,
  reference      text,
  payment_method text default 'system',
  status         text default 'completed',
  note           text default '',
  network        text default '',
  account_number text default '',
  reviewed_by    text default '',
  package_id     text,
  created_at     timestamptz default now(),
  updated_at     timestamptz,
  extra          jsonb default '{}'::jsonb
);
create index if not exists wallet_txns_user_idx on wallet_transactions (user_id, created_at desc);
create index if not exists wallet_txns_ref_idx  on wallet_transactions (reference);

-- ── notifications ────────────────────────────────────────────────────────────
create table if not exists notifications (
  id         text primary key,
  user_id    text,
  type       text,
  title      text,
  message    text,
  is_read    boolean default false,
  action_url text,
  created_at timestamptz default now(),
  updated_at timestamptz,
  extra      jsonb default '{}'::jsonb
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- order_notifications is referenced by the access layer; same shape, kept so a
-- future write path cannot 404. No code writes it today.
create table if not exists order_notifications (
  id         text primary key,
  user_id    text,
  type       text,
  title      text,
  message    text,
  is_read    boolean default false,
  action_url text,
  created_at timestamptz default now(),
  updated_at timestamptz,
  extra      jsonb default '{}'::jsonb
);

-- ── ad campaigns ─────────────────────────────────────────────────────────────
create table if not exists ad_campaigns (
  id          text primary key,
  vendor_id   text,
  store_id    text,
  title       text,
  image_url   text default '',
  link        text default '',
  placement   text default 'home',
  budget      numeric default 0,
  spent       numeric default 0,
  impressions integer default 0,
  clicks      integer default 0,
  status      text,
  start_date  timestamptz,
  end_date    timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz,
  extra       jsonb default '{}'::jsonb
);
create index if not exists ad_campaigns_vendor_idx on ad_campaigns (vendor_id);

-- ── rendor services ──────────────────────────────────────────────────────────
create table if not exists services (
  id          text primary key,
  rendor_id   text,
  title       text,
  category    text,
  description text,
  price       numeric,
  image_url   text,
  status      text,
  created_at  timestamptz default now(),
  updated_at  timestamptz,
  extra       jsonb default '{}'::jsonb
);
create index if not exists services_rendor_idx on services (rendor_id);

create table if not exists service_orders (
  id         text primary key,
  service_id text,
  rendor_id  text,
  buyer_id   text,
  title      text,
  amount     numeric,
  status     text,
  notes      text,
  created_at timestamptz default now(),
  updated_at timestamptz,
  extra      jsonb default '{}'::jsonb
);
create index if not exists service_orders_buyer_idx  on service_orders (buyer_id);
create index if not exists service_orders_rendor_idx on service_orders (rendor_id);

-- ── settings (values are strings; the app reads/writes text) ─────────────────
create table if not exists settings (
  id         text primary key,
  key        text,
  value      text,
  label      text,
  type       text,
  updated_at timestamptz
);
create index if not exists settings_key_idx on settings (key);

-- ── reviews ──────────────────────────────────────────────────────────────────
create table if not exists reviews (
  id         text primary key,
  product_id text,
  store_id   text,
  buyer_id   text,
  rating     integer,
  comment    text,
  created_at timestamptz default now()
);
create index if not exists reviews_product_idx on reviews (product_id);
create index if not exists reviews_store_idx   on reviews (store_id);

-- ── delivery rates ───────────────────────────────────────────────────────────
create table if not exists delivery_rates (
  id          text primary key,
  origin      text,
  destination text,
  base_rate   numeric,
  per_kg_rate numeric,
  est_days    integer,
  is_local    boolean default false,
  created_at  timestamptz default now()
);

-- ── referrals ────────────────────────────────────────────────────────────────
create table if not exists referrals (
  id         text primary key,
  referrer_id text,
  referred_id text,
  reward     numeric default 0,
  status     text,
  created_at timestamptz default now()
);
create index if not exists referrals_referrer_idx on referrals (referrer_id);

-- ── platform revenue ─────────────────────────────────────────────────────────
create table if not exists platform_revenue (
  id          text primary key,
  source      text,
  amount      numeric,
  reference   text,
  description text,
  created_at  timestamptz default now(),
  extra       jsonb default '{}'::jsonb
);

-- ── support tickets ──────────────────────────────────────────────────────────
create table if not exists support_tickets (
  id         text primary key,
  user_id    text,
  user_name  text,
  user_email text,
  user_role  text,
  subject    text,
  category   text,
  priority   text,
  status     text,
  message    text,
  messages   jsonb,
  assigned_to text,
  created_at timestamptz default now(),
  updated_at timestamptz,
  extra      jsonb default '{}'::jsonb
);
create index if not exists support_tickets_user_idx on support_tickets (user_id);

-- ── storefronts (public storefront pages) ────────────────────────────────────
create table if not exists storefronts (
  id                  text primary key,
  store_id            text,
  vendor_id           text,
  status              text,
  url_slug            text,
  name                text,
  theme               text,
  font_family         text,
  slogan              text,
  about_us            text,
  logo_url            text,
  banner_url          text,
  primary_color       text,
  secondary_color     text,
  tertiary_color      text,
  business_hours      jsonb,
  shipping_policy     text,
  return_policy       text,
  whatsapp_number     text,
  facebook_url        text,
  instagram_url       text,
  youtube_url         text,
  meta_description    text,
  subscription_plan   text,
  subscription_status text,
  subscription_start  timestamptz,
  subscription_end    timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz
);
create index if not exists storefronts_store_idx on storefronts (store_id);
create index if not exists storefronts_slug_idx  on storefronts (url_slug);

-- ── push subscriptions ───────────────────────────────────────────────────────
-- Fuller shape than migration 001 (which omits `id`, a column the code writes).
-- RLS is enabled here with NO policies: subscriptions carry push credentials,
-- so only the server (service_role, which bypasses RLS) may touch them.
create table if not exists push_subscriptions (
  id         text primary key,
  user_id    text default 'anonymous',
  endpoint   text,
  keys       jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create unique index if not exists push_subscriptions_endpoint_uniq on push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;

-- ── audit log (both servers mirror here) ─────────────────────────────────────
create table if not exists audit_logs (
  id         text primary key,
  actor_id   text,
  actor_role text,
  action     text,
  "table"    text,
  target_id  text,
  detail     jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);

-- otps, upload_chunks and the RLS sweep come from migration 005 — nothing else pending.

-- 005_security_hardening.sql
-- Audit items: #1 (OTP), #5 (wallet atomicity), #7 (secrets/RLS), #8 (passwords),
-- #15 (settlement), cross-cutting (RLS on every table).
-- Run in the Supabase SQL editor. Statements are idempotent where possible.

-- ── #1: one-time passcodes for phone verification ─────────────────────────
-- Shared by every serverless instance: a code issued by one instance must be
-- verifiable by another, and the attempt counter must survive cold starts.
create table if not exists otps (
  id text primary key,
  user_id text not null,
  purpose text not null default 'verify_phone',
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists otps_user_purpose_idx on otps (user_id, purpose, created_at desc);

-- ── #5/#15: wallet ledger integrity ───────────────────────────────────────
-- The ledger now links rows to the package they settle, so a refund can prove
-- whether the same package was already released.
alter table wallet_transactions add column if not exists package_id text;
create index if not exists wallet_txns_package_idx on wallet_transactions (package_id);
-- Settlement state on the package itself: pending → released | refunded. This
-- is what stops an order being paid out to the vendor AND refunded to the buyer.
alter table packages add column if not exists settlement_status text;

-- A retried/duplicated request must not create a second ledger row: the
-- (user_id, type, reference) triple is the idempotency key. Rows written before
-- this migration may share an empty reference (several earnings for one user),
-- which would make the index creation fail and silently drop later payouts —
-- so backfill every blank reference with a unique value first.
update wallet_transactions
   set reference = 'LEGACY-' || id
 where reference is null or reference = '';

-- Historical double-writes can leave two rows sharing one non-blank triple
-- (the old payout code used a timestamp-only reference). Those would make the
-- unique index fail to build, so suffix the extras first — the money already
-- moved, only the idempotency key needs to become unique.
with dups as (
  select id,
         row_number() over (partition by user_id, type, reference order by created_at nulls first, id) as rn
    from wallet_transactions
   where reference is not null and reference <> ''
)
update wallet_transactions w
   set reference = w.reference || '-DUP' || d.rn
  from dups d
 where w.id = d.id and d.rn > 1;

create unique index if not exists wallet_txns_idem_idx
  on wallet_transactions (user_id, type, reference);

-- The database itself refuses a negative balance even if app code has a bug.
alter table users drop constraint if exists users_wallet_balance_nonneg;
alter table users add constraint users_wallet_balance_nonneg
  check (wallet_balance >= 0) not valid;
alter table users validate constraint users_wallet_balance_nonneg;

-- #5: atomic balance move — lock the user row, write the ledger row and update
-- the balance in ONE transaction. Call via supabase.rpc('wallet_move', …).
-- Every server-side balance change goes through this; the extra jsonb carries
-- ledger metadata (note/network/account_number/reviewed_by/package_id/status).
create or replace function wallet_move(
  p_user_id text,
  p_type text,
  p_amount numeric,
  p_reference text,
  p_description text default '',
  p_payment_method text default 'system',
  p_extra jsonb default '{}'::jsonb,
  -- The ledger MAGNITUDE vs. the signed balance change. A withdrawal records a
  -- positive amount but removes money, so the two cannot be the same number.
  -- Defaults to p_amount (a plain credit/debit where they agree).
  p_balance_delta numeric default null
) returns table (
  ok boolean,
  balance_after numeric,
  txn_id text,
  error text
) language plpgsql as $$
declare
  v_bal numeric;
  v_txn text;
  v_ref text;
  v_delta numeric;
begin
  if p_amount is null or p_amount = 0 then
    return query select false, null::numeric, null::text, 'Amount must be non-zero';
    return;
  end if;

  v_delta := coalesce(p_balance_delta, p_amount);

  -- Serialize concurrent moves on the same wallet.
  select u.wallet_balance into v_bal from users u where u.id = p_user_id for update;
  if not found then
    return query select false, null::numeric, null::text, 'User not found';
    return;
  end if;

  -- A wallet may never go negative (migration guard for the CHECK constraint).
  if v_bal + v_delta < 0 then
    return query select false, v_bal, null::text, 'Insufficient balance';
    return;
  end if;

  v_txn := 'wtx-' || extract(epoch from now())::bigint || '-' || floor(random() * 900 + 100)::int;

  -- A blank reference would make every later move of the same type look like a
  -- replay of the first one (the unique index above), so always key the row.
  v_ref := coalesce(nullif(btrim(coalesce(p_reference, '')), ''), 'MOVE-' || v_txn);

  insert into wallet_transactions
    (id, user_id, type, amount, balance_before, balance_after, description, reference,
     payment_method, status, note, network, account_number, reviewed_by, package_id, created_at)
  values
    (v_txn, p_user_id, p_type, p_amount, v_bal, v_bal + v_delta,
     coalesce(p_description, ''), v_ref,
     coalesce(p_payment_method, 'system'),
     coalesce(p_extra->>'status', 'completed'),
     coalesce(p_extra->>'note', ''),
     coalesce(p_extra->>'network', ''),
     coalesce(p_extra->>'account_number', ''),
     coalesce(p_extra->>'reviewed_by', ''),
     nullif(p_extra->>'package_id', ''),
     now())
  on conflict (user_id, type, reference) do nothing;

  if not found then
    -- Conflict → this exact reference was already applied (idempotent replay).
    return query select true, v_bal, v_txn, null::text;
    return;
  end if;

  update users set wallet_balance = v_bal + v_delta, updated_at = now()
  where id = p_user_id;

  return query select true, v_bal + v_delta, v_txn, null::text;
end;
$$;

-- ── Resumable uploads ────────────────────────────────────────────────────
-- One row per uploaded chunk. A retried chunk is an idempotent upsert on
-- (upload_id, idx), and the client learns which pieces the server already holds
-- by asking for the index list — which is what lets an interrupted upload resume
-- instead of restarting. Rows are deleted as soon as the record that consumed
-- them is written, and swept after 24h otherwise.
-- Kept OFF the generic /api/:table surface (like otps): only /api/uploads/*
-- touches it, so a browser can never read another user's chunks.
create table if not exists upload_chunks (
  upload_id text not null,
  idx int not null,
  user_id text not null,
  filename text,
  total_chunks int not null,
  data text not null,
  created_at timestamptz not null default now(),
  primary key (upload_id, idx)
);
create index if not exists upload_chunks_user_idx on upload_chunks (user_id, created_at desc);
create index if not exists upload_chunks_age_idx on upload_chunks (created_at);

-- ── #8: plaintext passwords must not exist anywhere ───────────────────────
alter table users drop column if exists password;

-- ── #7: the VAPID private key never belongs in the settings table ─────────
delete from settings where key in ('vapid_private_key', 'vapid_public_key');
create index if not exists wallet_txns_reference_idx on wallet_transactions (reference);

-- ── Cross-cutting: Row Level Security on every table ─────────────────────
-- RLS is enabled everywhere and NO anon policy is created for personal data.
-- The anon key is a public credential (it ships in every browser bundle), so a
-- `using (true)` policy on users/orders/packages would hand anybody the
-- password hashes, emails, phone numbers and wallet balances with a single
-- REST call. Only catalog tables are readable anonymously; every other read
-- goes through the server, whose service_role key bypasses RLS entirely.
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    -- Extension-owned tables (e.g. PostGIS spatial_ref_sys) cannot be altered by
    -- the migration role; one of them must not abort the whole script.
    begin
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists anon_read on %I', t);
      if t in ('products','stores','storefronts','services','reviews','ad_campaigns','delivery_rates','settings') then
        execute format(
          'create policy anon_read on %I for select to anon using (true)', t);
      end if;
    exception when insufficient_privilege then
      raise notice 'skipping RLS on % (not owned by the migration role)', t;
    end;
  end loop;
end $$;

-- Defence in depth: drop any leftover anon policies on personal-data tables in
-- case an earlier revision of this migration created them.
do $$
declare t text;
begin
  foreach t in array array['users','orders','packages','wallet_transactions','notifications','referrals','support_tickets','service_orders','upload_chunks']
  loop
    -- Only drop where the table actually exists, otherwise the whole block
    -- aborts on the first name that was never created.
    if exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = t
    ) then
      execute format('drop policy if exists anon_read on %I', t);
    end if;
  end loop;
end $$;

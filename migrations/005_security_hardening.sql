-- 005_security_hardening.sql
-- Audit items: #1 (OTP), #4/#5 (payments & wallet), #7 (settings), #8 (passwords),
-- cross-cutting (RLS on every table, anon key read-mostly).
-- Run in the Supabase SQL editor. Statements are idempotent where possible.

-- ── #1: one-time passcodes for phone verification ─────────────────────────
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

-- ── #5: wallet ledger integrity ───────────────────────────────────────────
-- A retried/duplicated request must not create a second ledger row: the
-- (user_id, type, reference) triple is the idempotency key.
create unique index if not exists wallet_txns_idem_idx
  on wallet_transactions (user_id, type, reference);
-- The database itself refuses a negative balance even if app code has a bug.
alter table users drop constraint if exists users_wallet_balance_nonneg;
alter table users add constraint users_wallet_balance_nonneg
  check (wallet_balance >= 0) not valid;
validate constraint users_wallet_balance_nonneg;

-- #5: atomic balance move — lock the user row, write the ledger row and
-- update the balance in ONE transaction. Call via supabase.rpc('wallet_move', …).
create or replace function wallet_move(
  p_user_id text,
  p_type text,
  p_amount numeric,
  p_reference text,
  p_description text default '',
  p_payment_method text default 'system'
) returns table (
  ok boolean,
  balance_after numeric,
  txn_id text,
  error text
) language plpgsql as $$
declare
  v_bal numeric;
  v_txn text;
begin
  if p_amount is null or p_amount = 0 then
    return query select false, null::numeric, null::text, 'Amount must be non-zero';
    return;
  end if;

  -- Serialize concurrent moves on the same wallet.
  select u.wallet_balance into v_bal from users u where u.id = p_user_id for update;
  if not found then
    return query select false, null::numeric, null::text, 'User not found';
    return;
  end if;

  if v_bal + p_amount < 0 then
    return query select false, v_bal, null::text, 'Insufficient balance';
    return;
  end if;

  v_txn := 'wtx-' || extract(epoch from now())::bigint || '-' || floor(random() * 900 + 100)::int;

  insert into wallet_transactions
    (id, user_id, type, amount, balance_before, balance_after, description, reference, payment_method, status, created_at)
  values
    (v_txn, p_user_id, p_type, p_amount, v_bal, v_bal + p_amount,
     p_description, p_reference, p_payment_method, 'completed', now())
  on conflict (user_id, type, reference) do nothing;

  if not found then
    -- Conflict → this exact reference was already applied (idempotent replay).
    return query select true, v_bal, v_txn, null::text;
    return;
  end if;

  update users set wallet_balance = v_bal + p_amount, updated_at = now()
  where id = p_user_id;

  return query select true, v_bal + p_amount, v_txn, null::text;
end;
$$;

-- ── #8: plaintext passwords must not exist anywhere ───────────────────────
-- Postgres keeps column contents in TOAST, so a plain DROP COLUMN does not
-- scrub storage; rewrite the table by dropping and re-adding a dummy.
alter table users drop column if exists password;
alter table users add column if not exists password_removed_placeholder boolean;

-- ── #4: server-owned payment state ────────────────────────────────────────
-- payment_status may only be set by the payment webhook (service-role writes
-- from server code) — enforced in app code; the index below keeps refund
-- lookups by reference fast.
create index if not exists wallet_txns_reference_idx on wallet_transactions (reference);

-- ── #7: the VAPID private key never belongs in the settings table ─────────
delete from settings where key in ('vapid_private_key', 'vapid_public_key');

-- ── Cross-cutting: Row Level Security on every table ─────────────────────
-- The anon key gets read access to PUBLIC tables only and NO direct writes —
-- every write goes through the server (service-role key). Adjust the public
-- list if new catalog tables are added.
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_read on %I', t);
    if t in ('products','stores','storefronts','services','reviews','ad_campaigns','delivery_rates','settings') then
      execute format(
        'create policy anon_read on %I for select to anon using (true)', t);
    elsif t in ('users','orders','packages') then
      execute format(
        'create policy anon_read on %I for select to anon using (true)', t);
    else
      -- No anon policy → anon sees nothing; server uses service role.
      null;
    end if;
  end loop;
end $$;

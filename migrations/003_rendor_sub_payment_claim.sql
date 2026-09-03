-- 003 — Rendor subscription payment claims.
--
-- Rendors cannot activate their own subscription (rendor_sub_status / expiry /
-- plan are admin-only fields enforced in lib/access.js). What they CAN do after
-- paying is record a *claim*: months chosen + amount + when they notified admin.
-- These columns give the admin list a concrete "paid, awaiting activation" row
-- so a claim is never lost if a notification is missed.
--
-- Run this once in the Supabase SQL Editor, then deploy api/index.js (server.js
-- reads/writes the same columns on the local db.json path).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_payment_status text,
  ADD COLUMN IF NOT EXISTS sub_payment_months integer,
  ADD COLUMN IF NOT EXISTS sub_payment_amount double precision,
  ADD COLUMN IF NOT EXISTS sub_paid_at text;

-- Values: 'paid_pending' (awaiting admin verification) or NULL (cleared once
-- admin activates/deactivates). Keep it constrained so accidental values can't
-- accumulate.
COMMENT ON COLUMN users.sub_payment_status IS
  'Rendor payment claim: paid_pending means the rendor notified admin they paid; admin verification still required before activation.';
COMMENT ON COLUMN users.sub_payment_months IS 'Months the rendor claims to have paid for (1 / 3 / 6).';
COMMENT ON COLUMN users.sub_payment_amount IS 'Amount (GHS) the rendor claims to have paid.';
COMMENT ON COLUMN users.sub_paid_at IS 'ISO timestamp when the rendor submitted the payment claim.';

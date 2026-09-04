-- 004 — Rendor subscription payment-proof reference.
--
-- The rendor's payment claim (003) records months + amount, but admin has no
-- way to cross-check the actual transfer. This column lets the rendor attach
-- their MoMo transaction / payment reference when claiming, so admin can
-- verify the claim against their own MoMo statement.
--
-- Run this once in the Supabase SQL Editor (after 003), then deploy
-- api/index.js (server.js reads/writes the same column on the local path).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sub_payment_ref text;

COMMENT ON COLUMN users.sub_payment_ref IS
  'Payment reference / MoMo transaction ID the rendor attaches to a paid_pending claim for admin verification.';
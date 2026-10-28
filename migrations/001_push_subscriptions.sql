-- HAPPA TRADEMART — Push Subscriptions Table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor → New Query → Paste & Run
--
-- REVISED: the original version of this file created
--     CREATE POLICY "Service role full access" ON push_subscriptions
--       FOR ALL USING (true) WITH CHECK (true);
-- with no `to` clause — which means PUBLIC, anon included. service_role already
-- bypasses RLS, so that policy granted the server nothing while letting any
-- anonymous holder of the anon key read every subscription (endpoint + keys
-- are push credentials) and insert or delete rows. It also used
-- `CREATE POLICY IF NOT EXISTS`, which is not valid Postgres — the statement
-- errored, taking the rest of the multi-statement call with it.
--
-- A policy is no longer created here at all: RLS on, zero policies = only
-- service_role touches this table. See migrations/007_rls_lockdown.sql, which
-- drops the old policy on databases that already ran this file.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  keys JSONB DEFAULT '{}',
  user_id TEXT DEFAULT 'anonymous',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The code writes an `id` (js/ and api/ build subRecord with one) and 000's
-- fuller shape has it; without this a database that only ever ran 001 rejects
-- every subscribe insert with "column id does not exist".
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE push_subscriptions SET id = endpoint WHERE id IS NULL OR id = '';
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_id_uniq ON push_subscriptions (id);

-- Index for fast lookup by user_id (used when sending push to a user)
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- RLS: enabled, and deliberately with NO policy. Only the server (service_role,
-- which bypasses RLS) may read or write these rows.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_subscriptions FROM PUBLIC, anon, authenticated;

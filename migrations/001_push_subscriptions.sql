-- HAPPA TRADEMART — Push Subscriptions Table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor → New Query → Paste & Run

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  keys JSONB DEFAULT '{}',
  user_id TEXT DEFAULT 'anonymous',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by user_id (used when sending push to a user)
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- RLS policies: only service_role can read/write (server-side only)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (your server uses the service_role key)
CREATE POLICY "Service role full access" ON push_subscriptions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Migration: Add user_keys table for multi-user shortcut support
-- Run this in Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS user_keys (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_value   text        NOT NULL UNIQUE,
  label       text        DEFAULT 'iPhone Shortcut',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own keys
CREATE POLICY "Users manage own keys"
  ON user_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- Migrate your existing shortcut key so it keeps working.
-- Replace the key_value below if you changed it from 'gurjar26'.
-- ──────────────────────────────────────────────────────────────
INSERT INTO user_keys (user_id, key_value, label)
VALUES ('abc5cca6-e0e5-441c-9b17-c26011b01525', 'gurjar26', 'iPhone Shortcut')
ON CONFLICT DO NOTHING;

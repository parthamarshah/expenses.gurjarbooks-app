-- ============================================================
-- Migration: Add user_prefs table for per-user customisation
-- Run this in Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id   uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cats_json text  NOT NULL DEFAULT ''
);

ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own prefs"
  ON user_prefs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

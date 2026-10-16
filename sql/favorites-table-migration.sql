-- Favorites Feature Migration
-- Run this in your Supabase SQL Editor
--
-- This migration creates the user_favorites table with proper multi-tenancy support.
-- - Each user (regular user or company admin) has their own personal favorites
-- - Favorites are user-specific, not shared within a company
-- - company_id is stored for data isolation and future analytics
-- - RLS policies ensure users can only manage their own favorites

-- Create favorites table
CREATE TABLE IF NOT EXISTS user_favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

-- Add RLS policies
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

-- Users can only see their own favorites
CREATE POLICY "Users can view own favorites"
  ON user_favorites
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own favorites
CREATE POLICY "Users can insert own favorites"
  ON user_favorites
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own favorites
CREATE POLICY "Users can update own favorites"
  ON user_favorites
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own favorites
CREATE POLICY "Users can delete own favorites"
  ON user_favorites
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create indexes for faster lookups
CREATE INDEX idx_user_favorites_user_id ON user_favorites(user_id);
CREATE INDEX idx_user_favorites_conversation_id ON user_favorites(conversation_id);
CREATE INDEX idx_user_favorites_company_id ON user_favorites(company_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_favorites_updated_at
  BEFORE UPDATE ON user_favorites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

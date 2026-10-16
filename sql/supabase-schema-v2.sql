-- ============================================================================
-- Slab Voice Database Schema v2 - User Roles & Management
-- ============================================================================
-- This migration adds user roles, login tracking, and transcript assignments.
-- Run this SQL in your Supabase SQL Editor AFTER the initial schema.
-- ============================================================================

-- ============================================================================
-- Table: user_profiles
-- ============================================================================
-- Extends Supabase Auth with custom user data
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Table: login_logs
-- ============================================================================
-- Tracks user login activity for detecting password sharing
CREATE TABLE login_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_in_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  ip_address TEXT,
  user_agent TEXT
);

-- Enable RLS
ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;

-- Index for efficient weekly login queries
CREATE INDEX idx_login_logs_user_date ON login_logs(user_id, logged_in_at DESC);

-- ============================================================================
-- Table: transcript_assignments
-- ============================================================================
-- Links transcripts to users who can view them
CREATE TABLE transcript_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(transcript_id, user_id)
);

-- Enable RLS
ALTER TABLE transcript_assignments ENABLE ROW LEVEL SECURITY;

-- Index for efficient user transcript lookups
CREATE INDEX idx_transcript_assignments_user ON transcript_assignments(user_id);
CREATE INDEX idx_transcript_assignments_transcript ON transcript_assignments(transcript_id);

-- ============================================================================
-- Add uploaded_by column to transcripts table
-- ============================================================================
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id);

-- ============================================================================
-- RLS Policies for user_profiles
-- ============================================================================

-- Admins can read all profiles
CREATE POLICY "Admins can read all user profiles"
ON user_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
  OR id = auth.uid()
);

-- Admins can insert new profiles
CREATE POLICY "Admins can create user profiles"
ON user_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- Admins can update profiles
CREATE POLICY "Admins can update user profiles"
ON user_profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- Admins can delete profiles
CREATE POLICY "Admins can delete user profiles"
ON user_profiles
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- ============================================================================
-- RLS Policies for login_logs
-- ============================================================================

-- Users can insert their own login logs
CREATE POLICY "Users can insert own login logs"
ON login_logs
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Admins can read all login logs
CREATE POLICY "Admins can read all login logs"
ON login_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- ============================================================================
-- RLS Policies for transcript_assignments
-- ============================================================================

-- Users can read their own assignments
CREATE POLICY "Users can read own transcript assignments"
ON transcript_assignments
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins can read all assignments
CREATE POLICY "Admins can read all transcript assignments"
ON transcript_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- Admins can create assignments
CREATE POLICY "Admins can create transcript assignments"
ON transcript_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- Admins can delete assignments
CREATE POLICY "Admins can delete transcript assignments"
ON transcript_assignments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- ============================================================================
-- Updated RLS Policies for transcripts
-- ============================================================================
-- Drop existing policies first (run these one at a time if needed)
DROP POLICY IF EXISTS "Allow authenticated users to read transcripts" ON transcripts;
DROP POLICY IF EXISTS "Allow authenticated users to delete transcripts" ON transcripts;

-- Admins can read all transcripts, users can only read assigned transcripts
CREATE POLICY "Role-based transcript read access"
ON transcripts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
  OR EXISTS (
    SELECT 1 FROM transcript_assignments ta
    WHERE ta.transcript_id = id AND ta.user_id = auth.uid()
  )
  OR uploaded_by = auth.uid()
);

-- Only admins can delete transcripts
CREATE POLICY "Only admins can delete transcripts"
ON transcripts
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- ============================================================================
-- View: user_login_stats
-- ============================================================================
-- Provides weekly login counts per user for admin dashboard
CREATE OR REPLACE VIEW user_login_stats AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.role,
  up.is_active,
  COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') AS logins_last_7_days,
  COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '24 hours') AS logins_last_24_hours,
  COUNT(DISTINCT DATE(ll.logged_in_at)) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') AS unique_days_logged_in,
  MAX(ll.logged_in_at) AS last_login,
  -- Flag as suspicious if more than 10 logins in a week or logins from many IPs
  CASE
    WHEN COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 10 THEN true
    WHEN COUNT(DISTINCT ll.ip_address) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 5 THEN true
    ELSE false
  END AS is_suspicious
FROM user_profiles up
LEFT JOIN login_logs ll ON ll.user_id = up.id
GROUP BY up.id, up.email, up.display_name, up.role, up.is_active;

-- ============================================================================
-- Function: create_user_profile_on_signup
-- ============================================================================
-- Automatically creates a user_profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- Function: log_user_login
-- ============================================================================
-- Call this function when a user logs in to track their activity
CREATE OR REPLACE FUNCTION public.log_user_login(
  p_user_id UUID,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO login_logs (user_id, ip_address, user_agent)
  VALUES (p_user_id, p_ip_address, p_user_agent)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: create_user_with_role (for admin use)
-- ============================================================================
-- Admins use this to create new users via Supabase Auth Admin API
-- The trigger will auto-create the profile with the specified role

-- ============================================================================
-- Seed: Make existing users admins (run manually for your current admin)
-- ============================================================================
-- After running this migration, manually insert your admin user:
-- INSERT INTO user_profiles (id, email, display_name, role)
-- SELECT id, email, email, 'admin'
-- FROM auth.users
-- WHERE email = 'your-admin-email@example.com'
-- ON CONFLICT (id) DO UPDATE SET role = 'admin';

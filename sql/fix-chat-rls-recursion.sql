-- ============================================================================
-- Fix RLS Infinite Recursion for channel_members
-- ============================================================================
-- This fixes the infinite recursion issue in channel_members RLS policy
-- Run this in Supabase SQL Editor
-- ============================================================================

BEGIN;

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users see channel memberships" ON channel_members;
DROP POLICY IF EXISTS "Super admins see all memberships" ON channel_members;

-- Create a security definer function to get user's channel IDs
-- SECURITY DEFINER bypasses RLS, preventing recursion
CREATE OR REPLACE FUNCTION get_user_channel_ids(p_user_id UUID)
RETURNS TABLE(channel_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT cm.channel_id
  FROM channel_members cm
  WHERE cm.user_id = p_user_id
    AND cm.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Super admins see all memberships
CREATE POLICY "Super admins see all memberships"
ON channel_members FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Users see memberships for channels they belong to
-- Uses SECURITY DEFINER function to avoid RLS recursion
CREATE POLICY "Users see channel memberships"
ON channel_members FOR SELECT
TO authenticated
USING (
  channel_id IN (SELECT get_user_channel_ids(auth.uid()))
);

DO $$ BEGIN RAISE NOTICE '✅ RLS recursion fix applied!'; END $$;

COMMIT;

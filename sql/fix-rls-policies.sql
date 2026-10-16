-- Fix RLS policies for activity tracking tables
-- This allows users to insert their own activity data

-- ============================================================================
-- user_activity_events - Allow users to insert their own events
-- ============================================================================

-- Drop existing restrictive policy if it exists
DROP POLICY IF EXISTS "Users can view own events" ON user_activity_events;
DROP POLICY IF EXISTS "Users can insert own events" ON user_activity_events;
DROP POLICY IF EXISTS "Admins can view all events" ON user_activity_events;

-- Allow users to INSERT their own events
CREATE POLICY "Users can insert own events"
ON user_activity_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Allow users to SELECT their own events
CREATE POLICY "Users can view own events"
ON user_activity_events
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Allow super_admins and company_admins to view events
CREATE POLICY "Admins can view all events"
ON user_activity_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND (
      user_profiles.role = 'super_admin'
      OR (
        user_profiles.role = 'company_admin'
        AND user_profiles.company_id = user_activity_events.company_id
      )
    )
  )
);

-- ============================================================================
-- daily_usage_stats - Allow users to upsert their own stats
-- ============================================================================

-- Drop existing restrictive policy if it exists
DROP POLICY IF EXISTS "Users can view own stats" ON daily_usage_stats;
DROP POLICY IF EXISTS "Users can manage own stats" ON daily_usage_stats;
DROP POLICY IF EXISTS "Admins can view all stats" ON daily_usage_stats;

-- Allow users to INSERT/UPDATE their own stats
CREATE POLICY "Users can manage own stats"
ON daily_usage_stats
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow super_admins and company_admins to view stats
CREATE POLICY "Admins can view all stats"
ON daily_usage_stats
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND (
      user_profiles.role = 'super_admin'
      OR (
        user_profiles.role = 'company_admin'
        AND user_profiles.company_id = daily_usage_stats.company_id
      )
    )
  )
);

-- ============================================================================
-- Verify policies are active
-- ============================================================================

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('user_activity_events', 'daily_usage_stats')
ORDER BY tablename, policyname;

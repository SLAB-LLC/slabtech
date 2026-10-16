-- Re-enable RLS with proper policies (now safe with service role key in place)
-- Run this AFTER deploying the updated heartbeat API with service role key

-- ============================================================================
-- Step 1: Re-enable RLS on tracking tables
-- ============================================================================

ALTER TABLE user_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage_stats ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Step 2: Verify RLS is enabled
-- ============================================================================

SELECT
  tablename,
  rowsecurity as "RLS Enabled (should be true)"
FROM pg_tables
WHERE tablename IN ('user_activity_events', 'daily_usage_stats')
ORDER BY tablename;

-- ============================================================================
-- Step 3: Test that aggregation still works (with service role key)
-- ============================================================================

-- This should work because the API uses service role key
SELECT update_daily_usage_stats(
  (SELECT id FROM user_profiles LIMIT 1),
  CURRENT_DATE
);

-- ============================================================================
-- Step 4: Test that users can insert their own events
-- ============================================================================

-- This will only work if you're running as an authenticated user in the app
-- If running in SQL Editor (postgres role), it will succeed regardless
-- SELECT * FROM user_activity_events WHERE user_id = auth.uid();

-- ============================================================================
-- Success!
-- ============================================================================

SELECT 'RLS successfully re-enabled! Tracking system is now more secure.' as status;

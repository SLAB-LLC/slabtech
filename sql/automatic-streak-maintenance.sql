-- ============================================================================
-- Automatic Streak Maintenance
-- ============================================================================
-- Option 1: Using Supabase pg_cron (if available on your plan)
-- Option 2: Real-time view that auto-calculates current streaks
-- Option 3: Trigger-based automatic reset
-- ============================================================================

-- ============================================================================
-- OPTION 1: pg_cron (Recommended for Supabase Pro plans)
-- ============================================================================
-- This runs daily maintenance automatically

-- Check if pg_cron is available
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- If it exists, enable it (may require Supabase dashboard toggle)
-- Then schedule the jobs:

/*
-- Run daily at 2 AM UTC to reset broken streaks
SELECT cron.schedule(
  'reset-broken-streaks',
  '0 2 * * *',  -- 2 AM every day
  $$SELECT reset_broken_streaks()$$
);

-- Run daily at 2:05 AM UTC to sync previous day's usage stats to streaks
SELECT cron.schedule(
  'sync-daily-usage-to-streaks',
  '5 2 * * *',  -- 2:05 AM every day
  $$SELECT sync_daily_stats_to_streaks()$$
);

-- View scheduled jobs
SELECT * FROM cron.job;
*/

-- ============================================================================
-- OPTION 2: Smart View (Works on all plans - RECOMMENDED)
-- ============================================================================
-- Replace company_streak_leaderboard with a view that auto-calculates streaks

DROP VIEW IF EXISTS company_streak_leaderboard CASCADE;

CREATE OR REPLACE VIEW company_streak_leaderboard AS
SELECT
  up.company_id,
  up.id AS user_id,
  up.display_name,
  up.email,
  up.profile_picture_url,
  -- Auto-calculate current_streak based on last_activity_date
  CASE
    WHEN us.last_activity_date >= CURRENT_DATE - INTERVAL '1 day'
      THEN COALESCE(us.current_streak, 0)
    ELSE 0  -- Streak broken if last activity was before yesterday
  END AS current_streak,
  COALESCE(us.longest_streak, 0) AS longest_streak,
  COALESCE(us.total_activities, 0) AS total_activities,
  us.last_activity_date,
  RANK() OVER (
    PARTITION BY up.company_id
    ORDER BY
      CASE
        WHEN us.last_activity_date >= CURRENT_DATE - INTERVAL '1 day'
          THEN COALESCE(us.current_streak, 0)
        ELSE 0
      END DESC,
      COALESCE(us.longest_streak, 0) DESC
  ) AS company_rank,
  (FLOOR(
    CASE
      WHEN us.last_activity_date >= CURRENT_DATE - INTERVAL '1 day'
        THEN COALESCE(us.current_streak, 0)
      ELSE 0
    END / 7
  )::INTEGER % 6) AS week_color_index
FROM user_profiles up
LEFT JOIN user_streaks us ON us.user_id = up.id
WHERE up.is_active = true
ORDER BY up.company_id, company_rank;

COMMENT ON VIEW company_streak_leaderboard IS
'Leaderboard with auto-calculated current streaks - shows 0 for users inactive >24h';

-- ============================================================================
-- OPTION 3: Trigger-based Reset (Runs automatically on any activity)
-- ============================================================================
-- This resets broken streaks whenever the user_streaks table is accessed

CREATE OR REPLACE FUNCTION auto_reset_broken_streaks()
RETURNS TRIGGER AS $$
BEGIN
  -- When updating a user's streak, first check if it should be reset
  IF NEW.current_streak > 0
     AND NEW.last_activity_date IS NOT NULL
     AND NEW.last_activity_date < CURRENT_DATE - INTERVAL '1 day' THEN
    -- Streak is broken, reset it
    NEW.current_streak := 0;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_auto_reset_broken_streaks ON user_streaks;

-- Create trigger that runs BEFORE any update
CREATE TRIGGER trigger_auto_reset_broken_streaks
  BEFORE UPDATE ON user_streaks
  FOR EACH ROW
  EXECUTE FUNCTION auto_reset_broken_streaks();

COMMENT ON TRIGGER trigger_auto_reset_broken_streaks ON user_streaks IS
'Automatically resets current_streak to 0 if last_activity_date is >24h old';

-- ============================================================================
-- OPTION 4: One-time cleanup function for existing data
-- ============================================================================
-- Run this NOW to fix existing broken streaks, then the view handles it going forward

CREATE OR REPLACE FUNCTION cleanup_all_broken_streaks()
RETURNS void AS $$
BEGIN
  -- Reset all currently broken streaks
  UPDATE user_streaks
  SET
    current_streak = 0,
    updated_at = NOW()
  WHERE current_streak > 0
    AND last_activity_date IS NOT NULL
    AND last_activity_date < CURRENT_DATE - INTERVAL '1 day';

  RAISE NOTICE 'All broken streaks have been reset';
END;
$$ LANGUAGE plpgsql;

-- Run the cleanup NOW
SELECT cleanup_all_broken_streaks();

-- ============================================================================
-- Summary
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'AUTOMATIC STREAK MAINTENANCE ENABLED';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Smart View: Leaderboard auto-calculates current streaks';
  RAISE NOTICE '✓ Trigger: Broken streaks auto-reset on updates';
  RAISE NOTICE '✓ Cleanup: Existing broken streaks reset to 0';
  RAISE NOTICE '';
  RAISE NOTICE 'No daily cron jobs needed!';
  RAISE NOTICE 'Streaks will automatically show 0 for inactive users.';
  RAISE NOTICE '========================================';
END $$;

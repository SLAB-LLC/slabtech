-- ============================================================================
-- Analytics Unification Migration
-- ============================================================================
-- Unifies usage tracking, streaks, and login data to use a single source of truth
-- Makes daily_usage_stats the primary source, with 2min threshold for streaks
-- ============================================================================

-- ============================================================================
-- STEP 1: Create function to automatically create streak activities
-- ============================================================================
-- This function runs daily to create streak_activities based on daily_usage_stats
-- Users with >= 2 minutes of active time earn a streak for that day

CREATE OR REPLACE FUNCTION sync_daily_stats_to_streaks()
RETURNS void AS $$
DECLARE
  v_processed_count INTEGER := 0;
  v_date DATE;
BEGIN
  -- Get yesterday's date (we process the previous day's complete data)
  v_date := CURRENT_DATE - INTERVAL '1 day';

  -- Insert streak_activities for users who met the threshold yesterday
  INSERT INTO streak_activities (user_id, company_id, activity_date, activity_type, created_at)
  SELECT
    dus.user_id,
    dus.company_id,
    dus.date AS activity_date,
    'daily_active' AS activity_type,
    NOW() AS created_at
  FROM daily_usage_stats dus
  WHERE dus.date = v_date
    AND dus.total_active_minutes >= 2  -- 2 minute threshold
  ON CONFLICT (user_id, activity_date) DO NOTHING;  -- Don't duplicate if already exists

  GET DIAGNOSTICS v_processed_count = ROW_COUNT;

  RAISE NOTICE 'Synced % streak activities for date %', v_processed_count, v_date;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_daily_stats_to_streaks() IS
'Automatically creates streak_activities records for users with >= 2min active time in daily_usage_stats. Run daily via cron.';

-- ============================================================================
-- STEP 2: Create trigger to auto-sync when daily_usage_stats is updated
-- ============================================================================
-- This ensures real-time syncing when daily stats are calculated

CREATE OR REPLACE FUNCTION trigger_sync_streaks_on_daily_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if the user met the 2-minute threshold
  IF NEW.total_active_minutes >= 2 THEN
    -- Insert into streak_activities (will trigger the streak update)
    INSERT INTO streak_activities (user_id, company_id, activity_date, activity_type, created_at)
    VALUES (
      NEW.user_id,
      NEW.company_id,
      NEW.date,
      'daily_active',
      NOW()
    )
    ON CONFLICT (user_id, activity_date) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_auto_sync_streaks ON daily_usage_stats;

-- Create the trigger
CREATE TRIGGER trigger_auto_sync_streaks
  AFTER INSERT OR UPDATE OF total_active_minutes ON daily_usage_stats
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sync_streaks_on_daily_stats();

COMMENT ON TRIGGER trigger_auto_sync_streaks ON daily_usage_stats IS
'Automatically creates streak activities when daily usage stats show >= 2min active time';

-- ============================================================================
-- STEP 3: Update user_login_stats view to show unified metrics
-- ============================================================================
-- Replace the old view that only counted logins with one that shows days active

DROP VIEW IF EXISTS user_login_stats CASCADE;

CREATE OR REPLACE VIEW user_login_stats AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.role,
  up.company_id,
  up.is_active,

  -- Login counts from login_logs (for audit trail)
  COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') AS logins_last_7_days,
  COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '24 hours') AS logins_last_24_hours,

  -- UNIFIED METRIC: Days active from daily_usage_stats (single source of truth)
  COALESCE(
    (SELECT COUNT(DISTINCT dus.date)
     FROM daily_usage_stats dus
     WHERE dus.user_id = up.id
       AND dus.date >= CURRENT_DATE - INTERVAL '7 days'
    ), 0
  ) AS unique_days_logged_in,

  -- Last activity from either login_logs or daily_usage_stats (whichever is most recent)
  GREATEST(
    MAX(ll.logged_in_at),
    (SELECT MAX(dus.last_activity)
     FROM daily_usage_stats dus
     WHERE dus.user_id = up.id
    )
  ) AS last_login,

  -- Suspicious detection (kept from original logic)
  CASE
    WHEN COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 10 THEN true
    WHEN COUNT(DISTINCT ll.ip_address) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 5 THEN true
    ELSE false
  END AS is_suspicious
FROM user_profiles up
LEFT JOIN login_logs ll ON ll.user_id = up.id
GROUP BY up.id, up.email, up.display_name, up.role, up.company_id, up.is_active;

COMMENT ON VIEW user_login_stats IS
'User management stats view - now uses daily_usage_stats for days active (unified with usage analytics and streaks)';

-- ============================================================================
-- STEP 4: Create backfill function to sync historical data
-- ============================================================================
-- This processes all existing daily_usage_stats to create missing streak_activities

CREATE OR REPLACE FUNCTION backfill_streak_activities_from_usage_stats()
RETURNS TABLE(processed_records INTEGER, date_range TEXT) AS $$
DECLARE
  v_inserted_count INTEGER := 0;
  v_min_date DATE;
  v_max_date DATE;
BEGIN
  -- Get date range we're processing
  SELECT MIN(date), MAX(date) INTO v_min_date, v_max_date
  FROM daily_usage_stats
  WHERE total_active_minutes >= 2;

  -- Insert all historical records where user had >= 2min active time
  INSERT INTO streak_activities (user_id, company_id, activity_date, activity_type, created_at)
  SELECT
    dus.user_id,
    dus.company_id,
    dus.date AS activity_date,
    'daily_active' AS activity_type,
    NOW() AS created_at
  FROM daily_usage_stats dus
  WHERE dus.total_active_minutes >= 2  -- 2 minute threshold
  ON CONFLICT (user_id, activity_date) DO NOTHING;  -- Skip if already exists

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RAISE NOTICE 'Backfilled % streak activities from % to %', v_inserted_count, v_min_date, v_max_date;

  RETURN QUERY SELECT v_inserted_count,
    CONCAT(v_min_date::TEXT, ' to ', v_max_date::TEXT);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_streak_activities_from_usage_stats() IS
'One-time backfill to populate streak_activities from existing daily_usage_stats records. Safe to run multiple times.';

-- ============================================================================
-- STEP 5: Update company_streak_leaderboard view to include all users
-- ============================================================================
-- The old view only showed users with existing streak records
-- New view shows ALL active users in the company, with 0 for those without streaks

DROP VIEW IF EXISTS company_streak_leaderboard CASCADE;

CREATE OR REPLACE VIEW company_streak_leaderboard AS
SELECT
  up.company_id,
  up.id AS user_id,
  up.display_name,
  up.email,
  up.profile_picture_url,
  COALESCE(us.current_streak, 0) AS current_streak,
  COALESCE(us.longest_streak, 0) AS longest_streak,
  COALESCE(us.total_activities, 0) AS total_activities,
  us.last_activity_date,
  RANK() OVER (
    PARTITION BY up.company_id
    ORDER BY COALESCE(us.current_streak, 0) DESC, COALESCE(us.longest_streak, 0) DESC
  ) AS company_rank,
  (FLOOR(COALESCE(us.current_streak, 0) / 7)::INTEGER % 6) AS week_color_index
FROM user_profiles up
LEFT JOIN user_streaks us ON us.user_id = up.id
WHERE up.is_active = true
ORDER BY up.company_id, company_rank;

COMMENT ON VIEW company_streak_leaderboard IS
'Company leaderboard showing ALL active users, including those with 0 streaks';

-- ============================================================================
-- STEP 6: Create verification function to check data consistency
-- ============================================================================
-- This helps Duncan verify that all three systems show the same data

CREATE OR REPLACE FUNCTION verify_analytics_consistency(
  p_user_email TEXT DEFAULT NULL
)
RETURNS TABLE(
  email TEXT,
  usage_days_active_7d INTEGER,
  login_unique_days_7d BIGINT,
  streak_activities_7d BIGINT,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH usage_data AS (
    SELECT
      user_id,
      email as user_email,
      days_active_last_7
    FROM user_usage_summary
    WHERE p_user_email IS NULL OR email = p_user_email
  ),
  login_data AS (
    SELECT
      user_id,
      unique_days_logged_in
    FROM user_login_stats
    WHERE p_user_email IS NULL OR email = p_user_email
  ),
  streak_data AS (
    SELECT
      sa.user_id,
      COUNT(DISTINCT sa.activity_date) as activities_7d
    FROM streak_activities sa
    WHERE sa.activity_date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY sa.user_id
  )
  SELECT
    ud.user_email::TEXT,
    ud.days_active_last_7::INTEGER,
    ld.unique_days_logged_in::BIGINT,
    COALESCE(sd.activities_7d, 0)::BIGINT,
    CASE
      WHEN ud.days_active_last_7 = ld.unique_days_logged_in
        AND ld.unique_days_logged_in = COALESCE(sd.activities_7d, 0)
      THEN '✓ Consistent'::TEXT
      ELSE '✗ Mismatch'::TEXT
    END as status
  FROM usage_data ud
  LEFT JOIN login_data ld ON ld.user_id = ud.user_id
  LEFT JOIN streak_data sd ON sd.user_id = ud.user_id
  ORDER BY status DESC, ud.user_email;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION verify_analytics_consistency(TEXT) IS
'Verifies that usage analytics, login stats, and streak activities all show the same days active for users. Pass user email to check specific user, or NULL for all users.';

-- ============================================================================
-- STEP 7: Run backfill NOW
-- ============================================================================

DO $$
DECLARE
  v_result RECORD;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Running backfill...';
  RAISE NOTICE '========================================';

  -- Run the backfill
  FOR v_result IN SELECT * FROM backfill_streak_activities_from_usage_stats()
  LOOP
    RAISE NOTICE 'Backfill complete: % records processed for date range: %',
      v_result.processed_records, v_result.date_range;
  END LOOP;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Run: SELECT * FROM verify_analytics_consistency();';
  RAISE NOTICE '2. All three views should now show consistent data';
  RAISE NOTICE '3. Set up daily cron job: SELECT sync_daily_stats_to_streaks();';
  RAISE NOTICE '========================================';
END $$;

-- ============================================================================
-- FINAL NOTES
-- ============================================================================
-- This migration:
-- ✓ Makes daily_usage_stats the single source of truth
-- ✓ Auto-creates streak_activities when users have 2+ min active time
-- ✓ Updates user_login_stats view to show days_active instead of just logins
-- ✓ Updates leaderboard to show ALL users (even with 0 streaks)
-- ✓ Backfills all historical data
-- ✓ Provides verification function to check consistency
--
-- To verify everything is working:
-- SELECT * FROM verify_analytics_consistency();
--
-- To manually sync a specific date (if needed):
-- You can call sync_daily_stats_to_streaks() which processes yesterday by default
-- ============================================================================

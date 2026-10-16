-- ============================================================================
-- Fix for verify_analytics_consistency function
-- ============================================================================
-- Fixes the ambiguous column reference error
-- ============================================================================

DROP FUNCTION IF EXISTS verify_analytics_consistency(TEXT);

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
      uus.user_id,
      uus.email as user_email,
      uus.days_active_last_7
    FROM user_usage_summary uus
    WHERE p_user_email IS NULL OR uus.email = p_user_email
  ),
  login_data AS (
    SELECT
      uls.user_id,
      uls.unique_days_logged_in
    FROM user_login_stats uls
    WHERE p_user_email IS NULL OR uls.email = p_user_email
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

-- Now test it
SELECT * FROM verify_analytics_consistency();

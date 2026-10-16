-- ============================================================================
-- RESTORE user_usage_summary View - Fix Usage Analytics
-- ============================================================================
-- This restores the correct user_usage_summary view that was accidentally
-- overwritten in the security advisor fix migration
-- ============================================================================

-- Drop the incorrect view we created
DROP VIEW IF EXISTS public.user_usage_summary;

-- Recreate the CORRECT view (without SECURITY DEFINER - uses invoker's permissions)
CREATE VIEW public.user_usage_summary AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.company_id,
  c.name AS company_name,
  up.role,
  up.is_active,
  up.created_at AS account_created_at,

  -- Lifetime totals
  COALESCE(SUM(dus.total_active_minutes), 0) AS lifetime_active_minutes,
  COALESCE(SUM(dus.session_count), 0) AS lifetime_sessions,
  COALESCE(SUM(dus.transcript_views), 0) AS lifetime_transcript_views,
  COALESCE(SUM(dus.audio_listen_minutes), 0) AS lifetime_audio_minutes,
  COALESCE(SUM(dus.uploads_count), 0) AS lifetime_uploads,

  -- Last 7 days
  COALESCE(SUM(dus.total_active_minutes) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '7 days'), 0) AS last_7_days_active_minutes,
  COALESCE(SUM(dus.session_count) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '7 days'), 0) AS last_7_days_sessions,

  -- Last 30 days
  COALESCE(SUM(dus.total_active_minutes) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS last_30_days_active_minutes,
  COALESCE(SUM(dus.session_count) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS last_30_days_sessions,

  -- Activity timestamps
  MIN(dus.date) AS first_active_date,
  MAX(dus.date) AS last_active_date,

  -- Days active count
  COUNT(DISTINCT dus.date) AS total_days_active,
  COUNT(DISTINCT dus.date) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '7 days') AS days_active_last_7,
  COUNT(DISTINCT dus.date) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '30 days') AS days_active_last_30,

  -- Average usage per active day
  CASE
    WHEN COUNT(DISTINCT dus.date) > 0
    THEN COALESCE(SUM(dus.total_active_minutes), 0) / COUNT(DISTINCT dus.date)
    ELSE 0
  END AS avg_minutes_per_active_day

FROM user_profiles up
LEFT JOIN companies c ON c.id = up.company_id
LEFT JOIN daily_usage_stats dus ON dus.user_id = up.id
GROUP BY up.id, up.email, up.display_name, up.company_id, c.name, up.role, up.is_active, up.created_at;

-- ============================================================================
-- Verification
-- ============================================================================

-- Check the view exists and has the correct columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_usage_summary'
ORDER BY ordinal_position;

-- ============================================================================
-- Done! Usage analytics should now work correctly
-- ============================================================================

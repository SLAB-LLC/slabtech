-- ============================================================================
-- CRITICAL SECURITY FIX: Enable RLS and Fix Security Definer Views (v2)
-- ============================================================================
-- This version uses the correct syntax for all PostgreSQL versions
-- ============================================================================

-- First, check PostgreSQL version
SELECT version();

-- ============================================================================
-- FIX #1 & #2: Enable RLS on transcripts and redaction_config tables
-- ============================================================================

-- Enable RLS on transcripts table
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on redaction_config table
ALTER TABLE public.redaction_config ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- FIX #3-9: Drop SECURITY DEFINER views
-- ============================================================================
-- The key insight: views in PostgreSQL default to using the permissions
-- of the invoking user UNLESS they're explicitly created as SECURITY DEFINER.
-- So we just need to recreate them WITHOUT any security clause.
-- ============================================================================

-- Drop all the problematic views first
DROP VIEW IF EXISTS public.user_login_stats CASCADE;
DROP VIEW IF EXISTS public.company_usage_summary CASCADE;
DROP VIEW IF EXISTS public.user_usage_summary CASCADE;
DROP VIEW IF EXISTS public.company_streak_leaderboard CASCADE;
DROP VIEW IF EXISTS public.objection_frequency CASCADE;
DROP VIEW IF EXISTS public.conversation_stats CASCADE;
DROP VIEW IF EXISTS public.weekly_usage_stats CASCADE;

-- Recreate user_login_stats (NO SECURITY CLAUSE = uses invoker's permissions)
CREATE VIEW public.user_login_stats AS
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
  CASE
    WHEN COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 10 THEN true
    WHEN COUNT(DISTINCT ll.ip_address) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 5 THEN true
    ELSE false
  END AS is_suspicious
FROM user_profiles up
LEFT JOIN login_logs ll ON ll.user_id = up.id
GROUP BY up.id, up.email, up.display_name, up.role, up.is_active;

-- Recreate company_usage_summary
CREATE VIEW public.company_usage_summary AS
SELECT
  c.id,
  c.name,
  c.is_active,
  COUNT(DISTINCT up.id) AS total_users,
  COUNT(DISTINCT CASE WHEN up.is_active THEN up.id END) AS active_users,
  COUNT(DISTINCT t.id) AS total_transcripts,
  COUNT(DISTINCT t.id) FILTER (WHERE t.created_at >= NOW() - INTERVAL '7 days') AS transcripts_last_7_days,
  COUNT(DISTINCT t.id) FILTER (WHERE t.created_at >= NOW() - INTERVAL '30 days') AS transcripts_last_30_days
FROM companies c
LEFT JOIN user_profiles up ON up.company_id = c.id
LEFT JOIN transcripts t ON t.company_id = c.id
GROUP BY c.id, c.name, c.is_active;

-- Recreate user_usage_summary
CREATE VIEW public.user_usage_summary AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.company_id,
  COUNT(DISTINCT t.id) AS total_transcripts,
  COUNT(DISTINCT t.id) FILTER (WHERE t.created_at >= NOW() - INTERVAL '7 days') AS transcripts_last_7_days,
  COUNT(DISTINCT t.id) FILTER (WHERE t.created_at >= NOW() - INTERVAL '30 days') AS transcripts_last_30_days,
  MAX(t.created_at) AS last_upload
FROM user_profiles up
LEFT JOIN transcripts t ON t.uploaded_by = up.id
GROUP BY up.id, up.email, up.display_name, up.company_id;

-- Recreate company_streak_leaderboard
CREATE VIEW public.company_streak_leaderboard AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.company_id,
  COALESCE(us.current_streak, 0) AS current_streak,
  COALESCE(us.longest_streak, 0) AS longest_streak,
  us.last_activity_date,
  RANK() OVER (PARTITION BY up.company_id ORDER BY COALESCE(us.current_streak, 0) DESC) AS rank_in_company
FROM user_profiles up
LEFT JOIN user_streaks us ON us.user_id = up.id
WHERE up.is_active = true
ORDER BY up.company_id, current_streak DESC;

-- Recreate objection_frequency
CREATE VIEW public.objection_frequency AS
SELECT
  jsonb_array_elements_text(objections) AS objection_type,
  COUNT(*) AS frequency,
  COUNT(*) FILTER (WHERE category = 'sale') AS frequency_in_sales,
  COUNT(*) FILTER (WHERE category = 'pitch') AS frequency_in_pitches,
  AVG(duration_seconds) AS avg_conversation_duration
FROM conversations
WHERE objections IS NOT NULL
GROUP BY objection_type
ORDER BY frequency DESC;

-- Recreate conversation_stats
CREATE VIEW public.conversation_stats AS
SELECT
  t.salesperson_id,
  t.salesperson_name,
  t.company_id,
  COUNT(DISTINCT c.id) AS total_conversations,
  COUNT(DISTINCT c.id) FILTER (WHERE c.category = 'sale') AS total_sales,
  COUNT(DISTINCT c.id) FILTER (WHERE c.category = 'pitch') AS total_pitches,
  COUNT(DISTINCT c.id) FILTER (WHERE c.category = 'interaction') AS total_interactions,
  AVG(c.duration_seconds) AS avg_conversation_duration,
  AVG(jsonb_array_length(c.objections)) FILTER (WHERE c.objections IS NOT NULL) AS avg_objections_per_conversation,
  COUNT(DISTINCT c.id) FILTER (WHERE c.has_price_mention) AS conversations_with_price_mention
FROM transcripts t
LEFT JOIN conversations c ON c.transcript_id = t.id
GROUP BY t.salesperson_id, t.salesperson_name, t.company_id;

-- Recreate weekly_usage_stats
CREATE VIEW public.weekly_usage_stats AS
SELECT
  DATE_TRUNC('week', created_at) AS week_start,
  company_id,
  COUNT(*) AS transcripts_uploaded,
  COUNT(DISTINCT uploaded_by) AS active_users,
  SUM(
    CASE
      WHEN jsonb_array_length(transcript_redacted->'words') > 0
      THEN (transcript_redacted->'words'->-1->>'end')::numeric
      ELSE 0
    END
  ) AS total_audio_duration_seconds
FROM transcripts
WHERE created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY DATE_TRUNC('week', created_at), company_id
ORDER BY week_start DESC, company_id;

-- ============================================================================
-- Verification
-- ============================================================================

-- Check RLS is enabled
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('transcripts', 'redaction_config')
ORDER BY tablename;

-- Check views exist and are NOT security definer
-- (In PostgreSQL, we need to check pg_catalog to see the actual security setting)
SELECT
  c.relname AS view_name,
  CASE
    WHEN c.relkind = 'v' THEN 'view'
    ELSE 'not a view'
  END AS object_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN (
  'user_login_stats',
  'company_usage_summary',
  'user_usage_summary',
  'company_streak_leaderboard',
  'objection_frequency',
  'conversation_stats',
  'weekly_usage_stats'
)
ORDER BY c.relname;

-- ============================================================================
-- IMPORTANT NEXT STEP:
-- ============================================================================
-- Go to Supabase Dashboard → Security Advisor and refresh
-- All errors should now be resolved!
-- ============================================================================

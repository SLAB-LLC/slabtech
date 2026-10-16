-- ============================================================================
-- SLAB Voice Usage Tracking Migration
-- ============================================================================
-- Comprehensive usage and activity tracking for case study analysis
-- Tracks active time spent on platform per user per day with lifetime totals
-- ============================================================================

-- ============================================================================
-- Table: user_sessions
-- ============================================================================
-- Tracks user login sessions with start/end times
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  session_start TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  session_end TIMESTAMPTZ,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  ip_address TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, session_start DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_company ON user_sessions(company_id, session_start DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active) WHERE is_active = true;

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Table: activity_heartbeats
-- ============================================================================
-- Tracks active engagement via periodic heartbeat pings from client
-- Used to calculate actual active time on platform
CREATE TABLE IF NOT EXISTS activity_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_path TEXT NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  activity_type TEXT DEFAULT 'page_active' CHECK (activity_type IN ('page_active', 'audio_playing', 'transcript_viewing', 'upload_activity')),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activity_heartbeats_session ON activity_heartbeats(session_id, heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_heartbeats_user ON activity_heartbeats(user_id, heartbeat_at DESC);

ALTER TABLE activity_heartbeats ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Table: daily_usage_stats
-- ============================================================================
-- Pre-aggregated daily statistics per user for efficient querying
CREATE TABLE IF NOT EXISTS daily_usage_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_active_minutes INTEGER DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  transcript_views INTEGER DEFAULT 0,
  audio_listen_minutes INTEGER DEFAULT 0,
  uploads_count INTEGER DEFAULT 0,
  first_activity TIMESTAMPTZ,
  last_activity TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_stats_user_date ON daily_usage_stats(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_usage_stats_company_date ON daily_usage_stats(company_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_usage_stats_date ON daily_usage_stats(date DESC);

ALTER TABLE daily_usage_stats ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Table: user_activity_events
-- ============================================================================
-- Tracks specific user actions for detailed analytics
CREATE TABLE IF NOT EXISTS user_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'logout', 'transcript_upload', 'transcript_view', 'audio_play', 'audio_pause', 'audio_complete', 'page_view')),
  event_data JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_user ON user_activity_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_events_type ON user_activity_events(event_type, occurred_at DESC);

ALTER TABLE user_activity_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- View: user_usage_summary
-- ============================================================================
-- Lifetime usage statistics per user
CREATE OR REPLACE VIEW user_usage_summary AS
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
-- View: company_usage_summary
-- ============================================================================
-- Aggregated usage statistics per company
CREATE OR REPLACE VIEW company_usage_summary AS
SELECT
  c.id AS company_id,
  c.name AS company_name,
  c.slug,
  c.is_active AS company_is_active,

  -- User counts
  COUNT(DISTINCT up.id) AS total_users,
  COUNT(DISTINCT up.id) FILTER (WHERE up.is_active = true) AS active_users,

  -- Lifetime totals
  COALESCE(SUM(dus.total_active_minutes), 0) AS lifetime_active_minutes,
  COALESCE(SUM(dus.session_count), 0) AS lifetime_sessions,
  COALESCE(SUM(dus.uploads_count), 0) AS lifetime_uploads,

  -- Last 7 days
  COALESCE(SUM(dus.total_active_minutes) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '7 days'), 0) AS last_7_days_active_minutes,
  COUNT(DISTINCT dus.user_id) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '7 days') AS active_users_last_7_days,

  -- Last 30 days
  COALESCE(SUM(dus.total_active_minutes) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS last_30_days_active_minutes,
  COUNT(DISTINCT dus.user_id) FILTER (WHERE dus.date >= CURRENT_DATE - INTERVAL '30 days') AS active_users_last_30_days,

  -- Average per user
  CASE
    WHEN COUNT(DISTINCT up.id) > 0
    THEN COALESCE(SUM(dus.total_active_minutes), 0) / COUNT(DISTINCT up.id)
    ELSE 0
  END AS avg_minutes_per_user

FROM companies c
LEFT JOIN user_profiles up ON up.company_id = c.id
LEFT JOIN daily_usage_stats dus ON dus.user_id = up.id
GROUP BY c.id, c.name, c.slug, c.is_active;

-- ============================================================================
-- View: weekly_usage_stats
-- ============================================================================
-- Weekly aggregated stats per user for trend analysis
CREATE OR REPLACE VIEW weekly_usage_stats AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.company_id,
  DATE_TRUNC('week', dus.date) AS week_start,
  SUM(dus.total_active_minutes) AS total_active_minutes,
  SUM(dus.session_count) AS session_count,
  SUM(dus.transcript_views) AS transcript_views,
  SUM(dus.uploads_count) AS uploads_count,
  COUNT(DISTINCT dus.date) AS days_active_in_week,
  ROUND(AVG(dus.total_active_minutes)::numeric, 2) AS avg_minutes_per_day
FROM user_profiles up
LEFT JOIN daily_usage_stats dus ON dus.user_id = up.id
WHERE dus.date IS NOT NULL
GROUP BY up.id, up.email, up.display_name, up.company_id, DATE_TRUNC('week', dus.date);

-- ============================================================================
-- Function: calculate_active_time
-- ============================================================================
-- Calculates active time from heartbeats using a 2-minute activity window
-- If heartbeats are >2 minutes apart, consider it a new activity period
CREATE OR REPLACE FUNCTION calculate_active_minutes(
  p_user_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS INTEGER AS $$
DECLARE
  v_active_minutes INTEGER;
BEGIN
  WITH heartbeat_gaps AS (
    SELECT
      heartbeat_at,
      LAG(heartbeat_at) OVER (ORDER BY heartbeat_at) AS prev_heartbeat,
      EXTRACT(EPOCH FROM (heartbeat_at - LAG(heartbeat_at) OVER (ORDER BY heartbeat_at)))/60 AS gap_minutes
    FROM activity_heartbeats
    WHERE user_id = p_user_id
      AND heartbeat_at BETWEEN p_start_time AND p_end_time
  ),
  activity_periods AS (
    SELECT
      CASE
        -- If gap is > 2 minutes, count only 1 minute for that heartbeat
        WHEN gap_minutes > 2 OR gap_minutes IS NULL THEN 1
        -- Otherwise count the actual gap (user was active)
        ELSE LEAST(gap_minutes, 2)
      END AS active_minutes
    FROM heartbeat_gaps
  )
  SELECT COALESCE(SUM(active_minutes)::INTEGER, 0)
  INTO v_active_minutes
  FROM activity_periods;

  RETURN v_active_minutes;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: update_daily_stats
-- ============================================================================
-- Updates or creates daily usage stats for a user on a specific date
CREATE OR REPLACE FUNCTION update_daily_usage_stats(
  p_user_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID AS $$
DECLARE
  v_company_id UUID;
  v_active_minutes INTEGER;
  v_session_count INTEGER;
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
BEGIN
  -- Get user's company
  SELECT company_id INTO v_company_id FROM user_profiles WHERE id = p_user_id;

  -- Set time range for the day
  v_start_time := p_date::TIMESTAMPTZ;
  v_end_time := (p_date + INTERVAL '1 day')::TIMESTAMPTZ;

  -- Calculate active minutes from heartbeats
  v_active_minutes := calculate_active_minutes(p_user_id, v_start_time, v_end_time);

  -- Count sessions for the day
  SELECT COUNT(*) INTO v_session_count
  FROM user_sessions
  WHERE user_id = p_user_id
    AND session_start >= v_start_time
    AND session_start < v_end_time;

  -- Insert or update daily stats
  INSERT INTO daily_usage_stats (
    user_id,
    company_id,
    date,
    total_active_minutes,
    session_count,
    transcript_views,
    audio_listen_minutes,
    uploads_count,
    first_activity,
    last_activity,
    updated_at
  )
  SELECT
    p_user_id,
    v_company_id,
    p_date,
    v_active_minutes,
    v_session_count,
    COUNT(*) FILTER (WHERE event_type = 'transcript_view'),
    COUNT(*) FILTER (WHERE event_type IN ('audio_play', 'audio_complete')) * 1, -- Rough estimate, can be refined
    COUNT(*) FILTER (WHERE event_type = 'transcript_upload'),
    MIN(occurred_at),
    MAX(occurred_at),
    NOW()
  FROM user_activity_events
  WHERE user_id = p_user_id
    AND occurred_at >= v_start_time
    AND occurred_at < v_end_time
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_active_minutes = EXCLUDED.total_active_minutes,
    session_count = EXCLUDED.session_count,
    transcript_views = EXCLUDED.transcript_views,
    audio_listen_minutes = EXCLUDED.audio_listen_minutes,
    uploads_count = EXCLUDED.uploads_count,
    first_activity = EXCLUDED.first_activity,
    last_activity = EXCLUDED.last_activity,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function: start_user_session
-- ============================================================================
-- Creates a new session when user logs in
CREATE OR REPLACE FUNCTION start_user_session(
  p_user_id UUID,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_session_id UUID;
  v_company_id UUID;
BEGIN
  -- Get user's company
  SELECT company_id INTO v_company_id FROM user_profiles WHERE id = p_user_id;

  -- Create new session
  INSERT INTO user_sessions (user_id, company_id, ip_address, user_agent, is_active)
  VALUES (p_user_id, v_company_id, p_ip_address, p_user_agent, true)
  RETURNING id INTO v_session_id;

  -- Log login event
  INSERT INTO user_activity_events (user_id, company_id, session_id, event_type)
  VALUES (p_user_id, v_company_id, v_session_id, 'login');

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: end_user_session
-- ============================================================================
-- Ends a session and updates daily stats
CREATE OR REPLACE FUNCTION end_user_session(
  p_session_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
BEGIN
  -- Get session info
  SELECT user_id, company_id INTO v_user_id, v_company_id
  FROM user_sessions WHERE id = p_session_id;

  -- End the session
  UPDATE user_sessions
  SET session_end = NOW(),
      is_active = false
  WHERE id = p_session_id;

  -- Log logout event
  INSERT INTO user_activity_events (user_id, company_id, session_id, event_type)
  VALUES (v_user_id, v_company_id, p_session_id, 'logout');

  -- Update daily stats for today
  PERFORM update_daily_usage_stats(v_user_id, CURRENT_DATE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: record_activity_heartbeat
-- ============================================================================
-- Records a heartbeat ping from the client
CREATE OR REPLACE FUNCTION record_activity_heartbeat(
  p_session_id UUID,
  p_page_path TEXT,
  p_activity_type TEXT DEFAULT 'page_active',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_heartbeat_id UUID;
  v_user_id UUID;
BEGIN
  -- Get user from session
  SELECT user_id INTO v_user_id FROM user_sessions WHERE id = p_session_id;

  -- Insert heartbeat
  INSERT INTO activity_heartbeats (session_id, user_id, page_path, activity_type, metadata)
  VALUES (p_session_id, v_user_id, p_page_path, p_activity_type, p_metadata)
  RETURNING id INTO v_heartbeat_id;

  -- Update session last_activity
  UPDATE user_sessions
  SET last_activity = NOW()
  WHERE id = p_session_id;

  RETURN v_heartbeat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- User Sessions Policies
CREATE POLICY "Users can read own sessions"
ON user_sessions FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can read all sessions"
ON user_sessions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'company_admin')
  )
);

CREATE POLICY "Users can insert own sessions"
ON user_sessions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Activity Heartbeats Policies
CREATE POLICY "Users can insert own heartbeats"
ON activity_heartbeats FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read all heartbeats"
ON activity_heartbeats FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'company_admin')
  )
);

-- Daily Usage Stats Policies
CREATE POLICY "Users can read own stats"
ON daily_usage_stats FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Super admins can read all stats"
ON daily_usage_stats FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  )
);

CREATE POLICY "Company admins can read company stats"
ON daily_usage_stats FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'company_admin'
      AND up.company_id = daily_usage_stats.company_id
  )
);

-- User Activity Events Policies
CREATE POLICY "Users can insert own events"
ON user_activity_events FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read all events"
ON user_activity_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'company_admin')
  )
);

-- ============================================================================
-- Maintenance: Auto-cleanup old heartbeats (optional, keep last 90 days)
-- ============================================================================
-- You can run this periodically via a cron job or pg_cron extension
CREATE OR REPLACE FUNCTION cleanup_old_heartbeats()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM activity_heartbeats
  WHERE heartbeat_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Complete!
-- ============================================================================
-- Migration complete. Next steps:
-- 1. Integrate session tracking in auth flow
-- 2. Add heartbeat tracking to frontend
-- 3. Build usage analytics dashboards
-- ============================================================================

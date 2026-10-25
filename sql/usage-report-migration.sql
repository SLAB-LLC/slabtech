-- ============================================================================
-- Usage Report Migration
-- ============================================================================
-- Run this once in the Supabase SQL Editor. It is safe to re-run.
--
-- What it does:
--   1. get_usage_report(...)  - one call that returns accurate, timezone-aware
--      usage per user per day (active time, listening, training video, web vs app,
--      visits, transcripts opened, uploads), plus top pages and time of day.
--      Powers the Usage pages on the website.
--   2. update_daily_usage_stats(...) - same signature as before, but counts
--      time the same way as the report, records real listening minutes
--      (it used to count 1 minute per play click), and can now be called by
--      the mobile app for the signed-in user.
--
-- How time is counted:
--   Every heartbeat claims the time since the user's previous heartbeat, up to
--   its own interval (30s on web, 60s in the app). A heartbeat after a long
--   gap claims one interval. Heartbeats from two tabs or from web + app at the
--   same moment overlap, so nothing is double counted.
--   A new "visit" starts after 30 minutes with no heartbeats.
-- ============================================================================

-- Training videos get their own heartbeat type
ALTER TABLE activity_heartbeats DROP CONSTRAINT IF EXISTS activity_heartbeats_activity_type_check;
ALTER TABLE activity_heartbeats ADD CONSTRAINT activity_heartbeats_activity_type_check
  CHECK (activity_type IN ('page_active', 'audio_playing', 'video_playing', 'transcript_viewing', 'upload_activity'));

CREATE INDEX IF NOT EXISTS idx_activity_heartbeats_time ON activity_heartbeats(heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_time ON user_activity_events(user_id, occurred_at);

-- ----------------------------------------------------------------------------
-- 1. get_usage_report
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_usage_report(
  p_start DATE,
  p_end DATE,                       -- inclusive
  p_tz TEXT DEFAULT 'UTC',
  p_company_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_company UUID;
  v_from TIMESTAMPTZ;
  v_to TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, company_id INTO v_role, v_company
  FROM user_profiles WHERE id = auth.uid();

  -- Scope what the caller may see
  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'company_admin' THEN
    p_company_id := v_company;
  ELSE
    p_company_id := NULL;
    p_user_id := auth.uid();
  END IF;

  IF p_end < p_start THEN
    RAISE EXCEPTION 'p_end must be on or after p_start';
  END IF;
  IF p_end - p_start > 366 THEN
    p_start := p_end - 366;
  END IF;

  -- Raises on an unknown timezone name
  PERFORM now() AT TIME ZONE p_tz;

  v_from := p_start::timestamp AT TIME ZONE p_tz;
  v_to := (p_end + 1)::timestamp AT TIME ZONE p_tz;

  WITH scope AS (
    SELECT up.id, up.email, up.display_name, up.role, up.is_active,
           up.company_id, up.created_at, c.name AS company_name, c.slug AS company_slug
    FROM user_profiles up
    LEFT JOIN companies c ON c.id = up.company_id
    WHERE (p_company_id IS NULL OR up.company_id = p_company_id)
      AND (p_user_id IS NULL OR up.id = p_user_id)
  ),
  hb AS (
    SELECT
      h.user_id,
      h.heartbeat_at,
      h.activity_type,
      h.page_path,
      CASE WHEN s.user_agent LIKE 'SLAB-mobile%' THEN 'app' ELSE 'web' END AS platform,
      EXTRACT(EPOCH FROM h.heartbeat_at
        - LAG(h.heartbeat_at) OVER (PARTITION BY h.user_id ORDER BY h.heartbeat_at)) AS gap
    FROM activity_heartbeats h
    JOIN scope ON scope.id = h.user_id
    LEFT JOIN user_sessions s ON s.id = h.session_id
    -- look back 30 minutes so the first heartbeat in range gets its real gap
    WHERE h.heartbeat_at >= v_from - INTERVAL '30 minutes'
      AND h.heartbeat_at < v_to
  ),
  credited AS (
    SELECT
      user_id,
      activity_type,
      platform,
      page_path,
      heartbeat_at,
      (heartbeat_at AT TIME ZONE p_tz)::date AS day,
      EXTRACT(HOUR FROM heartbeat_at AT TIME ZONE p_tz)::int AS hour,
      LEAST(COALESCE(gap, nominal), nominal) AS secs,
      (gap IS NULL OR gap > 1800) AS new_visit
    FROM (
      SELECT hb.*, CASE WHEN platform = 'app' THEN 60 ELSE 30 END AS nominal FROM hb
    ) x
    WHERE heartbeat_at >= v_from
  ),
  time_daily AS (
    SELECT
      user_id, day,
      SUM(secs) AS active_seconds,
      SUM(secs) FILTER (WHERE activity_type = 'audio_playing') AS listening_seconds,
      SUM(secs) FILTER (WHERE activity_type = 'video_playing') AS video_seconds,
      SUM(secs) FILTER (WHERE platform = 'web') AS web_seconds,
      SUM(secs) FILTER (WHERE platform = 'app') AS app_seconds,
      COUNT(*) FILTER (WHERE new_visit) AS visits,
      MIN(heartbeat_at) AS first_seen,
      MAX(heartbeat_at) AS last_seen
    FROM credited
    GROUP BY user_id, day
  ),
  views_daily AS (
    -- Web logs a page_view per transcript page; the app logs transcript_view.
    -- Count each transcript once per user per day.
    SELECT
      e.user_id,
      (e.occurred_at AT TIME ZONE p_tz)::date AS day,
      COUNT(DISTINCT COALESCE(
        e.event_data->>'transcript_id',
        substring(e.event_data->>'path' FROM '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}'),
        e.id::text
      )) AS transcript_views
    FROM user_activity_events e
    JOIN scope ON scope.id = e.user_id
    WHERE e.occurred_at >= v_from AND e.occurred_at < v_to
      AND (
        e.event_type = 'transcript_view'
        OR (e.event_type = 'page_view' AND e.event_data->>'path' ~ '/transcripts/[0-9a-fA-F-]{36}')
      )
    GROUP BY e.user_id, day
  ),
  uploads_daily AS (
    SELECT t.uploaded_by AS user_id, (t.created_at AT TIME ZONE p_tz)::date AS day, COUNT(*) AS uploads
    FROM transcripts t
    JOIN scope ON scope.id = t.uploaded_by
    WHERE t.created_at >= v_from AND t.created_at < v_to
    GROUP BY t.uploaded_by, day
  ),
  daily AS (
    SELECT
      COALESCE(td.user_id, vd.user_id, ud.user_id) AS user_id,
      COALESCE(td.day, vd.day, ud.day) AS day,
      COALESCE(td.active_seconds, 0)::int AS active_seconds,
      COALESCE(td.listening_seconds, 0)::int AS listening_seconds,
      COALESCE(td.video_seconds, 0)::int AS video_seconds,
      COALESCE(td.web_seconds, 0)::int AS web_seconds,
      COALESCE(td.app_seconds, 0)::int AS app_seconds,
      COALESCE(td.visits, 0)::int AS visits,
      COALESCE(vd.transcript_views, 0)::int AS transcript_views,
      COALESCE(ud.uploads, 0)::int AS uploads,
      td.first_seen,
      td.last_seen
    FROM time_daily td
    FULL OUTER JOIN views_daily vd ON vd.user_id = td.user_id AND vd.day = td.day
    FULL OUTER JOIN uploads_daily ud
      ON ud.user_id = COALESCE(td.user_id, vd.user_id) AND ud.day = COALESCE(td.day, vd.day)
  ),
  pages AS (
    SELECT
      regexp_replace(page_path, '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}', ':id', 'g') AS path,
      platform,
      SUM(secs)::int AS seconds
    FROM credited
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT 15
  ),
  hours AS (
    SELECT hour, SUM(secs)::int AS seconds FROM credited GROUP BY hour
  ),
  users AS (
    SELECT
      s.*,
      (SELECT MAX(h.heartbeat_at) FROM activity_heartbeats h WHERE h.user_id = s.id) AS last_seen_ever
    FROM scope s
  )
  SELECT jsonb_build_object(
    'timezone', p_tz,
    'start', p_start,
    'end', p_end,
    'users', COALESCE((SELECT jsonb_agg(to_jsonb(u)) FROM users u), '[]'::jsonb),
    'daily', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily d), '[]'::jsonb),
    'pages', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seconds DESC) FROM pages p), '[]'::jsonb),
    'hours', COALESCE((SELECT jsonb_agg(to_jsonb(hr) ORDER BY hr.hour) FROM hours hr), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_usage_report(DATE, DATE, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_usage_report(DATE, DATE, TEXT, UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. update_daily_usage_stats (same signature; UTC days as before)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_daily_usage_stats(
  p_user_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_start TIMESTAMPTZ := p_date::timestamp AT TIME ZONE 'UTC';
  v_end TIMESTAMPTZ := (p_date + 1)::timestamp AT TIME ZONE 'UTC';
  v_active_seconds NUMERIC;
  v_listen_seconds NUMERIC;
  v_session_count INTEGER;
BEGIN
  -- Service role (auth.uid() is null), the user themselves, or a super admin
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id AND NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT company_id INTO v_company_id FROM user_profiles WHERE id = p_user_id;

  WITH hb AS (
    SELECT
      h.heartbeat_at,
      h.activity_type,
      CASE WHEN s.user_agent LIKE 'SLAB-mobile%' THEN 60 ELSE 30 END AS nominal,
      EXTRACT(EPOCH FROM h.heartbeat_at
        - LAG(h.heartbeat_at) OVER (ORDER BY h.heartbeat_at)) AS gap
    FROM activity_heartbeats h
    LEFT JOIN user_sessions s ON s.id = h.session_id
    WHERE h.user_id = p_user_id
      AND h.heartbeat_at >= v_start - INTERVAL '30 minutes'
      AND h.heartbeat_at < v_end
  )
  SELECT
    COALESCE(SUM(LEAST(COALESCE(gap, nominal), nominal)), 0),
    COALESCE(SUM(LEAST(COALESCE(gap, nominal), nominal)) FILTER (WHERE activity_type = 'audio_playing'), 0)
  INTO v_active_seconds, v_listen_seconds
  FROM hb
  WHERE heartbeat_at >= v_start;

  SELECT COUNT(*) INTO v_session_count
  FROM user_sessions
  WHERE user_id = p_user_id AND session_start >= v_start AND session_start < v_end;

  INSERT INTO daily_usage_stats (
    user_id, company_id, date, total_active_minutes, session_count,
    transcript_views, audio_listen_minutes, uploads_count,
    first_activity, last_activity, updated_at
  )
  SELECT
    p_user_id,
    v_company_id,
    p_date,
    ROUND(v_active_seconds / 60.0)::int,
    v_session_count,
    COUNT(DISTINCT COALESCE(
      e.event_data->>'transcript_id',
      substring(e.event_data->>'path' FROM '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}'),
      e.id::text
    )) FILTER (
      WHERE e.event_type = 'transcript_view'
         OR (e.event_type = 'page_view' AND e.event_data->>'path' ~ '/transcripts/[0-9a-fA-F-]{36}')
    ),
    ROUND(v_listen_seconds / 60.0)::int,
    (SELECT COUNT(*) FROM transcripts t
      WHERE t.uploaded_by = p_user_id AND t.created_at >= v_start AND t.created_at < v_end),
    MIN(e.occurred_at),
    MAX(e.occurred_at),
    NOW()
  FROM user_activity_events e
  WHERE e.user_id = p_user_id
    AND e.occurred_at >= v_start
    AND e.occurred_at < v_end
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
$$;

REVOKE ALL ON FUNCTION public.update_daily_usage_stats(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_daily_usage_stats(UUID, DATE) TO authenticated, service_role;

-- Optional: recompute the last 30 days of daily stats with the new counting.
-- Uncomment and run once if you want history to match.
-- SELECT update_daily_usage_stats(d.user_id, d.date)
-- FROM daily_usage_stats d WHERE d.date >= CURRENT_DATE - 30;

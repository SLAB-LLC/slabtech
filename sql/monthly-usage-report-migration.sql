-- Monthly engagement report (Ace contract 7.3).
--
-- company_monthly_report(company, start, end, tz) returns one JSON object:
--   { company, start, end, timezone, users: [...], invites: [...] }
-- users: every rep/manager/owner in the company with team, manager, last sign-in,
--   last active, time spent in the period, active days, XP, training completion.
-- invites: invitations that were never accepted.
--
-- Time spent uses the same rule as get_usage_report: each heartbeat counts as
-- min(gap since the previous heartbeat, its interval), 60s in the app, 30s on web,
-- so two tabs or web + app at once never double count. An active day is 2+ minutes.
--
-- Only the service role can call it. The API routes check who is asking
-- (cron secret, or a company_admin / super_admin of that company) first.

CREATE OR REPLACE FUNCTION company_monthly_report(
  p_company_id uuid,
  p_start date,
  p_end date,            -- inclusive
  p_tz text DEFAULT 'America/Denver'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := (p_start::timestamp AT TIME ZONE p_tz);
  v_to   timestamptz := ((p_end + 1)::timestamp AT TIME ZONE p_tz);
  v_videos int;
  v_result jsonb;
BEGIN
  SELECT COUNT(*) INTO v_videos FROM training_videos WHERE company_id = p_company_id;

  WITH members AS (
    SELECT up.id, up.email, up.display_name, up.role, up.is_active, up.created_at,
           up.team_id, t.name AS team_name, m.display_name AS manager_name, m.email AS manager_email
    FROM user_profiles up
    LEFT JOIN teams t ON t.id = up.team_id
    LEFT JOIN user_profiles m ON m.id = t.manager_id
    WHERE up.company_id = p_company_id
  ),
  hb AS (
    SELECT h.user_id, h.heartbeat_at, h.activity_type,
           CASE WHEN s.user_agent LIKE 'SLAB-mobile%' THEN 60 ELSE 30 END AS nominal,
           EXTRACT(EPOCH FROM h.heartbeat_at
             - LAG(h.heartbeat_at) OVER (PARTITION BY h.user_id ORDER BY h.heartbeat_at)) AS gap
    FROM activity_heartbeats h
    JOIN members ON members.id = h.user_id
    LEFT JOIN user_sessions s ON s.id = h.session_id
    WHERE h.heartbeat_at >= v_from - INTERVAL '30 minutes' AND h.heartbeat_at < v_to
  ),
  daily AS (
    SELECT user_id, (heartbeat_at AT TIME ZONE p_tz)::date AS day,
           SUM(LEAST(COALESCE(gap, nominal), nominal)) AS secs,
           SUM(LEAST(COALESCE(gap, nominal), nominal)) FILTER (WHERE activity_type = 'audio_playing') AS listen
    FROM hb WHERE heartbeat_at >= v_from
    GROUP BY 1, 2
  ),
  time_tot AS (
    SELECT user_id, SUM(secs)::int AS active_seconds, COALESCE(SUM(listen), 0)::int AS listening_seconds,
           COUNT(*) FILTER (WHERE secs >= 120)::int AS active_days
    FROM daily GROUP BY 1
  ),
  last_hb AS (
    SELECT h.user_id, MAX(h.heartbeat_at) AS last_active
    FROM activity_heartbeats h JOIN members ON members.id = h.user_id
    GROUP BY 1
  ),
  xp_period AS (
    SELECT user_id, SUM(amount)::int AS xp,
           COUNT(DISTINCT source_id) FILTER (WHERE reason = 'lesson_complete')::int AS lessons
    FROM xp_events
    WHERE company_id = p_company_id AND created_at >= v_from AND created_at < v_to
    GROUP BY 1
  ),
  lessons_all AS (
    SELECT user_id, COUNT(DISTINCT source_id)::int AS lessons
    FROM xp_events WHERE company_id = p_company_id AND reason = 'lesson_complete'
    GROUP BY 1
  ),
  videos_done AS (
    SELECT vc.user_id, COUNT(DISTINCT vc.video_id)::int AS done
    FROM video_completions vc JOIN training_videos v ON v.id = vc.video_id
    WHERE v.company_id = p_company_id
    GROUP BY 1
  ),
  rows AS (
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(m.display_name, ''), m.email),
      'email', m.email,
      'role', m.role,
      'status', CASE WHEN m.is_active IS FALSE THEN 'inactive' ELSE 'active' END,
      'team', m.team_name,
      'manager', COALESCE(NULLIF(m.manager_name, ''), m.manager_email),
      'joined', m.created_at,
      'last_sign_in', au.last_sign_in_at,
      'last_active', lh.last_active,
      'active_seconds', COALESCE(tt.active_seconds, 0),
      'listening_seconds', COALESCE(tt.listening_seconds, 0),
      'active_days', COALESCE(tt.active_days, 0),
      'xp_period', COALESCE(xp.xp, 0),
      'xp_total', COALESCE(xt.total_xp, 0),
      'streak', COALESCE(st.current_streak, 0),
      'lessons_period', COALESCE(xp.lessons, 0),
      'lessons_total', COALESCE(la.lessons, 0),
      'videos_done', COALESCE(vd.done, 0),
      'videos_total', v_videos
    ) AS j, m.team_name, m.display_name, m.email
    FROM members m
    LEFT JOIN auth.users au ON au.id = m.id
    LEFT JOIN last_hb lh ON lh.user_id = m.id
    LEFT JOIN time_tot tt ON tt.user_id = m.id
    LEFT JOIN xp_period xp ON xp.user_id = m.id
    LEFT JOIN user_xp_totals xt ON xt.user_id = m.id
    LEFT JOIN user_streaks st ON st.user_id = m.id
    LEFT JOIN lessons_all la ON la.user_id = m.id
    LEFT JOIN videos_done vd ON vd.user_id = m.id
  )
  SELECT jsonb_build_object(
    'company', (SELECT jsonb_build_object('id', id, 'name', name, 'slug', slug) FROM companies WHERE id = p_company_id),
    'start', p_start, 'end', p_end, 'timezone', p_tz,
    'users', COALESCE((SELECT jsonb_agg(j ORDER BY team_name NULLS LAST, lower(COALESCE(display_name, email))) FROM rows), '[]'::jsonb),
    'invites', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'email', ci.email, 'role', ci.role, 'team', t.name,
        'invited', ci.created_at, 'expires', ci.expires_at,
        'expired', ci.expires_at IS NOT NULL AND ci.expires_at < now()
      ) ORDER BY ci.created_at)
      FROM company_invites ci LEFT JOIN teams t ON t.id = ci.team_id
      WHERE ci.company_id = p_company_id AND ci.accepted IS NOT TRUE
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION company_monthly_report(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION company_monthly_report(uuid, date, date, text) TO service_role;

-- Which companies get the email on the 1st, and who it goes to (blank = the company's owners).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_report_to text;
-- First month to report (blank = every month). Ace's contract term starts 2026-12-01,
-- so the first email goes out 2027-01-01 with December.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS monthly_report_from date;
UPDATE companies SET monthly_report_enabled = true, monthly_report_from = '2026-12-01' WHERE slug = 'ace';

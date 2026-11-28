-- Engagement nudges (2026-11-28). All functions are service role only; the API routes
-- check who is asking first.
--   1. Sign-in emails for reps who have never signed in (owner clicks "Email" on the Usage page).
--   2. Month-end leaderboard pushes on the 25th and the last day of the month (every company).
--   3. Weekly Monday email to managers (or owners, for reps with no team) listing reps who
--      haven't opened SLAB in 7 days (companies with weekly_nudge_enabled).

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS sign_in_nudged_at timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS weekly_nudge_enabled boolean NOT NULL DEFAULT false;
UPDATE companies SET weekly_nudge_enabled = true WHERE slug = 'ace';

-- Active reps and managers in a company who have never signed in.
CREATE OR REPLACE FUNCTION company_never_signed_in(p_company_id uuid)
RETURNS TABLE (id uuid, email text, display_name text, role text, created_at timestamptz, sign_in_nudged_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT up.id, up.email, up.display_name, up.role, up.created_at, up.sign_in_nudged_at
  FROM user_profiles up
  JOIN auth.users au ON au.id = up.id
  WHERE up.company_id = p_company_id
    AND up.is_active IS NOT FALSE
    AND up.role IN ('user', 'manager')
    AND au.last_sign_in_at IS NULL
  ORDER BY lower(COALESCE(NULLIF(up.display_name, ''), up.email));
$$;
REVOKE ALL ON FUNCTION company_never_signed_in(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION company_never_signed_in(uuid) TO service_role;

-- Everyone on a company board (all-time XP, same order as company_podium) with their rank
-- and how far behind the next spot they are.
CREATE OR REPLACE FUNCTION company_board_positions()
RETURNS TABLE (user_id uuid, company_id uuid, company_name text, rank int, total int, gap_to_next int, board_size int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH totals AS (
    SELECT up.id AS user_id, up.company_id, SUM(x.amount)::int AS total, MAX(x.created_at) AS reached
    FROM user_profiles up
    JOIN xp_events x ON x.user_id = up.id
    WHERE up.is_active = true AND up.company_id IS NOT NULL AND up.role IN ('user', 'manager')
    GROUP BY up.id, up.company_id
    HAVING SUM(x.amount) > 0
  ),
  ranked AS (
    SELECT t.*,
      ROW_NUMBER() OVER (PARTITION BY t.company_id ORDER BY t.total DESC, t.reached ASC)::int AS rank,
      LAG(t.total) OVER (PARTITION BY t.company_id ORDER BY t.total DESC, t.reached ASC) AS ahead,
      COUNT(*) OVER (PARTITION BY t.company_id)::int AS board_size
    FROM totals t
  )
  SELECT r.user_id, r.company_id, trim(c.name), r.rank, r.total,
         CASE WHEN r.ahead IS NULL THEN NULL ELSE (r.ahead - r.total + 1)::int END,
         r.board_size
  FROM ranked r JOIN companies c ON c.id = r.company_id;
$$;
REVOKE ALL ON FUNCTION company_board_positions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION company_board_positions() TO service_role;

-- Active reps (role user) in weekly-nudge companies with no SLAB activity in the last 7 days.
CREATE OR REPLACE FUNCTION weekly_inactive_reps()
RETURNS TABLE (company_id uuid, company_name text, company_slug text, team_id uuid, team_name text,
               manager_id uuid, user_id uuid, name text, email text, last_active timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, trim(c.name), c.slug, t.id, t.name, t.manager_id, up.id,
         COALESCE(NULLIF(up.display_name, ''), up.email), up.email,
         (SELECT MAX(h.heartbeat_at) FROM activity_heartbeats h WHERE h.user_id = up.id)
  FROM user_profiles up
  JOIN companies c ON c.id = up.company_id AND c.weekly_nudge_enabled
  LEFT JOIN teams t ON t.id = up.team_id
  WHERE up.role = 'user' AND up.is_active IS NOT FALSE
    AND NOT EXISTS (
      SELECT 1 FROM activity_heartbeats h
      WHERE h.user_id = up.id AND h.heartbeat_at >= now() - interval '7 days'
    );
$$;
REVOKE ALL ON FUNCTION weekly_inactive_reps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION weekly_inactive_reps() TO service_role;

-- ============================================================================
-- Solo mode and the global leaderboard (slab-mobile)
-- ============================================================================
-- Reps who aren't registered with a company still sign in to the app. They get
-- the Vault's global days, Ask Marshall, Marshall's videos and the global
-- leaderboard; company features stay locked. Two read-only functions give them
-- (and everyone else) what row-level security keeps to one company:
--
--   global_leaderboard(p_limit)  every active rep ranked by total XP, the
--                                caller always included. Names are first name
--                                plus last initial; no ids or emails leave.
--   marshall_videos()            Marshall's training videos (Ace's library,
--                                matched like company-app-config-migration.sql
--                                matches Ace) for his page in the Vault.
--
-- The training-videos storage bucket is already readable by every signed-in
-- user, so the app signs video URLs the same way it does for Ace reps.
--
-- Requires xp-engine-migration.sql and avatars-migration.sql. Safe to run more
-- than once.
-- ============================================================================

CREATE OR REPLACE FUNCTION global_leaderboard(p_limit INT DEFAULT 50)
RETURNS TABLE (
  rank BIGINT,
  name TEXT,
  company_name TEXT,
  total_xp INT,
  streak INT,
  look JSONB,
  is_me BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT user_id, COALESCE(SUM(amount), 0)::INT AS total_xp
    FROM xp_events
    GROUP BY user_id
  ),
  ranked AS (
    SELECT
      RANK() OVER (ORDER BY COALESCE(t.total_xp, 0) DESC) AS rank,
      up.id AS user_id,
      -- "Jake Ramirez" -> "Jake R."; an email-only profile shows the part before the @
      CASE
        WHEN COALESCE(NULLIF(trim(up.display_name), ''), '') = '' OR up.display_name LIKE '%@%'
          THEN split_part(COALESCE(up.display_name, up.email, 'Rep'), '@', 1)
        WHEN array_length(np.parts, 1) > 1
          THEN np.parts[1] || ' ' || upper(left(np.parts[array_length(np.parts, 1)], 1)) || '.'
        ELSE trim(up.display_name)
      END AS name,
      c.name AS company_name,
      COALESCE(t.total_xp, 0) AS total_xp,
      COALESCE(us.current_streak, 0) AS streak,
      ua.look
    FROM user_profiles up
    CROSS JOIN LATERAL (SELECT regexp_split_to_array(trim(COALESCE(up.display_name, '')), '\s+') AS parts) np
    LEFT JOIN totals t ON t.user_id = up.id
    LEFT JOIN companies c ON c.id = up.company_id
    LEFT JOIN user_streaks us ON us.user_id = up.id
    LEFT JOIN user_avatars ua ON ua.user_id = up.id
    WHERE up.is_active = true
      AND (COALESCE(t.total_xp, 0) > 0 OR up.id = auth.uid())
  )
  SELECT rank, name, company_name, total_xp, streak, look, user_id = auth.uid() AS is_me
  FROM ranked
  WHERE auth.uid() IS NOT NULL
    AND (rank <= LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) OR user_id = auth.uid())
  ORDER BY rank, name;
$$;

REVOKE ALL ON FUNCTION global_leaderboard(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION global_leaderboard(INT) TO authenticated;

CREATE OR REPLACE FUNCTION marshall_videos()
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  duration INT,
  video_type TEXT,
  youtube_url TEXT,
  storage_path TEXT,
  playlist TEXT,
  playlist_order BIGINT,
  playlist_position INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ace AS (
    SELECT id FROM companies
    WHERE slug ILIKE 'ace%' OR name ILIKE 'ace%'
    ORDER BY created_at
    LIMIT 1
  ),
  lists AS (
    SELECT p.id, p.name, ROW_NUMBER() OVER (ORDER BY p.created_at) AS ord
    FROM training_playlists p
    WHERE p.company_id = (SELECT id FROM ace)
  ),
  placed AS (
    -- each video in its first playlist only
    SELECT DISTINCT ON (pv.video_id) pv.video_id, l.name, l.ord, pv.position
    FROM playlist_videos pv
    JOIN lists l ON l.id = pv.playlist_id
    ORDER BY pv.video_id, l.ord, pv.position
  )
  SELECT
    v.id, v.title, v.description, v.duration::INT, v.video_type, v.youtube_url, v.storage_path,
    COALESCE(pl.name, 'More videos') AS playlist,
    COALESCE(pl.ord, 1000000) AS playlist_order,
    COALESCE(pl.position, 0)::INT AS playlist_position
  FROM training_videos v
  LEFT JOIN placed pl ON pl.video_id = v.id
  WHERE v.company_id = (SELECT id FROM ace)
    AND auth.uid() IS NOT NULL
  ORDER BY playlist_order, playlist_position, v.created_at;
$$;

REVOKE ALL ON FUNCTION marshall_videos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshall_videos() TO authenticated;

-- End of solo-mode-migration.sql

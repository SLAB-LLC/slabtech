-- ============================================================================
-- Golden Door awards
-- ============================================================================
-- SLAB admins mark reps who have won a Golden Door, and how many times. The app
-- shows a gold door badge (with x2, x3... in the corner) next to their name on
-- the leaderboard, a shiny gold row, a golden doorway behind their rep when you
-- tap them, and unlocks their exclusive gear.
--
--   rep_awards              one row per awarded rep. Every signed-in user can
--                           read it (it's shown on the leaderboard); nobody can
--                           write it from the app. The website's admin user
--                           page writes it with the service role, super admins
--                           only (/api/admin/users/[id]/awards).
--   global_leaderboard()    same columns as before; a Golden Door winner's look
--                           now carries goldenDoors so the global board shows it.
--
-- Requires solo-mode-migration.sql. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rep_awards (
  user_id UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  golden_doors INT NOT NULL DEFAULT 0 CHECK (golden_doors BETWEEN 0 AND 20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

ALTER TABLE rep_awards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users read awards" ON rep_awards;
CREATE POLICY "Signed-in users read awards" ON rep_awards
  FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON rep_awards FROM anon, authenticated;
GRANT SELECT ON rep_awards TO authenticated;

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
      CASE WHEN c.slug = 'slab-internal' THEN NULL ELSE c.name END AS company_name,
      COALESCE(t.total_xp, 0) AS total_xp,
      COALESCE(us.current_streak, 0) AS streak,
      -- Golden Door winners carry their count inside the look, so the app reads it with the gear
      CASE WHEN COALESCE(ra.golden_doors, 0) > 0
        THEN COALESCE(ua.look, '{}'::jsonb) || jsonb_build_object('goldenDoors', ra.golden_doors)
        ELSE ua.look END AS look
    FROM user_profiles up
    CROSS JOIN LATERAL (SELECT regexp_split_to_array(trim(COALESCE(up.display_name, '')), '\s+') AS parts) np
    LEFT JOIN totals t ON t.user_id = up.id
    LEFT JOIN companies c ON c.id = up.company_id
    LEFT JOIN user_streaks us ON us.user_id = up.id
    LEFT JOIN user_avatars ua ON ua.user_id = up.id
    LEFT JOIN rep_awards ra ON ra.user_id = up.id
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

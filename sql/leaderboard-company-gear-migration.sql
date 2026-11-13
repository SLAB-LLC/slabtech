-- Global leaderboard: each rep in their own company's gear (2026-11-13)
-- The global board mixes companies. Until now the app drew every rep in the viewer's company colors
-- (a SLAB rep showed up in ProTerra green). global_leaderboard now adds look.gear for each rep, built
-- the same way the app builds a company's gear brand. Same columns as before, so older apps are fine.
-- Also gives ProTerra's app a pink SLAB logo (theme.slabLogo).
-- Requires golden-door-migration.sql and company-app-config-migration.sql. Safe to run more than once.

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
      -- Golden Door winners carry their count inside the look, so the app reads it with the gear;
      -- every rep also carries their company's gear brand (look.gear), so the global board draws each
      -- rep in their own company's colors (SLAB orange, Ace gold, ProTerra pink...)
      COALESCE(ua.look, '{}'::jsonb)
        || CASE WHEN COALESCE(ra.golden_doors, 0) > 0 THEN jsonb_build_object('goldenDoors', ra.golden_doors) ELSE '{}'::jsonb END
        || jsonb_build_object('gear', gb.gear) AS look
    FROM user_profiles up
    CROSS JOIN LATERAL (SELECT regexp_split_to_array(trim(COALESCE(up.display_name, '')), '\s+') AS parts) np
    LEFT JOIN totals t ON t.user_id = up.id
    LEFT JOIN companies c ON c.id = up.company_id
    LEFT JOIN user_streaks us ON us.user_id = up.id
    LEFT JOIN user_avatars ua ON ua.user_id = up.id
    LEFT JOIN rep_awards ra ON ra.user_id = up.id
    LEFT JOIN company_app_config cac ON cac.company_id = c.id
    -- Same rules as the app (src/avatar gearBrand): the config's gear, else the company name, its accent
    -- or primary color; reps without a company (or in SLAB internal) wear SLAB orange
    CROSS JOIN LATERAL (
      SELECT CASE WHEN c.id IS NULL OR c.slug = 'slab-internal'
        THEN jsonb_build_object('name', 'SLAB', 'letters', 'SLAB', 'primary', '#F4711E', 'dark', '#1b1b20')
        ELSE jsonb_build_object(
          'name', COALESCE(cac.theme->'gear'->>'name', c.name),
          'letters', upper(left(regexp_replace(COALESCE(cac.theme->'gear'->>'letters', cac.theme->'gear'->>'name', c.name), '[^A-Za-z0-9]', '', 'g'), 4)),
          'primary', COALESCE(cac.theme->'gear'->>'primary', cac.theme->'colors'->>'accent', c.primary_color, '#F4711E'),
          'dark', COALESCE(cac.theme->'gear'->>'dark', '#1b1b20'))
        END AS gear
    ) gb
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

-- ProTerra: SLAB's logo in ProTerra pink in their app
UPDATE company_app_config a
SET theme = a.theme || '{"slabLogo": "#F992A3"}'::jsonb
FROM companies c
WHERE c.id = a.company_id AND c.slug = 'proterra';

-- End of leaderboard-company-gear-migration.sql

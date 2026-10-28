-- ============================================================================
-- Pixel reps: each rep's avatar look, plus gear branding for Ace
-- ============================================================================
-- user_avatars holds one row per rep with their look as JSON:
--   { skin, hair, hairColor, eyes, face, top, hat, pants, shoes, extra, ride }
-- Every value is an id from the app's sprite engine (src/avatar in slab-mobile).
-- Gear unlocks are by total XP and are checked in the app; the look itself
-- carries no XP, so a rep can only show off gear they could pick.
--
-- Reps read their own look and their company's looks (leaderboard, Vault),
-- and write only their own.
--
-- Also adds theme.gear to Ace's app config, for databases where
-- company-app-config-migration.sql ran before gear existed.
--
-- Requires company-app-config-migration.sql. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  look JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_avatars_company ON user_avatars(company_id);

ALTER TABLE user_avatars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reps read own and company avatars" ON user_avatars;
CREATE POLICY "Reps read own and company avatars" ON user_avatars FOR SELECT USING (
  user_id = auth.uid()
  OR company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "Reps insert own avatar" ON user_avatars;
CREATE POLICY "Reps insert own avatar" ON user_avatars FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND company_id IS NOT DISTINCT FROM (SELECT company_id FROM user_profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Reps update own avatar" ON user_avatars;
CREATE POLICY "Reps update own avatar" ON user_avatars FOR UPDATE USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
  AND company_id IS NOT DISTINCT FROM (SELECT company_id FROM user_profiles WHERE id = auth.uid())
);

CREATE OR REPLACE FUNCTION touch_user_avatars_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_user_avatars_updated_at ON user_avatars;
CREATE TRIGGER trg_user_avatars_updated_at
  BEFORE UPDATE ON user_avatars
  FOR EACH ROW EXECUTE FUNCTION touch_user_avatars_updated_at();

GRANT SELECT, INSERT, UPDATE ON user_avatars TO authenticated;

-- Ace's gear: gold tees with ACE on the back
UPDATE company_app_config cfg
SET theme = jsonb_set(
  cfg.theme,
  '{gear}',
  '{ "name": "Ace", "letters": "ACE", "primary": "#daae5d", "dark": "#1b1b20" }'::jsonb
)
FROM companies c
WHERE c.id = cfg.company_id
  AND (c.slug ILIKE 'ace%' OR c.name ILIKE 'ace%')
  AND NOT (cfg.theme ? 'gear');

-- End of avatars-migration.sql

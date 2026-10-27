-- ============================================================================
-- Company app config (per-company theme, features and labels for the app)
-- ============================================================================
-- One row per company. The slab-mobile app deep-merges each JSON column over
-- its built-in SLAB defaults (slab-mobile src/tenant/defaults.ts), so a row
-- only needs the keys that differ. Companies with no row get SLAB's look.
--
--   theme    : brandName, cobrand, logoUrl, wordmarkUrl, statusBar, appStyle,
--              colors{background, backgroundGradient[3], surface, surfaceRaised,
--              accent, accentSoft, accentLine, onAccent, text, textMuted,
--              header, tabBar, danger, success}, coach{name, avatarUrl}
--   features : street, vault, vaultUnlockXp, chatUnlockXp, aiCoach, rides,
--              bossFights, bookTests, rookieVet, monthlyPrize,
--              powerHour{enabled, startHour, multiplier}, streakTiers[{days, mult}],
--              xp{book, bossFirstWin, bossRematch, vaultPerMinute, vaultDailyCap,
--              libraryFirstOpen}
--   labels   : tabs{lab, vault, chat, leaderboard, library}
--
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_app_config (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE company_app_config ENABLE ROW LEVEL SECURITY;

-- Members read their own company's config
DROP POLICY IF EXISTS "Members read own company app config" ON company_app_config;
CREATE POLICY "Members read own company app config"
ON company_app_config FOR SELECT
TO authenticated
USING (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
);

-- Company admins manage their own company's config
DROP POLICY IF EXISTS "Company admins manage own company app config" ON company_app_config;
CREATE POLICY "Company admins manage own company app config"
ON company_app_config FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'company_admin'
    AND user_profiles.company_id = company_app_config.company_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'company_admin'
    AND user_profiles.company_id = company_app_config.company_id
  )
);

-- Super admins manage every company's config
DROP POLICY IF EXISTS "Super admins manage all company app config" ON company_app_config;
CREATE POLICY "Super admins manage all company app config"
ON company_app_config FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'super_admin'
  )
);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION touch_company_app_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_app_config_touch ON company_app_config;
CREATE TRIGGER company_app_config_touch
BEFORE UPDATE ON company_app_config
FOR EACH ROW EXECUTE FUNCTION touch_company_app_config();

-- ============================================================================
-- Seed: Ace (black and gold, from the Ace x SLAB demo)
-- Matches the company by slug or name starting with "ace". Re-running
-- overwrites Ace's row with these values.
-- ============================================================================

INSERT INTO company_app_config (company_id, theme, features, labels)
SELECT c.id,
  '{
    "cobrand": "SLAB x ACE",
    "statusBar": "light",
    "appStyle": "game",
    "colors": {
      "background": "#0c0c0e",
      "backgroundGradient": ["#050506", "#0c0c0e", "#161618"],
      "surface": "#161618",
      "surfaceRaised": "#1f1f22",
      "accent": "#daae5d",
      "accentSoft": "#2e2614",
      "accentLine": "rgba(218,174,93,0.38)",
      "onAccent": "#0c0c0e",
      "text": "#f2f0e9",
      "textMuted": "#a39d90",
      "header": "#0c0c0e",
      "tabBar": "#0c0c0e",
      "success": "#34c77b"
    },
    "coach": { "name": "Marshall" }
  }'::jsonb,
  '{
    "monthlyPrize": true,
    "vaultUnlockXp": 500
  }'::jsonb,
  '{}'::jsonb
FROM companies c
WHERE c.slug ILIKE 'ace%' OR c.name ILIKE 'ace%'
ON CONFLICT (company_id) DO UPDATE
SET theme = EXCLUDED.theme,
    features = EXCLUDED.features,
    labels = EXCLUDED.labels;

-- Check: should list Ace
SELECT c.name, c.slug, a.theme->>'cobrand' AS cobrand
FROM company_app_config a JOIN companies c ON c.id = a.company_id;

-- End of company-app-config-migration.sql

-- ProTerra Pest Control: company branding for the app and the company portal (2026-11-13)
-- Run once in the Supabase SQL editor, after company-app-config-migration.sql.
-- Re-running is safe: it overwrites ProTerra's branding with these values.
--
-- Brand (from proterracontrol.com): pink #F992A3 ("Pro", the bug), green #37D530 (the leaf),
-- gray #4A4F55 ("terra"). Logo files are served by this site from public/brands/proterra/.
--
-- Check the company first:  SELECT id, slug, name FROM companies WHERE name ILIKE '%terra%';
-- Everything below matches slug 'proterra' (same as company-platform-price-migration.sql).
-- If the company isn't there yet, create it on the admin page first (slug: proterra).

-- ============================================================================
-- 1. Company record: the website portal (/c/proterra) header, login page and accent
-- ============================================================================
UPDATE companies
SET logo_url = 'https://www.slabtraining.com/brands/proterra/icon.png',
    primary_color = '#37D530',
    secondary_color = '#4A4F55'
WHERE slug = 'proterra';

-- ============================================================================
-- 2. App config: dark field green with the leaf green as the accent, pink gear trim,
--    the bug-and-leaf next to SLAB in the top bar and on the opening splash, and the
--    street running ProTerra's own training once Butch's videos are uploaded.
-- ============================================================================
INSERT INTO company_app_config (company_id, theme, features, labels)
SELECT c.id,
  '{
    "cobrand": "SLAB x PROTERRA",
    "logoUrl": "https://www.slabtraining.com/brands/proterra/icon.png",
    "wordmarkUrl": "https://www.slabtraining.com/brands/proterra/logo-white.png",
    "statusBar": "light",
    "appStyle": "game",
    "colors": {
      "background": "#0b120c",
      "backgroundGradient": ["#060a07", "#0b120c", "#121b13"],
      "surface": "#141d15",
      "surfaceRaised": "#1c271d",
      "accent": "#37D530",
      "accentSoft": "#10260f",
      "accentLine": "rgba(55,213,48,0.38)",
      "onAccent": "#08110a",
      "text": "#f2f5f0",
      "textMuted": "#9aa59a",
      "header": "#0b120c",
      "tabBar": "#0b120c",
      "success": "#37D530"
    },
    "gear": { "name": "Proterra", "letters": "PRO", "primary": "#F992A3", "dark": "#2b2f33" },
    "coach": { "name": "Marshall" }
  }'::jsonb,
  '{
    "companyLessons": true,
    "vaultUnlockXp": 500,
    "appIcon": "Proterra"
  }'::jsonb,
  '{}'::jsonb
FROM companies c
WHERE c.slug = 'proterra'
ON CONFLICT (company_id) DO UPDATE
SET theme = EXCLUDED.theme,
    features = EXCLUDED.features,
    labels = EXCLUDED.labels;

-- Check: one row, cobrand SLAB x PROTERRA
SELECT c.name, c.slug, c.logo_url, a.theme->>'cobrand' AS cobrand, a.features->>'companyLessons' AS own_lessons
FROM companies c JOIN company_app_config a ON a.company_id = c.id
WHERE c.slug = 'proterra';

-- End of proterra-app-config.sql

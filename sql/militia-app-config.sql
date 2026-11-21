-- Militia Marketing: pilot company with a fully military app (2026-11-21)
-- Run once in the Supabase SQL editor, after company-app-config-migration.sql and ask-marshall-migration.sql.
-- Re-running is safe: it refreshes the branding and the coach's pitches and never touches a playbook the team
-- has filled in on the website.
--
-- Brand (Instagram @militia.marketing): a white condensed "M" on black, steel-gray ring. The app runs on
-- black with white ink and steel gray as the accent, with the military skin (slab-mobile tools/game/militia.js):
-- stencil type, faint gray camo in the top and bottom bars, a dog-tag XP pill, XP ranks from Recruit to General,
-- military copy, and the tabs Boot Camp / Intel / Comms / Ranks / Arsenal. SLAB's logo sits in steel gray next
-- to theirs. Logo files are served by this site from public/brands/militia/.
--
-- What the pilot reps get on day one: Marshall as their coach in Comms (his style and pitch moments, copied from
-- Ace's Marshall), Marshall's and Rylan's days in Intel (the Vault, open from the start), Marshall's training
-- videos, and the leaderboard. Boot Camp (the street) opens once Militia's own training is uploaded at
-- /c/militia/training; the Arsenal (Library) stays "coming soon" until it's filled.
--
-- Afterwards: invite the pilot reps from the company portal (or move their logins into this company).

-- ============================================================================
-- 1. The company
-- ============================================================================
INSERT INTO companies (name, slug, logo_url, primary_color, secondary_color, is_active)
VALUES ('Militia Marketing', 'militia', 'https://www.slabtraining.com/brands/militia/icon.png', '#8E949C', '#0A0B0D', true)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    logo_url = EXCLUDED.logo_url,
    primary_color = EXCLUDED.primary_color,
    secondary_color = EXCLUDED.secondary_color;

-- ============================================================================
-- 2. App config
-- ============================================================================
INSERT INTO company_app_config (company_id, theme, features, labels)
SELECT c.id,
  '{
    "cobrand": "SLAB x MILITIA",
    "logoUrl": "https://www.slabtraining.com/brands/militia/logo.png",
    "wordmarkUrl": "https://www.slabtraining.com/brands/militia/logo.png",
    "slabLogo": "#8E949C",
    "skin": "military",
    "statusBar": "light",
    "appStyle": "game",
    "colors": {
      "background": "#0A0B0D",
      "backgroundGradient": ["#0A0B0D", "#0F1013", "#15171A"],
      "surface": "rgba(255,255,255,0.06)",
      "surfaceRaised": "rgba(255,255,255,0.12)",
      "accent": "#B4BBC3",
      "accentSoft": "rgba(180,187,195,0.15)",
      "accentLine": "rgba(180,187,195,0.30)",
      "onAccent": "#0A0B0D",
      "text": "#F5F5F2",
      "textMuted": "rgba(245,245,242,0.55)",
      "header": "#0A0B0D",
      "tabBar": "#0A0B0D"
    },
    "gear": { "name": "Militia", "letters": "M", "primary": "#B4BBC3", "dark": "#1B1D22" },
    "streetSign": { "street": "Militia Way", "cross": "Slab Ave" }
  }'::jsonb,
  '{
    "companyLessons": true,
    "vaultUnlockXp": 0,
    "chatUnlockXp": 0,
    "library": false,
    "monthlyPrize": false,
    "marshallVideos": true,
    "extraGear": ["fatigues", "patrolcap", "helmet", "dressuniform", "campaignhat"]
  }'::jsonb,
  '{
    "tabs": { "lab": "Boot Camp", "vault": "Intel", "chat": "Comms", "leaderboard": "Ranks", "library": "Arsenal" }
  }'::jsonb
FROM companies c
WHERE c.slug = 'militia'
ON CONFLICT (company_id) DO UPDATE
SET theme = EXCLUDED.theme,
    features = EXCLUDED.features,
    labels = EXCLUDED.labels;

-- ============================================================================
-- 3. The coach: Marshall, with his style notes and tagged pitch moments copied from Ace's Marshall.
--    Each run refreshes the copy. No playbook is copied: Ace's prices and policies don't apply to Militia,
--    so put Militia's own on the website's playbook page when they're known.
-- ============================================================================
INSERT INTO coach_personas (company_id, name, style)
SELECT c.id, 'Marshall', m.style
FROM companies c
CROSS JOIN LATERAL (
  SELECT p.style FROM coach_personas p JOIN companies a ON a.id = p.company_id
  WHERE p.name = 'Marshall' AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%')
  ORDER BY p.updated_at DESC LIMIT 1
) m
WHERE c.slug = 'militia'
ON CONFLICT (company_id, name) DO UPDATE SET style = EXCLUDED.style, updated_at = now();

DELETE FROM coach_moments
WHERE persona_id IN (
  SELECT p.id FROM coach_personas p JOIN companies c ON c.id = p.company_id
  WHERE c.slug = 'militia' AND p.name = 'Marshall'
);

INSERT INTO coach_moments (persona_id, tag, outcome, title, recording_date, text, customer_line, st, en, audio_path)
SELECT mil.id, m.tag, m.outcome, m.title, m.recording_date, m.text, m.customer_line, m.st, m.en, m.audio_path
FROM coach_moments m
JOIN coach_personas marshall ON marshall.id = m.persona_id
JOIN companies a ON a.id = marshall.company_id
CROSS JOIN (
  SELECT p.id FROM coach_personas p JOIN companies c ON c.id = p.company_id
  WHERE c.slug = 'militia' AND p.name = 'Marshall'
) mil
WHERE marshall.name = 'Marshall' AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%');

-- Check: one row, skin military, the coach has moments
SELECT c.id, c.name, c.slug, a.theme->>'cobrand' AS cobrand, a.theme->>'skin' AS skin, a.labels->'tabs' AS tabs,
  (SELECT count(*) FROM coach_moments m JOIN coach_personas p ON p.id = m.persona_id WHERE p.company_id = c.id) AS coach_moments
FROM companies c JOIN company_app_config a ON a.company_id = c.id
WHERE c.slug = 'militia';

-- End of militia-app-config.sql

-- Ronin Larsen: Fox Pest Control becomes Ronin's own brand in the app (2026-11-12)
-- Run once in the Supabase SQL editor, after company-app-config-migration.sql and ask-marshall-migration.sql.
-- Re-running is safe: it overwrites the branding with these values and refreshes the coach's pitches,
-- but never touches a playbook the team has already filled in.
--
-- Brand (from Ronin's logo): navy #0B243B (the letters), red #CB272D (the tail). The app runs on white
-- with navy ink and red as the accent; the textured backdrop behind the top bar turns white with the same
-- texture. Logo and coach files are served by this site from public/brands/ronin/.
--
-- Check the company first (one row):
--   SELECT id, slug, name FROM companies WHERE name ILIKE 'fox pest control' OR name ILIKE 'ronin larsen';
-- The slug is left as it is, so the company portal link doesn't change.

-- ============================================================================
-- 1. Company record: the name everywhere, plus the website portal's logo and colors
-- ============================================================================
UPDATE companies
SET name = 'Ronin Larsen',
    logo_url = 'https://www.slabtraining.com/brands/ronin/logo.png',
    primary_color = '#CB272D',
    secondary_color = '#0B243B'
WHERE name ILIKE 'fox pest control' OR name ILIKE 'ronin larsen';

-- ============================================================================
-- 2. App config: white background, navy ink, red accent, SLAB x RONIN in the top bar and on the
--    opening splash, Ronin as the coach (his pixel portrait in the chat and nav), the Vault open from
--    the start (Marshall's and Rylan's days), the Library locked until it's filled, a skateboard ride
--    to unlock at 2000 XP (Ronin skates), and the street
--    running Ronin's own training once his videos are uploaded.
-- ============================================================================
INSERT INTO company_app_config (company_id, theme, features, labels)
SELECT c.id,
  '{
    "cobrand": "SLAB x RONIN",
    "logoUrl": "https://www.slabtraining.com/brands/ronin/logo.png",
    "wordmarkUrl": "https://www.slabtraining.com/brands/ronin/logo.png",
    "statusBar": "dark",
    "appStyle": "game",
    "colors": {
      "background": "#FFFFFF",
      "backgroundGradient": ["#FFFFFF", "#FBFBFC", "#F4F5F7"],
      "surface": "#F3F5F8",
      "surfaceRaised": "#E7EBF0",
      "accent": "#CB272D",
      "accentSoft": "#F9E5E6",
      "accentLine": "rgba(203,39,45,0.35)",
      "onAccent": "#FFFFFF",
      "text": "#0B243B",
      "textMuted": "#5A6B7E",
      "header": "#FFFFFF",
      "tabBar": "#FFFFFF"
    },
    "gear": { "name": "Ronin", "letters": "RL", "primary": "#CB272D", "dark": "#0B243B" },
    "coach": {
      "name": "Ronin",
      "fullName": "Ronin Larsen",
      "avatarUrl": "https://www.slabtraining.com/brands/ronin/coach.png",
      "spriteUrl": "https://www.slabtraining.com/brands/ronin/coach-sheet.webp",
      "vaultTag": "Golden Door Winner"
    }
  }'::jsonb,
  '{
    "companyLessons": true,
    "vaultUnlockXp": 0,
    "chatUnlockXp": 0,
    "library": false,
    "monthlyPrize": false,
    "extraRides": ["skateboard"]
  }'::jsonb,
  '{}'::jsonb
FROM companies c
WHERE c.name ILIKE 'ronin larsen'
ON CONFLICT (company_id) DO UPDATE
SET theme = EXCLUDED.theme,
    features = EXCLUDED.features,
    labels = EXCLUDED.labels;

-- ============================================================================
-- 3. The coach: "Ronin", answering from the same material as Marshall for now (Marshall's style notes
--    and his tagged pitch moments, copied from Ace's Marshall). Each run refreshes the copy.
-- ============================================================================
INSERT INTO coach_personas (company_id, name, style)
SELECT r.id, 'Ronin', m.style
FROM companies r
CROSS JOIN LATERAL (
  SELECT p.style FROM coach_personas p JOIN companies a ON a.id = p.company_id
  WHERE p.name = 'Marshall' AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%')
  ORDER BY p.updated_at DESC LIMIT 1
) m
WHERE r.name ILIKE 'ronin larsen'
ON CONFLICT (company_id, name) DO UPDATE SET style = EXCLUDED.style, updated_at = now();

DELETE FROM coach_moments
WHERE persona_id IN (
  SELECT p.id FROM coach_personas p JOIN companies r ON r.id = p.company_id
  WHERE r.name ILIKE 'ronin larsen' AND p.name = 'Ronin'
);

INSERT INTO coach_moments (persona_id, tag, outcome, title, recording_date, text, customer_line, st, en, audio_path)
SELECT ronin.id, m.tag, m.outcome, m.title, m.recording_date, m.text, m.customer_line, m.st, m.en, m.audio_path
FROM coach_moments m
JOIN coach_personas marshall ON marshall.id = m.persona_id
JOIN companies a ON a.id = marshall.company_id
CROSS JOIN (
  SELECT p.id FROM coach_personas p JOIN companies r ON r.id = p.company_id
  WHERE r.name ILIKE 'ronin larsen' AND p.name = 'Ronin'
) ronin
WHERE marshall.name = 'Marshall' AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%');

-- Business facts: the same playbook Marshall answers from, copied only while Ronin's is still empty,
-- so edits made on the website are never overwritten. (These are Ace's answers: swap in Ronin's own
-- minimums, prices and policies on the playbook page when you have them.)
INSERT INTO coach_playbook (company_id, topic, question, answer, sort)
SELECT r.id, pb.topic, pb.question, pb.answer, pb.sort
FROM companies r
CROSS JOIN coach_playbook pb
JOIN companies a ON a.id = pb.company_id
WHERE r.name ILIKE 'ronin larsen'
  AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%')
  AND NOT EXISTS (SELECT 1 FROM coach_playbook x WHERE x.company_id = r.id);

-- Check: one row each, the coach has moments
SELECT c.name, c.slug, a.theme->>'cobrand' AS cobrand, a.theme->'coach'->>'name' AS coach,
  a.features->>'library' AS library_open,
  (SELECT count(*) FROM coach_moments m JOIN coach_personas p ON p.id = m.persona_id WHERE p.company_id = c.id) AS coach_moments,
  (SELECT count(*) FROM coach_playbook pb WHERE pb.company_id = c.id) AS playbook_rows
FROM companies c JOIN company_app_config a ON a.company_id = c.id
WHERE c.name ILIKE 'ronin larsen';

-- End of ronin-app-config.sql

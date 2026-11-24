-- Militia Marketing: swap the coach's face for the soldier (2026-11-24).
-- Run once in the Supabase SQL editor after the site deploys public/brands/militia/coach-sheet.webp and coach.png.
-- Only touches theme.coach; the name stays Marshall so his chat persona and pitch moments keep working.
UPDATE company_app_config a
SET theme = jsonb_set(a.theme, '{coach}', '{
  "name": "Marshall",
  "avatarUrl": "https://www.slabtraining.com/brands/militia/coach.png",
  "spriteUrl": "https://www.slabtraining.com/brands/militia/coach-sheet.webp"
}'::jsonb, true)
FROM companies c
WHERE c.id = a.company_id AND c.slug = 'militia';

-- Check: one row with the soldier's sheet
SELECT c.slug, a.theme->'coach' AS coach
FROM companies c JOIN company_app_config a ON a.company_id = c.id
WHERE c.slug = 'militia';

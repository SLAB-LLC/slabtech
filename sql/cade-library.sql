-- Cade Sunderland: open the Library with Ace's resources, in Cade's colors (2026-11-18).
-- Run once in the Supabase SQL editor, after the app update that adds features.aceLibrary is out.
-- It only changes these two switches and leaves the rest of Cade's config alone.
UPDATE company_app_config a
SET features = a.features || '{"library": true, "aceLibrary": true}'::jsonb
FROM companies c
WHERE c.id = a.company_id AND c.slug = 'cade';

-- Check: one row, both true
SELECT c.name, a.features->>'library' AS library_open, a.features->>'aceLibrary' AS ace_library
FROM companies c JOIN company_app_config a ON a.company_id = c.id
WHERE c.slug = 'cade';

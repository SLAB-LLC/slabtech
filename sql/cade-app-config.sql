-- Cade Sunderland: a new company of his own in the app, set up like Ronin's (2026-11-13)
-- Run once in the Supabase SQL editor, after ronin-app-config.sql and ronin-lab-lessons.sql (it copies
-- Ronin's Lab). Re-running is safe: it refreshes the branding and the coach's pitches, but never touches a
-- playbook the team has filled in, and it copies the lessons only while Cade's Lab is still empty.
--
-- Cade sells for Fox, like Ronin, so everything matches Ronin's app except:
--   * his CADE logo and his pixel portrait (tux) as the coach, "Cade"
--   * a light grey background, a little darker than Ronin's white
--   * a pet goat on a leash to unlock at 2000 XP (Ronin keeps the skateboard)
--   * Cade's tux and his grey trucker cap with a pen in the side, free in the locker
--   * the Vault: Cade, Marshall, Rylan, then Ronin (Cade's and Ronin's days are "coming soon")
--   * a green street sign at the top of the Lab: Sunderland Ln crossing Slab Ave
-- Brand colors are Ronin's (the same Fox navy #0B243B and red #CB272D). Logo and coach files are served by
-- this site from public/brands/cade/.
--
-- Afterwards: move Cade's SLAB login (and anyone else's) into this company on the website.

-- ============================================================================
-- 1. The company
-- ============================================================================
INSERT INTO companies (name, slug, logo_url, primary_color, secondary_color, is_active)
VALUES ('Cade Sunderland', 'cade', 'https://www.slabtraining.com/brands/cade/logo.png', '#CB272D', '#0B243B', true)
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
    "cobrand": "SLAB x CADE",
    "logoUrl": "https://www.slabtraining.com/brands/cade/logo.png",
    "wordmarkUrl": "https://www.slabtraining.com/brands/cade/logo.png",
    "statusBar": "dark",
    "appStyle": "game",
    "colors": {
      "background": "#ECEEF1",
      "backgroundGradient": ["#F1F2F4", "#ECEEF1", "#E4E7EB"],
      "surface": "#F7F8FA",
      "surfaceRaised": "#FFFFFF",
      "accent": "#CB272D",
      "accentSoft": "#F9E5E6",
      "accentLine": "rgba(203,39,45,0.35)",
      "onAccent": "#FFFFFF",
      "text": "#0B243B",
      "textMuted": "#5A6B7E",
      "header": "#ECEEF1",
      "tabBar": "#ECEEF1"
    },
    "gear": { "name": "Cade", "letters": "CS", "primary": "#CB272D", "dark": "#0B243B" },
    "coach": {
      "name": "Cade",
      "fullName": "Cade Sunderland",
      "avatarUrl": "https://www.slabtraining.com/brands/cade/coach.png",
      "spriteUrl": "https://www.slabtraining.com/brands/cade/coach-sheet.webp",
      "vaultTag": "The GOAT (2004 accounts in one summer)",
      "vaultFirst": true
    },
    "vaultGuests": [
      { "name": "Ronin Larsen", "tag": "Golden Door Winner", "spriteUrl": "https://www.slabtraining.com/brands/ronin/coach-sheet.webp" }
    ],
    "streetSign": { "street": "Sunderland Ln", "cross": "Slab Ave" }
  }'::jsonb,
  '{
    "companyLessons": true,
    "vaultUnlockXp": 0,
    "chatUnlockXp": 0,
    "library": false,
    "monthlyPrize": false,
    "extraRides": ["goat"],
    "extraGear": ["tux", "pencap"]
  }'::jsonb,
  '{}'::jsonb
FROM companies c
WHERE c.slug = 'cade'
ON CONFLICT (company_id) DO UPDATE
SET theme = EXCLUDED.theme,
    features = EXCLUDED.features,
    labels = EXCLUDED.labels;

-- ============================================================================
-- 3. The coach: "Cade", answering from Marshall's material for now (his style notes and tagged pitch
--    moments, copied from Ace's Marshall, like Ronin's). Each run refreshes the copy.
-- ============================================================================
INSERT INTO coach_personas (company_id, name, style)
SELECT c.id, 'Cade', m.style
FROM companies c
CROSS JOIN LATERAL (
  SELECT p.style FROM coach_personas p JOIN companies a ON a.id = p.company_id
  WHERE p.name = 'Marshall' AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%')
  ORDER BY p.updated_at DESC LIMIT 1
) m
WHERE c.slug = 'cade'
ON CONFLICT (company_id, name) DO UPDATE SET style = EXCLUDED.style, updated_at = now();

DELETE FROM coach_moments
WHERE persona_id IN (
  SELECT p.id FROM coach_personas p JOIN companies c ON c.id = p.company_id
  WHERE c.slug = 'cade' AND p.name = 'Cade'
);

INSERT INTO coach_moments (persona_id, tag, outcome, title, recording_date, text, customer_line, st, en, audio_path)
SELECT cade.id, m.tag, m.outcome, m.title, m.recording_date, m.text, m.customer_line, m.st, m.en, m.audio_path
FROM coach_moments m
JOIN coach_personas marshall ON marshall.id = m.persona_id
JOIN companies a ON a.id = marshall.company_id
CROSS JOIN (
  SELECT p.id FROM coach_personas p JOIN companies c ON c.id = p.company_id
  WHERE c.slug = 'cade' AND p.name = 'Cade'
) cade
WHERE marshall.name = 'Marshall' AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%');

-- Business facts: Marshall's playbook, copied only while Cade's is empty so website edits are never
-- overwritten. (These are Ace's answers: put in Fox's minimums, prices and policies on the playbook page.)
INSERT INTO coach_playbook (company_id, topic, question, answer, sort)
SELECT c.id, pb.topic, pb.question, pb.answer, pb.sort
FROM companies c
CROSS JOIN coach_playbook pb
JOIN companies a ON a.id = pb.company_id
WHERE c.slug = 'cade'
  AND (a.slug ILIKE 'ace%' OR a.name ILIKE 'ace%')
  AND NOT EXISTS (SELECT 1 FROM coach_playbook x WHERE x.company_id = c.id);

-- ============================================================================
-- 4. The Lab: a one-time copy of Ronin's Fox lessons (units, videos, quizzes), in the same order.
--    It's a copy, not a link: changing Ronin's lessons later leaves Cade's as they are.
-- ============================================================================
DO $$
DECLARE
  src uuid;
  dst uuid;
  pl record;
  v record;
  new_pl uuid;
  new_v uuid;
  n int := 0;
BEGIN
  SELECT id INTO src FROM companies WHERE name ILIKE 'ronin larsen';
  SELECT id INTO dst FROM companies WHERE slug = 'cade';
  IF src IS NULL THEN RAISE EXCEPTION 'No company named Ronin Larsen'; END IF;
  IF dst IS NULL THEN RAISE EXCEPTION 'No company with slug cade'; END IF;
  IF EXISTS (SELECT 1 FROM training_videos WHERE company_id = dst) THEN
    RAISE NOTICE 'Cade''s Lab already has lessons; nothing copied';
    RETURN;
  END IF;

  CREATE TEMP TABLE cade_video_map (old_id uuid PRIMARY KEY, new_id uuid) ON COMMIT DROP;

  -- every video, keeping their order (the app orders by created_at)
  FOR v IN SELECT * FROM training_videos WHERE company_id = src ORDER BY created_at, id LOOP
    INSERT INTO training_videos (company_id, title, description, video_type, youtube_url, storage_path, thumbnail_url, duration, created_at)
    VALUES (dst, v.title, v.description, v.video_type, v.youtube_url, v.storage_path, v.thumbnail_url, v.duration, now() + make_interval(secs => n))
    RETURNING id INTO new_v;
    INSERT INTO cade_video_map VALUES (v.id, new_v);
    n := n + 1;
  END LOOP;

  -- quizzes
  INSERT INTO video_quiz_settings (video_id, quiz_required, blocks_next_videos, blocks_transcripts, blocks_training_playlists, passing_score)
  SELECT m.new_id, s.quiz_required, s.blocks_next_videos, s.blocks_transcripts, s.blocks_training_playlists, s.passing_score
  FROM video_quiz_settings s JOIN cade_video_map m ON m.old_id = s.video_id;

  INSERT INTO video_quiz_questions (video_id, question_text, option_a, option_b, option_c, option_d, correct_answer, position)
  SELECT m.new_id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.position
  FROM video_quiz_questions q JOIN cade_video_map m ON m.old_id = q.video_id;

  -- units (playlists), in order, with their videos
  n := 0;
  FOR pl IN SELECT * FROM training_playlists WHERE company_id = src ORDER BY created_at, id LOOP
    INSERT INTO training_playlists (company_id, name, description, created_at)
    VALUES (dst, pl.name, pl.description, now() + make_interval(secs => n))
    RETURNING id INTO new_pl;
    INSERT INTO playlist_videos (playlist_id, video_id, position)
    SELECT new_pl, m.new_id, pv.position
    FROM playlist_videos pv JOIN cade_video_map m ON m.old_id = pv.video_id
    WHERE pv.playlist_id = pl.id;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Copied % lessons and % units from Ronin''s Lab', (SELECT count(*) FROM cade_video_map), n;
END $$;

-- Check: one row, the coach has moments, the Lab has Ronin's 22 lessons
SELECT c.name, c.slug, a.theme->>'cobrand' AS cobrand, a.theme->'coach'->>'name' AS coach,
  a.features->'extraRides' AS rides, a.features->'extraGear' AS gear,
  (SELECT count(*) FROM coach_moments m JOIN coach_personas p ON p.id = m.persona_id WHERE p.company_id = c.id) AS coach_moments,
  (SELECT count(*) FROM coach_playbook pb WHERE pb.company_id = c.id) AS playbook_rows,
  (SELECT count(*) FROM training_videos v WHERE v.company_id = c.id) AS lessons,
  (SELECT count(*) FROM training_playlists t WHERE t.company_id = c.id) AS units
FROM companies c JOIN company_app_config a ON a.company_id = c.id
WHERE c.slug = 'cade';

-- End of cade-app-config.sql

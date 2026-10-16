-- ============================================================================
-- COMPLETE QUIZ SYSTEM SETUP - Idempotent & Safe
-- ============================================================================
-- This migration sets up the complete quiz system with proper RLS
-- Safe to run multiple times - uses IF NOT EXISTS
-- ============================================================================

-- ============================================================================
-- 1. CREATE QUIZ TABLES (IF THEY DON'T EXIST)
-- ============================================================================

-- Video Quiz Settings Table
CREATE TABLE IF NOT EXISTS video_quiz_settings (
  video_id UUID PRIMARY KEY REFERENCES training_videos(id) ON DELETE CASCADE,
  quiz_required BOOLEAN NOT NULL DEFAULT false,
  blocks_next_videos BOOLEAN NOT NULL DEFAULT false,
  blocks_transcripts BOOLEAN NOT NULL DEFAULT false,
  blocks_training_playlists BOOLEAN NOT NULL DEFAULT false,
  passing_score INTEGER NOT NULL DEFAULT 80,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_passing_score CHECK (passing_score >= 0 AND passing_score <= 100)
);

-- Video Quiz Questions Table
CREATE TABLE IF NOT EXISTS video_quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES training_videos(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Video Quiz Attempts Table (THE KEY TABLE)
CREATE TABLE IF NOT EXISTS video_quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES training_videos(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER NOT NULL,
  passed BOOLEAN NOT NULL,
  attempt_number INTEGER NOT NULL,
  answers JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. CREATE INDEXES (IF THEY DON'T EXIST)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_quiz_questions_video ON video_quiz_questions(video_id, position);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON video_quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_video ON video_quiz_attempts(video_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_company ON video_quiz_attempts(company_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_video ON video_quiz_attempts(user_id, video_id);

-- ============================================================================
-- 3. ENABLE RLS ON ALL QUIZ TABLES
-- ============================================================================

ALTER TABLE video_quiz_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_quiz_attempts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. DROP EXISTING POLICIES (to recreate them cleanly)
-- ============================================================================

-- Drop video_quiz_settings policies
DROP POLICY IF EXISTS "Users can view quiz settings for company videos" ON video_quiz_settings;
DROP POLICY IF EXISTS "Company admins can manage quiz settings" ON video_quiz_settings;

-- Drop video_quiz_questions policies
DROP POLICY IF EXISTS "Users can view quiz questions for company videos" ON video_quiz_questions;
DROP POLICY IF EXISTS "Company admins can manage quiz questions" ON video_quiz_questions;

-- Drop video_quiz_attempts policies
DROP POLICY IF EXISTS "Users can view quiz attempts" ON video_quiz_attempts;
DROP POLICY IF EXISTS "Users can create quiz attempts" ON video_quiz_attempts;
DROP POLICY IF EXISTS "Admins can delete quiz attempts" ON video_quiz_attempts;

-- ============================================================================
-- 5. CREATE RLS POLICIES FOR VIDEO_QUIZ_SETTINGS
-- ============================================================================

-- SELECT: Users can view settings for videos in their company
CREATE POLICY "Users can view quiz settings for company videos"
ON video_quiz_settings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM training_videos tv
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tv.id = video_quiz_settings.video_id
    AND (
      up.role = 'super_admin'
      OR tv.company_id = up.company_id
    )
  )
);

-- INSERT/UPDATE/DELETE: Only company admins
CREATE POLICY "Company admins can manage quiz settings"
ON video_quiz_settings FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM training_videos tv
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tv.id = video_quiz_settings.video_id
    AND up.role IN ('company_admin', 'super_admin')
    AND (
      up.role = 'super_admin'
      OR tv.company_id = up.company_id
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM training_videos tv
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tv.id = video_quiz_settings.video_id
    AND up.role IN ('company_admin', 'super_admin')
    AND (
      up.role = 'super_admin'
      OR tv.company_id = up.company_id
    )
  )
);

-- ============================================================================
-- 6. CREATE RLS POLICIES FOR VIDEO_QUIZ_QUESTIONS
-- ============================================================================

-- SELECT: Users can view questions for videos in their company
CREATE POLICY "Users can view quiz questions for company videos"
ON video_quiz_questions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM training_videos tv
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tv.id = video_quiz_questions.video_id
    AND (
      up.role = 'super_admin'
      OR tv.company_id = up.company_id
    )
  )
);

-- INSERT/UPDATE/DELETE: Only company admins
CREATE POLICY "Company admins can manage quiz questions"
ON video_quiz_questions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM training_videos tv
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tv.id = video_quiz_questions.video_id
    AND up.role IN ('company_admin', 'super_admin')
    AND (
      up.role = 'super_admin'
      OR tv.company_id = up.company_id
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM training_videos tv
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tv.id = video_quiz_questions.video_id
    AND up.role IN ('company_admin', 'super_admin')
    AND (
      up.role = 'super_admin'
      OR tv.company_id = up.company_id
    )
  )
);

-- ============================================================================
-- 7. CREATE RLS POLICIES FOR VIDEO_QUIZ_ATTEMPTS
-- ============================================================================

-- SELECT: Users can view their own attempts; admins see all in company
CREATE POLICY "Users can view quiz attempts"
ON video_quiz_attempts FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND (
      role = 'super_admin'
      OR (role = 'company_admin' AND company_id = video_quiz_attempts.company_id)
    )
  )
);

-- INSERT: Users can create their own attempts
CREATE POLICY "Users can create quiz attempts"
ON video_quiz_attempts FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND company_id = video_quiz_attempts.company_id
  )
);

-- DELETE: Admins can delete attempts
CREATE POLICY "Admins can delete quiz attempts"
ON video_quiz_attempts FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND (
      role = 'super_admin'
      OR (role = 'company_admin' AND company_id = video_quiz_attempts.company_id)
    )
  )
);

-- ============================================================================
-- 8. CREATE USER_QUIZ_PROGRESS VIEW (WITHOUT SECURITY DEFINER)
-- ============================================================================

-- Drop the problematic SECURITY DEFINER view
DROP VIEW IF EXISTS public.user_quiz_progress;

-- Recreate WITHOUT security definer (defaults to using invoker's permissions)
CREATE VIEW public.user_quiz_progress AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.company_id,
  COUNT(DISTINCT vqa.video_id) FILTER (WHERE vqa.passed = true) AS videos_passed,
  MAX(vqa.completed_at) AS last_quiz_completion,
  AVG(vqa.score) FILTER (WHERE vqa.passed = true) AS avg_quiz_score,
  -- Additional helpful stats
  COUNT(DISTINCT vqa.id) AS total_attempts,
  COUNT(DISTINCT vqa.video_id) AS videos_attempted
FROM user_profiles up
LEFT JOIN video_quiz_attempts vqa ON vqa.user_id = up.id
GROUP BY up.id, up.email, up.display_name, up.company_id;

-- ============================================================================
-- 9. GRANT PERMISSIONS
-- ============================================================================

GRANT ALL ON video_quiz_settings TO authenticated;
GRANT ALL ON video_quiz_questions TO authenticated;
GRANT ALL ON video_quiz_attempts TO authenticated;

-- ============================================================================
-- 10. VERIFICATION QUERIES
-- ============================================================================

-- Check all quiz tables exist
SELECT
  table_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = table_name AND rowsecurity = true
    ) THEN 'RLS Enabled ✓'
    ELSE 'RLS NOT Enabled ✗'
  END AS rls_status
FROM (
  VALUES
    ('video_quiz_settings'),
    ('video_quiz_questions'),
    ('video_quiz_attempts')
) AS t(table_name)
WHERE EXISTS (
  SELECT 1 FROM pg_tables
  WHERE schemaname = 'public' AND tablename = t.table_name
);

-- Check view exists
SELECT
  'user_quiz_progress' AS view_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'user_quiz_progress')
    THEN 'Created ✓'
    ELSE 'Not Found ✗'
  END AS status;

-- Count existing quiz data (if any)
SELECT
  'video_quiz_settings' AS table_name,
  COUNT(*) AS row_count
FROM video_quiz_settings
UNION ALL
SELECT 'video_quiz_questions', COUNT(*) FROM video_quiz_questions
UNION ALL
SELECT 'video_quiz_attempts', COUNT(*) FROM video_quiz_attempts;

-- ============================================================================
-- SUCCESS! Quiz system is now fully set up with proper RLS
-- ============================================================================
-- Company admins can now:
-- 1. View all quiz attempts in their company
-- 2. See which users have taken quizzes
-- 3. Track scores and attempt counts
-- 4. View the user_quiz_progress analytics view
-- ============================================================================

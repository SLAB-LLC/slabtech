-- Complete Training Videos & Quiz System Setup
-- Run this entire file in Supabase SQL Editor

-- ============================================================================
-- PART 1: TRAINING VIDEOS TABLES (if not already created)
-- ============================================================================

-- Training Videos Table
CREATE TABLE IF NOT EXISTS training_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  video_type TEXT NOT NULL CHECK (video_type IN ('youtube', 'upload')),
  youtube_url TEXT,
  storage_path TEXT,
  thumbnail_url TEXT,
  duration INTEGER,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_videos_company ON training_videos(company_id);
CREATE INDEX IF NOT EXISTS idx_training_videos_created_at ON training_videos(created_at DESC);

-- Training Playlists Table
CREATE TABLE IF NOT EXISTS training_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_playlists_company ON training_playlists(company_id);

-- Playlist Videos Junction Table
CREATE TABLE IF NOT EXISTS playlist_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES training_playlists(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES training_videos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(playlist_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_videos_playlist ON playlist_videos(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_videos_video ON playlist_videos(video_id);

-- Video Completions Table
CREATE TABLE IF NOT EXISTS video_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES training_videos(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_completions_user ON video_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_video_completions_video ON video_completions(video_id);
CREATE INDEX IF NOT EXISTS idx_video_completions_company ON video_completions(company_id);

-- ============================================================================
-- PART 2: QUIZ TABLES
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

CREATE INDEX IF NOT EXISTS idx_quiz_questions_video ON video_quiz_questions(video_id, position);

-- Video Quiz Attempts Table
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

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON video_quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_video ON video_quiz_attempts(video_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_company ON video_quiz_attempts(company_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_video ON video_quiz_attempts(user_id, video_id);

-- ============================================================================
-- PART 3: ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE training_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_quiz_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view company training videos" ON training_videos;
DROP POLICY IF EXISTS "Company admins can create training videos" ON training_videos;
DROP POLICY IF EXISTS "Company admins can update training videos" ON training_videos;
DROP POLICY IF EXISTS "Company admins can delete training videos" ON training_videos;

DROP POLICY IF EXISTS "Users can view company playlists" ON training_playlists;
DROP POLICY IF EXISTS "Company admins can create playlists" ON training_playlists;
DROP POLICY IF EXISTS "Company admins can update playlists" ON training_playlists;
DROP POLICY IF EXISTS "Company admins can delete playlists" ON training_playlists;

DROP POLICY IF EXISTS "Users can view playlist videos" ON playlist_videos;
DROP POLICY IF EXISTS "Company admins can add videos to playlists" ON playlist_videos;
DROP POLICY IF EXISTS "Company admins can remove videos from playlists" ON playlist_videos;

DROP POLICY IF EXISTS "Users can view video completions" ON video_completions;
DROP POLICY IF EXISTS "Users can mark videos complete" ON video_completions;
DROP POLICY IF EXISTS "Users can unmark video completions" ON video_completions;

DROP POLICY IF EXISTS "Users can view quiz settings for company videos" ON video_quiz_settings;
DROP POLICY IF EXISTS "Company admins can manage quiz settings" ON video_quiz_settings;

DROP POLICY IF EXISTS "Users can view quiz questions for company videos" ON video_quiz_questions;
DROP POLICY IF EXISTS "Company admins can manage quiz questions" ON video_quiz_questions;

DROP POLICY IF EXISTS "Users can view quiz attempts" ON video_quiz_attempts;
DROP POLICY IF EXISTS "Users can create quiz attempts" ON video_quiz_attempts;
DROP POLICY IF EXISTS "Admins can delete quiz attempts" ON video_quiz_attempts;

-- Training Videos Policies
CREATE POLICY "Users can view company training videos"
ON training_videos FOR SELECT
TO authenticated
USING (
  company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role != 'super_admin'
  )
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

CREATE POLICY "Company admins can create training videos"
ON training_videos FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM user_profiles
    WHERE role IN ('company_admin', 'super_admin')
  )
);

CREATE POLICY "Company admins can update training videos"
ON training_videos FOR UPDATE
TO authenticated
USING (
  (company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

CREATE POLICY "Company admins can delete training videos"
ON training_videos FOR DELETE
TO authenticated
USING (
  (company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

-- Training Playlists Policies
CREATE POLICY "Users can view company playlists"
ON training_playlists FOR SELECT
TO authenticated
USING (
  company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role != 'super_admin'
  )
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

CREATE POLICY "Company admins can create playlists"
ON training_playlists FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM user_profiles
    WHERE role IN ('company_admin', 'super_admin')
  )
);

CREATE POLICY "Company admins can update playlists"
ON training_playlists FOR UPDATE
TO authenticated
USING (
  (company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

CREATE POLICY "Company admins can delete playlists"
ON training_playlists FOR DELETE
TO authenticated
USING (
  (company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

-- Playlist Videos Policies
CREATE POLICY "Users can view playlist videos"
ON playlist_videos FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM training_playlists tp
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tp.id = playlist_videos.playlist_id
    AND (
      up.role = 'super_admin'
      OR up.company_id = tp.company_id
    )
  )
);

CREATE POLICY "Company admins can add videos to playlists"
ON playlist_videos FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM training_playlists tp
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tp.id = playlist_videos.playlist_id
    AND up.role IN ('company_admin', 'super_admin')
    AND (
      up.role = 'super_admin'
      OR up.company_id = tp.company_id
    )
  )
);

CREATE POLICY "Company admins can remove videos from playlists"
ON playlist_videos FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM training_playlists tp
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE tp.id = playlist_videos.playlist_id
    AND up.role IN ('company_admin', 'super_admin')
    AND (
      up.role = 'super_admin'
      OR up.company_id = tp.company_id
    )
  )
);

-- Video Completions Policies
CREATE POLICY "Users can view video completions"
ON video_completions FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'company_admin'
  )
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

CREATE POLICY "Users can mark videos complete"
ON video_completions FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "Users can unmark video completions"
ON video_completions FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'company_admin'
  )
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

-- Quiz Settings Policies
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

-- Quiz Questions Policies
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

-- Quiz Attempts Policies
CREATE POLICY "Users can view quiz attempts"
ON video_quiz_attempts FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'company_admin'
  )
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

CREATE POLICY "Users can create quiz attempts"
ON video_quiz_attempts FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "Admins can delete quiz attempts"
ON video_quiz_attempts FOR DELETE
TO authenticated
USING (
  company_id IN (
    SELECT up.company_id FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'company_admin'
  )
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role = 'super_admin'
  )
);

-- ============================================================================
-- PART 4: HELPER FUNCTIONS
-- ============================================================================

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS get_user_blocking_videos(UUID);
DROP FUNCTION IF EXISTS user_has_section_access(UUID, TEXT);

-- Function to get user's blocking videos
CREATE OR REPLACE FUNCTION get_user_blocking_videos(p_user_id UUID)
RETURNS TABLE (
  video_id UUID,
  video_title TEXT,
  blocks_transcripts BOOLEAN,
  blocks_training_playlists BOOLEAN,
  has_passed BOOLEAN
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tv.id AS video_id,
    tv.title AS video_title,
    vqs.blocks_transcripts,
    vqs.blocks_training_playlists,
    EXISTS (
      SELECT 1 FROM video_quiz_attempts vqa
      WHERE vqa.user_id = p_user_id
      AND vqa.video_id = tv.id
      AND vqa.passed = true
    ) AS has_passed
  FROM training_videos tv
  JOIN video_quiz_settings vqs ON vqs.video_id = tv.id
  JOIN user_profiles up ON up.id = p_user_id
  WHERE tv.company_id = up.company_id
  AND (vqs.blocks_transcripts = true OR vqs.blocks_training_playlists = true)
  ORDER BY tv.created_at ASC;
END;
$$;

-- Function to check if user has access to a section
CREATE OR REPLACE FUNCTION user_has_section_access(
  p_user_id UUID,
  p_section TEXT
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  has_access BOOLEAN;
BEGIN
  IF p_section = 'transcripts' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM training_videos tv
      JOIN video_quiz_settings vqs ON vqs.video_id = tv.id
      JOIN user_profiles up ON up.id = p_user_id
      WHERE tv.company_id = up.company_id
      AND vqs.blocks_transcripts = true
      AND NOT EXISTS (
        SELECT 1 FROM video_quiz_attempts vqa
        WHERE vqa.user_id = p_user_id
        AND vqa.video_id = tv.id
        AND vqa.passed = true
      )
    ) INTO has_access;
  ELSIF p_section = 'training_playlists' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM training_videos tv
      JOIN video_quiz_settings vqs ON vqs.video_id = tv.id
      JOIN user_profiles up ON up.id = p_user_id
      WHERE tv.company_id = up.company_id
      AND vqs.blocks_training_playlists = true
      AND NOT EXISTS (
        SELECT 1 FROM video_quiz_attempts vqa
        WHERE vqa.user_id = p_user_id
        AND vqa.video_id = tv.id
        AND vqa.passed = true
      )
    ) INTO has_access;
  ELSE
    has_access := true;
  END IF;

  RETURN has_access;
END;
$$;

-- ============================================================================
-- PART 5: UPDATED_AT TRIGGERS
-- ============================================================================

-- Create or replace the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_training_videos_updated_at ON training_videos;
DROP TRIGGER IF EXISTS update_training_playlists_updated_at ON training_playlists;
DROP TRIGGER IF EXISTS update_video_quiz_settings_updated_at ON video_quiz_settings;

-- Create triggers
CREATE TRIGGER update_training_videos_updated_at
BEFORE UPDATE ON training_videos
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_training_playlists_updated_at
BEFORE UPDATE ON training_playlists
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_video_quiz_settings_updated_at
BEFORE UPDATE ON video_quiz_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 6: GRANT PERMISSIONS
-- ============================================================================

GRANT ALL ON training_videos TO authenticated;
GRANT ALL ON training_playlists TO authenticated;
GRANT ALL ON playlist_videos TO authenticated;
GRANT ALL ON video_completions TO authenticated;
GRANT ALL ON video_quiz_settings TO authenticated;
GRANT ALL ON video_quiz_questions TO authenticated;
GRANT ALL ON video_quiz_attempts TO authenticated;

GRANT EXECUTE ON FUNCTION get_user_blocking_videos(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_section_access(UUID, TEXT) TO authenticated;

-- ============================================================================
-- PART 7: STORAGE BUCKET & POLICIES
-- ============================================================================

-- Create storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'training-videos',
  'training-videos',
  false,
  NULL,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- Drop existing storage policies if they exist
DROP POLICY IF EXISTS "Company admins can upload training videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can view company training videos" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can delete training videos" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can update training videos" ON storage.objects;

-- Storage Policy 1: Upload (admins only)
CREATE POLICY "Company admins can upload training videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'training-videos'
  AND (auth.uid() IN (
    SELECT up.id FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
);

-- Storage Policy 2: View (all authenticated users)
CREATE POLICY "Users can view company training videos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'training-videos');

-- Storage Policy 3: Delete (admins only)
CREATE POLICY "Company admins can delete training videos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'training-videos'
  AND (auth.uid() IN (
    SELECT up.id FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
);

-- Storage Policy 4: Update (admins only)
CREATE POLICY "Company admins can update training videos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'training-videos'
  AND (auth.uid() IN (
    SELECT up.id FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('company_admin', 'super_admin')
  ))
);

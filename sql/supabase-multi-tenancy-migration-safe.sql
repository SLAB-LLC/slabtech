-- ============================================================================
-- SLAB Voice Multi-Tenancy Migration (SAFE VERSION)
-- ============================================================================
-- This migration transforms SLAB from single-tenant to multi-tenant SaaS
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- STEP 0: Drop ALL existing policies and views to avoid circular dependencies
-- ============================================================================

-- Drop existing views that reference user_profiles or login_logs
DROP VIEW IF EXISTS user_login_stats CASCADE;

-- Drop all existing policies on user_profiles
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON user_profiles';
    END LOOP;
END $$;

-- Drop all existing policies on transcripts
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transcripts')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON transcripts';
    END LOOP;
END $$;

-- Drop all existing policies on salespeople
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'salespeople')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON salespeople';
    END LOOP;
END $$;

-- Drop all existing policies on login_logs
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'login_logs')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON login_logs';
    END LOOP;
END $$;

-- Drop all existing policies on companies (if exists)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON companies';
    END LOOP;
END $$;

-- Drop trigger to prevent interference during migration
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DO $$ BEGIN RAISE NOTICE '✓ All existing policies and triggers dropped'; END $$;

-- ============================================================================
-- STEP 1: Create Companies Table (NO policies yet)
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#f39c12',
  secondary_color TEXT DEFAULT '#001199',
  billing_status TEXT DEFAULT 'active' CHECK (billing_status IN ('active', 'suspended', 'cancelled')),
  billing_email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active) WHERE is_active = true;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN RAISE NOTICE '✓ Companies table created'; END $$;

-- ============================================================================
-- STEP 2: Update user_profiles role constraint and add company_id
-- ============================================================================

-- FIRST: Add company_id column (nullable) so it exists before we insert data
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Drop old role constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- Clean ALL existing role data
UPDATE user_profiles SET role = 'super_admin' WHERE role = 'admin';
UPDATE user_profiles SET role = 'user' WHERE role IS NULL;
UPDATE user_profiles SET role = 'user' WHERE role NOT IN ('super_admin', 'company_admin', 'user');

-- Create profiles for any auth.users that don't have them yet (company_id will be NULL for now)
INSERT INTO user_profiles (id, email, display_name, role, is_active, created_at, updated_at, company_id)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'display_name', au.email),
  'super_admin',
  true,
  au.created_at,
  NOW(),
  NULL  -- Will be backfilled in Step 5
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
WHERE up.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- NOW add the new constraint (after data is clean)
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin', 'company_admin', 'user'));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON user_profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

DO $$ BEGIN RAISE NOTICE '✓ user_profiles updated with company_id'; END $$;

-- ============================================================================
-- STEP 3: Add company_id to other tables
-- ============================================================================

-- Transcripts
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_transcripts_company ON transcripts(company_id);

-- Salespeople
ALTER TABLE salespeople ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_salespeople_company ON salespeople(company_id);

-- Login logs
ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_login_logs_company ON login_logs(company_id);

DO $$ BEGIN RAISE NOTICE '✓ company_id added to transcripts, salespeople, login_logs'; END $$;

-- ============================================================================
-- STEP 4: Create/Update streak tables with company_id
-- ============================================================================

-- If user_streaks doesn't exist, create it; if it exists, add company_id column
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_streaks') THEN
    CREATE TABLE user_streaks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      current_streak INT DEFAULT 0,
      longest_streak INT DEFAULT 0,
      total_activities INT DEFAULT 0,
      last_activity_date DATE,
      created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
      updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
      UNIQUE(user_id)
    );
  ELSE
    -- Table exists, add company_id if it doesn't have it
    ALTER TABLE user_streaks ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_streaks_user ON user_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_streaks_company ON user_streaks(company_id);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

-- If streak_activities doesn't exist, create it; if it exists, add company_id column
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'streak_activities') THEN
    CREATE TABLE streak_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
      activity_type TEXT DEFAULT 'audio_listen',
      transcript_id UUID REFERENCES transcripts(id),
      created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
      UNIQUE(user_id, activity_date)
    );
  ELSE
    -- Table exists, add company_id if it doesn't have it
    ALTER TABLE streak_activities ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_streak_activities_user ON streak_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_streak_activities_company ON streak_activities(company_id);
CREATE INDEX IF NOT EXISTS idx_streak_activities_date ON streak_activities(activity_date);

ALTER TABLE streak_activities ENABLE ROW LEVEL SECURITY;

-- Streak update trigger
CREATE OR REPLACE FUNCTION update_user_streak()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_streaks (user_id, company_id, current_streak, longest_streak, total_activities, last_activity_date, updated_at)
  VALUES (
    NEW.user_id,
    NEW.company_id,
    1,
    1,
    1,
    NEW.activity_date,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_activities = user_streaks.total_activities + 1,
    current_streak = CASE
      WHEN user_streaks.last_activity_date = NEW.activity_date - INTERVAL '1 day' THEN user_streaks.current_streak + 1
      WHEN user_streaks.last_activity_date = NEW.activity_date THEN user_streaks.current_streak
      ELSE 1
    END,
    longest_streak = GREATEST(
      user_streaks.longest_streak,
      CASE
        WHEN user_streaks.last_activity_date = NEW.activity_date - INTERVAL '1 day' THEN user_streaks.current_streak + 1
        WHEN user_streaks.last_activity_date = NEW.activity_date THEN user_streaks.current_streak
        ELSE 1
      END
    ),
    last_activity_date = NEW.activity_date,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_streak ON streak_activities;
CREATE TRIGGER trigger_update_user_streak
  AFTER INSERT ON streak_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_user_streak();

DO $$ BEGIN RAISE NOTICE '✓ Streak tables created'; END $$;

-- ============================================================================
-- STEP 5: Backfill data with default company
-- ============================================================================

DO $$
DECLARE
  default_company_id UUID;
BEGIN
  -- Create default company
  INSERT INTO companies (name, slug, is_active)
  VALUES ('SLAB Internal', 'slab-internal', true)
  ON CONFLICT (slug) DO UPDATE SET name = 'SLAB Internal'
  RETURNING id INTO default_company_id;

  -- Backfill user_profiles
  UPDATE user_profiles
  SET company_id = default_company_id
  WHERE company_id IS NULL;

  -- Backfill transcripts
  UPDATE transcripts
  SET company_id = default_company_id
  WHERE company_id IS NULL;

  -- Backfill salespeople
  UPDATE salespeople
  SET company_id = default_company_id
  WHERE company_id IS NULL;

  -- Backfill login_logs from user's company
  UPDATE login_logs ll
  SET company_id = up.company_id
  FROM user_profiles up
  WHERE up.id = ll.user_id
  AND ll.company_id IS NULL;

  -- Backfill user_streaks from user's company
  UPDATE user_streaks us
  SET company_id = up.company_id
  FROM user_profiles up
  WHERE up.id = us.user_id
  AND us.company_id IS NULL;

  -- Backfill streak_activities from user's company
  UPDATE streak_activities sa
  SET company_id = up.company_id
  FROM user_profiles up
  WHERE up.id = sa.user_id
  AND sa.company_id IS NULL;

  RAISE NOTICE '✓ Default company created (ID: %)', default_company_id;
  RAISE NOTICE '✓ All existing data backfilled';
END $$;

-- Make company_id NOT NULL after backfill
ALTER TABLE user_profiles ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE transcripts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE salespeople ALTER COLUMN company_id SET NOT NULL;

DO $$ BEGIN RAISE NOTICE '✓ company_id set to NOT NULL'; END $$;

-- ============================================================================
-- STEP 6: Create invites table
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('company_admin', 'user')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID NOT NULL REFERENCES user_profiles(id),
  accepted BOOLEAN DEFAULT false,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  UNIQUE(company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invites_token ON company_invites(token) WHERE NOT accepted;
CREATE INDEX IF NOT EXISTS idx_invites_company ON company_invites(company_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON company_invites(email);

ALTER TABLE company_invites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN RAISE NOTICE '✓ Invites table created'; END $$;

-- ============================================================================
-- STEP 7: Create messages table
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL CHECK (length(message_text) > 0 AND length(message_text) <= 2000),
  transcript_id UUID REFERENCES transcripts(id) ON DELETE SET NULL,
  timestamp_start DECIMAL,
  timestamp_end DECIMAL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  edited BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_transcript ON messages(transcript_id) WHERE transcript_id IS NOT NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN RAISE NOTICE '✓ Messages table created'; END $$;

-- ============================================================================
-- STEP 8: Create leaderboard view
-- ============================================================================

CREATE OR REPLACE VIEW company_streak_leaderboard AS
SELECT
  us.company_id,
  up.id AS user_id,
  up.display_name,
  up.email,
  us.current_streak,
  us.longest_streak,
  us.total_activities,
  us.last_activity_date,
  RANK() OVER (
    PARTITION BY us.company_id
    ORDER BY us.current_streak DESC, us.longest_streak DESC
  ) AS company_rank,
  (FLOOR(us.current_streak / 7)::INTEGER % 6) AS week_color_index
FROM user_streaks us
JOIN user_profiles up ON up.id = us.user_id
WHERE up.is_active = true
ORDER BY us.company_id, company_rank;

DO $$ BEGIN RAISE NOTICE '✓ Leaderboard view created'; END $$;

-- ============================================================================
-- STEP 9: Recreate trigger for new users
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
BEGIN
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'user');

  IF user_role = 'admin' THEN
    user_role := 'super_admin';
  END IF;

  INSERT INTO public.user_profiles (id, email, display_name, role, company_id, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    user_role,
    (NEW.raw_user_meta_data->>'company_id')::UUID,
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DO $$ BEGIN RAISE NOTICE '✓ Trigger recreated'; END $$;

-- ============================================================================
-- STEP 10: Create ALL RLS Policies (now that all columns exist)
-- ============================================================================

-- Companies policies
CREATE POLICY "Anyone can read active companies"
ON companies FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Super admins can manage companies"
ON companies FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND user_profiles.role = 'super_admin'
  )
);

-- User profiles policies
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'super_admin')
  OR id = auth.uid()
  OR company_id IN (
    SELECT company_id FROM user_profiles
    WHERE id = auth.uid() AND role = 'company_admin'
  )
);

CREATE POLICY "Admins can create profiles"
ON user_profiles FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR (
    company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
    AND role NOT IN ('super_admin', 'company_admin')
  )
);

CREATE POLICY "Admins can update profiles"
ON user_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR (
    company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
    AND role NOT IN ('super_admin', 'company_admin')
  )
  OR id = auth.uid()
);

CREATE POLICY "Admins can delete profiles"
ON user_profiles FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR (
    company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
    AND role NOT IN ('super_admin', 'company_admin')
  )
);

-- Transcripts policies
CREATE POLICY "Company-scoped transcript access"
ON transcripts FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR (
    company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    AND (
      EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
      OR uploaded_by = auth.uid()
    )
  )
);

CREATE POLICY "Users can create transcripts in their company"
ON transcripts FOR INSERT
TO authenticated
WITH CHECK (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins and owners can delete transcripts"
ON transcripts FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR (
    company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
  )
  OR uploaded_by = auth.uid()
);

-- Salespeople policies
CREATE POLICY "Users can read salespeople in their company"
ON salespeople FOR SELECT
TO anon, authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  OR auth.uid() IS NULL
);

CREATE POLICY "Admins can manage salespeople"
ON salespeople FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'company_admin'))
);

-- Login logs policies
CREATE POLICY "Users can insert own login logs"
ON login_logs FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read company login logs"
ON login_logs FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
);

-- Invites policies
CREATE POLICY "Company admins can manage invites"
ON company_invites FOR ALL
TO authenticated
USING (
  company_id IN (
    SELECT company_id FROM user_profiles
    WHERE id = auth.uid()
    AND role IN ('company_admin', 'super_admin')
  )
);

-- Messages policies
CREATE POLICY "Users can read company messages"
ON messages FOR SELECT
TO authenticated
USING (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  AND NOT deleted
);

CREATE POLICY "Users can create messages"
ON messages FOR INSERT
TO authenticated
WITH CHECK (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
);

CREATE POLICY "Users can update own messages"
ON messages FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- Streaks policies
CREATE POLICY "Users can read own streaks"
ON user_streaks FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'company_admin'))
);

CREATE POLICY "Users can update own streaks"
ON user_streaks FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage own streak activities"
ON streak_activities FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DO $$ BEGIN RAISE NOTICE '✓ All RLS policies created'; END $$;

-- ============================================================================
-- Migration Complete!
-- ============================================================================

-- ============================================================================
-- STEP 11: Recreate views that were dropped
-- ============================================================================

-- Recreate user_login_stats view (now with company_id)
CREATE OR REPLACE VIEW user_login_stats AS
SELECT
  up.id AS user_id,
  up.email,
  up.display_name,
  up.role,
  up.company_id,
  up.is_active,
  COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') AS logins_last_7_days,
  COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '24 hours') AS logins_last_24_hours,
  COUNT(DISTINCT DATE(ll.logged_in_at)) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') AS unique_days_logged_in,
  MAX(ll.logged_in_at) AS last_login,
  CASE
    WHEN COUNT(ll.id) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 10 THEN true
    WHEN COUNT(DISTINCT ll.ip_address) FILTER (WHERE ll.logged_in_at >= NOW() - INTERVAL '7 days') > 5 THEN true
    ELSE false
  END AS is_suspicious
FROM user_profiles up
LEFT JOIN login_logs ll ON ll.user_id = up.id
GROUP BY up.id, up.email, up.display_name, up.role, up.company_id, up.is_active;

DO $$ BEGIN RAISE NOTICE '✓ Views recreated'; END $$;

-- ============================================================================
-- Migration Complete!
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Verify default company was created';
  RAISE NOTICE '2. Check that all users are assigned to companies';
  RAISE NOTICE '3. Test RLS policies work as expected';
  RAISE NOTICE '========================================';
END $$;

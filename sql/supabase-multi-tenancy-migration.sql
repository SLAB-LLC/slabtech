-- ============================================================================
-- SLAB Voice Multi-Tenancy Migration
-- ============================================================================
-- This migration transforms SLAB from single-tenant to multi-tenant SaaS
-- Run this in Supabase SQL Editor
-- IMPORTANT: Replace 'DEFAULT_COMPANY_ID' placeholder with actual UUID after company creation

-- ============================================================================
-- PHASE 1.1: Create Companies Table
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

CREATE INDEX idx_companies_slug ON companies(slug);
CREATE INDEX idx_companies_active ON companies(is_active) WHERE is_active = true;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- NOTE: RLS policies for companies table will be added AFTER user_profiles.company_id column exists
-- to avoid circular dependency issues during migration

-- ============================================================================
-- PHASE 1.2: Update User Profiles Table
-- ============================================================================

-- 1) Drop trigger FIRST to prevent unexpected inserts during migration
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 2) Drop the old constraint FIRST
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- 3) Clean ALL existing data BEFORE adding new constraint
-- Map all legacy/unknown roles to valid values
UPDATE user_profiles SET role = 'super_admin' WHERE role = 'admin';
UPDATE user_profiles SET role = 'user' WHERE role IS NULL;
UPDATE user_profiles SET role = 'user' WHERE role NOT IN ('super_admin', 'company_admin', 'user');

-- 4) Add company_id column (nullable for now)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- 5) NOW add the new constraint (after data is clean)
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin', 'company_admin', 'user'));

-- 6) Create profiles for any auth.users that don't have them yet (legacy users)
INSERT INTO user_profiles (id, email, display_name, role, is_active, created_at, updated_at)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'display_name', au.email),
  'super_admin', -- Default legacy users to super_admin
  true,
  au.created_at,
  NOW()
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
WHERE up.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 7) Recreate the handle_new_user trigger function with new role support
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Get role from metadata, default to 'user'
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'user');

  -- Map legacy 'admin' to 'super_admin'
  IF user_role = 'admin' THEN
    user_role := 'super_admin';
  END IF;

  -- Insert user profile
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

-- 8) Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 9) Indexes for company-scoped queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON user_profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- 10) NOW create RLS policies for companies table (after company_id column exists)
-- Anyone can read active companies (for login page lookup)
CREATE POLICY "Anyone can read active companies"
ON companies FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Super admins can manage companies
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

-- ============================================================================
-- PHASE 1.3: Add company_id to All Data Tables
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

-- Create user_streaks table with company_id from the start
CREATE TABLE IF NOT EXISTS user_streaks (
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
CREATE INDEX IF NOT EXISTS idx_user_streaks_user ON user_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_streaks_company ON user_streaks(company_id);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

-- Create streak_activities table
CREATE TABLE IF NOT EXISTS streak_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  activity_type TEXT DEFAULT 'audio_listen',
  transcript_id UUID REFERENCES transcripts(id),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, activity_date)
);
CREATE INDEX IF NOT EXISTS idx_streak_activities_user ON streak_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_streak_activities_company ON streak_activities(company_id);
CREATE INDEX IF NOT EXISTS idx_streak_activities_date ON streak_activities(activity_date);

ALTER TABLE streak_activities ENABLE ROW LEVEL SECURITY;

-- Create trigger function to update user_streaks
CREATE OR REPLACE FUNCTION update_user_streak()
RETURNS TRIGGER AS $$
BEGIN
  -- Upsert user_streaks record
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

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_user_streak ON streak_activities;
CREATE TRIGGER trigger_update_user_streak
  AFTER INSERT ON streak_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_user_streak();

-- ============================================================================
-- PHASE 1.4: Create Default Company and Backfill Data
-- ============================================================================

-- Create default "SLAB Internal" company
DO $$
DECLARE
  default_company_id UUID;
BEGIN
  -- Insert default company and get its ID
  INSERT INTO companies (name, slug, is_active)
  VALUES ('SLAB Internal', 'slab-internal', true)
  ON CONFLICT (slug) DO UPDATE SET name = 'SLAB Internal'
  RETURNING id INTO default_company_id;

  -- Update all existing super_admins to assign to default company
  UPDATE user_profiles
  SET company_id = default_company_id
  WHERE role = 'super_admin' AND company_id IS NULL;

  -- Update all users without company to default company
  UPDATE user_profiles
  SET company_id = default_company_id
  WHERE company_id IS NULL;

  -- Backfill company_id on existing transcripts
  UPDATE transcripts
  SET company_id = default_company_id
  WHERE company_id IS NULL;

  -- Backfill company_id on existing salespeople
  UPDATE salespeople
  SET company_id = default_company_id
  WHERE company_id IS NULL;

  -- Backfill company_id on login_logs from user_profiles
  UPDATE login_logs
  SET company_id = (SELECT company_id FROM user_profiles WHERE id = login_logs.user_id)
  WHERE company_id IS NULL;

  RAISE NOTICE 'Default company created with ID: %', default_company_id;
END $$;

-- Make company_id NOT NULL after backfill
ALTER TABLE user_profiles ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE transcripts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE salespeople ALTER COLUMN company_id SET NOT NULL;

-- ============================================================================
-- PHASE 1.5: Company Invites Table
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

-- Company admins can manage invites for their company
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

-- ============================================================================
-- PHASE 1.6: Messaging Tables
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

-- Users can read messages in their company
CREATE POLICY "Users can read company messages"
ON messages FOR SELECT
TO authenticated
USING (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  AND NOT deleted
);

-- Users can create messages in their company
CREATE POLICY "Users can create messages"
ON messages FOR INSERT
TO authenticated
WITH CHECK (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
);

-- Users can update their own messages
CREATE POLICY "Users can update own messages"
ON messages FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- ============================================================================
-- PHASE 1.7: Leaderboard View
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
  (FLOOR(us.current_streak / 7) % 6) AS week_color_index
FROM user_streaks us
JOIN user_profiles up ON up.id = us.user_id
WHERE up.is_active = true
ORDER BY us.company_id, company_rank;

-- ============================================================================
-- PHASE 2: Update RLS Policies for Company Isolation
-- ============================================================================

-- User Profiles Policies
DROP POLICY IF EXISTS "Admins can read all user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can create user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can delete user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;

-- Super admins see all, company admins see their company, users see own
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
TO authenticated
USING (
  -- Super admins see all
  EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'super_admin')
  OR
  -- Users see own profile
  id = auth.uid()
  OR
  -- Company admins see profiles in their company
  company_id IN (
    SELECT company_id FROM user_profiles
    WHERE id = auth.uid() AND role = 'company_admin'
  )
);

-- Super admins create any, company admins create in their company
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

-- Similar for UPDATE
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

-- Similar for DELETE
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

-- Transcripts Policies
DROP POLICY IF EXISTS "Role-based transcript read access" ON transcripts;
DROP POLICY IF EXISTS "Authenticated users can create transcripts" ON transcripts;
DROP POLICY IF EXISTS "Users can delete own transcripts" ON transcripts;
DROP POLICY IF EXISTS "Admins can delete any transcript" ON transcripts;

CREATE POLICY "Company-scoped transcript access"
ON transcripts FOR SELECT
TO authenticated
USING (
  -- Super admins see all
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR
  -- Users see transcripts in their company
  (
    company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    AND (
      -- Company admins see all in company
      EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
      OR uploaded_by = auth.uid()
      OR EXISTS (SELECT 1 FROM transcript_assignments WHERE transcript_id = transcripts.id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM salesperson_subscriptions WHERE user_id = auth.uid() AND salesperson_name = transcripts.salesperson_name)
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

-- Salespeople Policies
DROP POLICY IF EXISTS "Anyone can read salespeople" ON salespeople;
DROP POLICY IF EXISTS "Authenticated users can manage salespeople" ON salespeople;

CREATE POLICY "Users can read salespeople in their company"
ON salespeople FOR SELECT
TO anon, authenticated
USING (
  -- Super admins see all
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR
  -- Users see salespeople in their company
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  OR
  -- Anonymous users can see all (for upload form - may need to adjust)
  auth.uid() IS NULL
);

CREATE POLICY "Admins can manage salespeople"
ON salespeople FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('super_admin', 'company_admin'))
);

-- Login Logs Policies
DROP POLICY IF EXISTS "Users can insert own login logs" ON login_logs;
DROP POLICY IF EXISTS "Admins can read all login logs" ON login_logs;

CREATE POLICY "Users can insert own login logs"
ON login_logs FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read company login logs"
ON login_logs FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid() AND role = 'company_admin')
);

-- User Streaks Policies
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

-- Streak Activities Policies
CREATE POLICY "Users can manage own streak activities"
ON streak_activities FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- Migration Complete!
-- ============================================================================
--
-- Next steps:
-- 1. Verify all tables have company_id columns
-- 2. Check that default company was created
-- 3. Confirm existing users are now super_admins
-- 4. Test RLS policies work as expected
--
-- ============================================================================

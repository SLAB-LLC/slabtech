-- ============================================================================
-- Fix: Infinite Recursion in user_profiles RLS Policies
-- ============================================================================
-- The issue: Policies on user_profiles were querying user_profiles, causing infinite recursion
-- The fix: Use security definer functions that bypass RLS

-- Create helper function to get current user's role (bypasses RLS)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- Create helper function to get current user's company_id (bypasses RLS)
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid();
$$;

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can read profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can create profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON user_profiles;

-- Recreate policies using the security definer functions
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
TO authenticated
USING (
  -- Super admins see all
  public.current_user_role() = 'super_admin'
  OR
  -- Users see own profile
  id = auth.uid()
  OR
  -- Company admins see profiles in their company
  (public.current_user_role() = 'company_admin' AND company_id = public.current_user_company_id())
);

CREATE POLICY "Admins can create profiles"
ON user_profiles FOR INSERT
TO authenticated
WITH CHECK (
  public.current_user_role() = 'super_admin'
  OR (
    public.current_user_role() = 'company_admin'
    AND company_id = public.current_user_company_id()
    AND role NOT IN ('super_admin', 'company_admin')
  )
);

CREATE POLICY "Admins can update profiles"
ON user_profiles FOR UPDATE
TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR (
    public.current_user_role() = 'company_admin'
    AND company_id = public.current_user_company_id()
    AND role NOT IN ('super_admin', 'company_admin')
  )
  OR id = auth.uid()
);

CREATE POLICY "Admins can delete profiles"
ON user_profiles FOR DELETE
TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR (
    public.current_user_role() = 'company_admin'
    AND company_id = public.current_user_company_id()
    AND role NOT IN ('super_admin', 'company_admin')
  )
);

-- Also fix other policies that might have similar issues

-- Fix transcripts policies
DROP POLICY IF EXISTS "Company-scoped transcript access" ON transcripts;

CREATE POLICY "Company-scoped transcript access"
ON transcripts FOR SELECT
TO authenticated
USING (
  -- Super admins see all
  public.current_user_role() = 'super_admin'
  OR
  -- Users see transcripts in their company
  (
    company_id = public.current_user_company_id()
    AND (
      -- Company admins see all in company
      public.current_user_role() = 'company_admin'
      OR uploaded_by = auth.uid()
    )
  )
);

-- Fix salespeople policies
DROP POLICY IF EXISTS "Users can read salespeople in their company" ON salespeople;

CREATE POLICY "Users can read salespeople in their company"
ON salespeople FOR SELECT
TO anon, authenticated
USING (
  -- Super admins see all
  public.current_user_role() = 'super_admin'
  OR
  -- Users see salespeople in their company
  company_id = public.current_user_company_id()
  OR
  -- Anonymous users can see all (for upload form - may need to adjust)
  auth.uid() IS NULL
);

-- Fix login logs policies
DROP POLICY IF EXISTS "Admins can read company login logs" ON login_logs;

CREATE POLICY "Admins can read company login logs"
ON login_logs FOR SELECT
TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR
  (public.current_user_role() = 'company_admin' AND company_id = public.current_user_company_id())
);

-- Fix company invites policies
DROP POLICY IF EXISTS "Company admins can manage invites" ON company_invites;

CREATE POLICY "Company admins can manage invites"
ON company_invites FOR ALL
TO authenticated
USING (
  public.current_user_role() IN ('super_admin', 'company_admin')
  AND (public.current_user_role() = 'super_admin' OR company_id = public.current_user_company_id())
);

-- Fix messages policies
DROP POLICY IF EXISTS "Users can read company messages" ON messages;
DROP POLICY IF EXISTS "Users can create messages" ON messages;

CREATE POLICY "Users can read company messages"
ON messages FOR SELECT
TO authenticated
USING (
  company_id = public.current_user_company_id()
  AND NOT deleted
);

CREATE POLICY "Users can create messages"
ON messages FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.current_user_company_id()
);

-- Fix user_streaks policies
DROP POLICY IF EXISTS "Users can read own streaks" ON user_streaks;

CREATE POLICY "Users can read own streaks"
ON user_streaks FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.current_user_role() IN ('super_admin', 'company_admin')
);

-- Fix companies policies
DROP POLICY IF EXISTS "Super admins can manage companies" ON companies;

CREATE POLICY "Super admins can manage companies"
ON companies FOR ALL
TO authenticated
USING (public.current_user_role() = 'super_admin');

DO $$ BEGIN RAISE NOTICE 'RLS policies fixed! Infinite recursion resolved.'; END $$;

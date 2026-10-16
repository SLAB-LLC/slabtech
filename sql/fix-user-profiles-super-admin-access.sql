-- ============================================================================
-- FIX: Allow super admins to see users from all companies
-- ============================================================================
-- Issue: Super admins can only see users in their own company
-- Fix: Update RLS policy to allow super admin role to see all profiles
-- ============================================================================

-- First, verify the current_user_role() function exists
-- (It should have been created by fix-rls-infinite-recursion.sql)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- Also verify the current_user_company_id() function exists
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid();
$$;

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Users can read profiles" ON user_profiles;

-- Create the correct policy with super admin access
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
TO authenticated
USING (
  -- Super admins see ALL users across ALL companies
  public.current_user_role() = 'super_admin'
  OR
  -- Users see their own profile
  id = auth.uid()
  OR
  -- Company admins see all users in their company
  (public.current_user_role() = 'company_admin' AND company_id = public.current_user_company_id())
  OR
  -- Regular users see all users in their company (for leaderboard, etc.)
  company_id = public.current_user_company_id()
);

-- Verify the policy was created
SELECT
  'user_profiles Policies' AS check_type,
  policyname,
  cmd,
  qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_profiles'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Test query: How many users can I see now?
SELECT
  'Visible Users Test' AS test_type,
  COUNT(*) AS total_users,
  COUNT(DISTINCT company_id) AS distinct_companies
FROM user_profiles;

DO $$ BEGIN RAISE NOTICE 'Super admin access to user_profiles has been restored!'; END $$;

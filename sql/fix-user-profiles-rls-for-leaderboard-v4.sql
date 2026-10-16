-- Fix RLS policy - complete fix without ANY recursion

-- Create helper function for user's role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

-- Create helper function for user's company_id
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$$;

-- Drop the old policy
DROP POLICY IF EXISTS "Users can read profiles" ON user_profiles;

-- Create new policy with NO recursion
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
TO authenticated
USING (
  -- Super admins can see all
  public.get_user_role() = 'super_admin'
  -- Users can see their own profile
  OR id = auth.uid()
  -- Users can see other users in the same company
  OR company_id = public.get_user_company_id()
);

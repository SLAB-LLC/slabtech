-- FINAL FIX: Allow users to see profiles in their company for leaderboard
-- This uses a security definer function to avoid RLS recursion
-- Run this in Supabase SQL Editor

-- Create helper function in public schema
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.user_profiles
  WHERE id = auth.uid();

  RETURN v_company_id;
END;
$$;

-- Drop old policy
DROP POLICY IF EXISTS "Users can read profiles" ON user_profiles;

-- Create new policy allowing same-company access
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR company_id = public.get_my_company_id()
);

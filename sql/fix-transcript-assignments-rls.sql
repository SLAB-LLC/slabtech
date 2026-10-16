-- ============================================================================
-- FIX: Allow users to read their own transcript assignments
-- ============================================================================
-- The transcripts RLS policy checks transcript_assignments, but that table
-- also has RLS which blocks the check! This fixes it.
-- ============================================================================

-- Check current state
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'transcript_assignments';

-- Add policy for users to read their own assignments
-- (This allows the transcripts RLS policy to work)
DROP POLICY IF EXISTS "Users can read own transcript assignments" ON transcript_assignments;

CREATE POLICY "Users can read own transcript assignments"
ON transcript_assignments FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Also allow admins to read all assignments
DROP POLICY IF EXISTS "Admins can read all transcript assignments" ON transcript_assignments;

CREATE POLICY "Admins can read all transcript assignments"
ON transcript_assignments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'company_admin')
  )
);

-- Verify policies exist
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'transcript_assignments'
ORDER BY policyname;

-- ============================================================================
-- Now re-enable RLS on transcripts and test
-- ============================================================================

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Test: User should now see their assigned transcripts!
-- ============================================================================

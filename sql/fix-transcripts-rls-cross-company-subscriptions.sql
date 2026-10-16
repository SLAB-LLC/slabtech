-- ============================================================================
-- FIX: Allow Subscriptions to Work Across Company Boundaries
-- ============================================================================
-- Option B: If you're subscribed to a salesperson, you see ALL their
-- transcripts regardless of which company they're in.
-- ============================================================================

DROP POLICY IF EXISTS "Company-scoped transcript access" ON transcripts;

CREATE POLICY "Company-scoped transcript access"
ON transcripts FOR SELECT
TO authenticated
USING (
  -- Super admins see all transcripts
  public.current_user_role() = 'super_admin'

  OR

  -- Users see transcripts from salespeople they're subscribed to (ACROSS ALL COMPANIES!)
  EXISTS (
    SELECT 1 FROM salesperson_subscriptions ss
    WHERE ss.user_id = auth.uid()
    AND ss.salesperson_name = transcripts.salesperson_name
  )

  OR

  -- Users see transcripts in their company if any of these conditions are met:
  (
    company_id = public.current_user_company_id()
    AND (
      -- Company admins see all in company
      public.current_user_role() = 'company_admin'

      -- Users see their own uploads
      OR uploaded_by = auth.uid()

      -- Users see transcripts they're assigned to
      OR EXISTS (
        SELECT 1 FROM transcript_assignments ta
        WHERE ta.transcript_id = transcripts.id
        AND ta.user_id = auth.uid()
      )
    )
  )
);

-- ============================================================================
-- Verification
-- ============================================================================

-- Show the updated policy
SELECT
  'Updated Transcripts Policy' AS check_type,
  policyname,
  cmd,
  qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'transcripts'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Test: Users subscribed to Rylan should now see all Rylan transcripts
-- (Run this as a user subscribed to Rylan, e.g., duncangrant04@gmail.com)
SELECT
  'My Subscriptions' AS test_type,
  salesperson_name,
  COUNT(*) AS subscription_count
FROM salesperson_subscriptions
WHERE user_id = auth.uid()
GROUP BY salesperson_name;

SELECT
  'Transcripts I Can See' AS test_type,
  COUNT(*) AS total_visible_transcripts,
  COUNT(*) FILTER (WHERE salesperson_name = 'Rylan') AS rylan_transcripts,
  COUNT(*) FILTER (WHERE company_id = public.current_user_company_id()) AS same_company_transcripts,
  COUNT(*) FILTER (WHERE company_id != public.current_user_company_id()) AS cross_company_transcripts
FROM transcripts;

DO $$ BEGIN RAISE NOTICE 'Subscriptions now work across all companies!'; END $$;

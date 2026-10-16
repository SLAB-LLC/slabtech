-- ============================================================================
-- Fix conversations RLS policy to include salesperson subscriptions
-- ============================================================================
-- This adds subscription checking to the conversations read policy
-- ============================================================================

-- Drop the existing policy
DROP POLICY IF EXISTS "Users can read conversations for accessible transcripts" ON conversations;

-- Create updated policy with subscription support
CREATE POLICY "Users can read conversations for accessible transcripts"
ON conversations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM transcripts t
    WHERE t.id = conversations.transcript_id
    AND (
      -- Admin can see all
      EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid() AND up.role = 'admin'
      )
      -- User uploaded it
      OR t.uploaded_by = auth.uid()
      -- User has assignment
      OR EXISTS (
        SELECT 1 FROM transcript_assignments ta
        WHERE ta.transcript_id = t.id AND ta.user_id = auth.uid()
      )
      -- User is subscribed to this salesperson (NEW!)
      OR EXISTS (
        SELECT 1 FROM salesperson_subscriptions ss
        WHERE ss.salesperson_name = t.salesperson_name
        AND ss.user_id = auth.uid()
      )
    )
  )
);

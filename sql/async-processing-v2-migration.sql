-- ============================================================================
-- Async Processing V2 Migration
-- ============================================================================
-- Adds 'finalizing' to the status column so the status polling endpoint can
-- atomically claim a transcript for processing without double-processing it.
-- Run this in your Supabase SQL Editor.

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  -- Find any existing CHECK constraint on the status column
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'transcripts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  -- Drop it if found
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transcripts DROP CONSTRAINT %I', v_constraint);
  END IF;

  -- Add expanded constraint
  ALTER TABLE transcripts
    ADD CONSTRAINT transcripts_status_check
    CHECK (status IN ('pending', 'processing', 'finalizing', 'completed', 'error'));
END $$;

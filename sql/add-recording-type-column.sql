-- Add recording_type column to transcripts table
-- 'continuous' (default) — normal field recording with 30s+ gaps between doors
-- 'edited_clips' — pre-edited / concatenated clips with only ~2s gaps; segmenter
--                  uses greeting detection + 2s gap to split conversations.

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS recording_type VARCHAR(50) DEFAULT 'continuous';

-- Backfill any existing rows so they're never NULL
UPDATE transcripts SET recording_type = 'continuous' WHERE recording_type IS NULL;

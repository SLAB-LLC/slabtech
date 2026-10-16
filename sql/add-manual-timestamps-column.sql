-- Add manual_timestamps column for the 'manual_timestamps' recording_type.
-- Stores an array of conversation boundaries: [{start: number, end: number}]
-- where start/end are in seconds.

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS manual_timestamps JSONB DEFAULT NULL;

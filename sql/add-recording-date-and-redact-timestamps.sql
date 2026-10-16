-- 1. recording_date: lets the uploader specify the date the audio was actually
--    recorded (defaults to upload date in the app, but can be backdated for
--    recordings uploaded after the fact). Used for date-based displays like
--    the sales heatmap calendar instead of created_at (upload time).
--
-- 2. redact_timestamps: array of {start, end} ranges (seconds) the uploader
--    marks as sensitive/non-sales content (e.g. a personal phone call picked
--    up mid-recording). Words inside these ranges are dropped before
--    conversation segmentation/analysis, and the ranges are merged into
--    pii_matches so the audio gets muted in the same pass as PII redaction.

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS recording_date DATE,
  ADD COLUMN IF NOT EXISTS redact_timestamps JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_transcripts_recording_date ON transcripts(recording_date);

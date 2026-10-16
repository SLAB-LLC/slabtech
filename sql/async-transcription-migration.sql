-- ============================================================================
-- Async Transcription Migration
-- ============================================================================
-- Adds fields to support asynchronous audio processing

-- Add status tracking fields to transcripts table
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  ADD COLUMN IF NOT EXISTS assemblyai_transcript_id TEXT,
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMP WITH TIME ZONE;

-- Add index for efficient status queries
CREATE INDEX IF NOT EXISTS idx_transcripts_status ON transcripts(status, processing_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_assemblyai_id ON transcripts(assemblyai_transcript_id);

-- Add comment
COMMENT ON COLUMN transcripts.status IS 'Processing status: processing, completed, or error';
COMMENT ON COLUMN transcripts.assemblyai_transcript_id IS 'AssemblyAI transcript ID for polling status';
COMMENT ON COLUMN transcripts.processing_error IS 'Error message if processing failed';

-- ============================================================================
-- Upload Metadata Migration
-- ============================================================================
-- Adds metadata fields to transcripts table for improved AI accuracy
-- Run this SQL in your Supabase SQL Editor

-- Add metadata columns to transcripts table
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS actual_sales_count INTEGER,
  ADD COLUMN IF NOT EXISTS expected_customer_count INTEGER,
  ADD COLUMN IF NOT EXISTS area_type TEXT CHECK (area_type IN ('city', 'suburb', 'boonies', 'townhomes', 'lake_homes', 'rural', 'mixed')),
  ADD COLUMN IF NOT EXISTS estimated_duration_hours DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS upload_notes TEXT;

-- Add comments for documentation
COMMENT ON COLUMN transcripts.actual_sales_count IS 'Number of sales the rep actually made (ground truth for AI calibration)';
COMMENT ON COLUMN transcripts.expected_customer_count IS 'Number of doors/customers the rep talked to';
COMMENT ON COLUMN transcripts.area_type IS 'Type of area: city, suburb, boonies, townhomes, lake_homes, rural, mixed';
COMMENT ON COLUMN transcripts.estimated_duration_hours IS 'Rep-estimated duration of the recording in hours';
COMMENT ON COLUMN transcripts.upload_notes IS 'Additional context/notes from the rep about this recording';

-- Add index for reporting/analytics queries
CREATE INDEX IF NOT EXISTS idx_transcripts_area_type ON transcripts(area_type);
CREATE INDEX IF NOT EXISTS idx_transcripts_sales_count ON transcripts(actual_sales_count) WHERE actual_sales_count IS NOT NULL;

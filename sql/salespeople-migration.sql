-- ============================================================================
-- Salespeople Migration
-- ============================================================================
-- Run this SQL in your Supabase SQL Editor to add the salespeople feature.
-- ============================================================================

-- Table: salespeople
-- Stores the list of salespeople for organizing transcripts
CREATE TABLE salespeople (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Add salesperson_id column to transcripts table
ALTER TABLE transcripts ADD COLUMN salesperson_id UUID REFERENCES salespeople(id);

-- Remove the old customer_name column (no longer needed)
ALTER TABLE transcripts DROP COLUMN IF EXISTS customer_name;

-- Enable RLS on salespeople table
ALTER TABLE salespeople ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to read salespeople (needed for public upload form)
CREATE POLICY "Allow anyone to read salespeople"
ON salespeople
FOR SELECT
TO anon, authenticated
USING (true);

-- Policy: Allow authenticated users to insert salespeople
CREATE POLICY "Allow authenticated users to insert salespeople"
ON salespeople
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update salespeople
CREATE POLICY "Allow authenticated users to update salespeople"
ON salespeople
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy: Allow authenticated users to delete salespeople
CREATE POLICY "Allow authenticated users to delete salespeople"
ON salespeople
FOR DELETE
TO authenticated
USING (true);

-- Insert the "Misc" salesperson first (for old/unassigned transcripts)
INSERT INTO salespeople (name, display_order) VALUES ('Misc', 999);

-- Insert the initial 5 salespeople
INSERT INTO salespeople (name, display_order) VALUES ('Rylan', 1);
INSERT INTO salespeople (name, display_order) VALUES ('2', 2);
INSERT INTO salespeople (name, display_order) VALUES ('3', 3);
INSERT INTO salespeople (name, display_order) VALUES ('4', 4);
INSERT INTO salespeople (name, display_order) VALUES ('5', 5);

-- Move any existing transcripts without a salesperson_id to "Misc"
UPDATE transcripts
SET salesperson_id = (SELECT id FROM salespeople WHERE name = 'Misc')
WHERE salesperson_id IS NULL;

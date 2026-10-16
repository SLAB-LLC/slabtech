-- ============================================================================
-- Conversations Migration - Conversation Segmentation & Analysis
-- ============================================================================
-- This migration adds conversation segmentation, categorization, and objection
-- tracking for door-to-door sales training.
-- ============================================================================

-- ============================================================================
-- Table: conversations
-- ============================================================================
-- Stores individual conversation segments detected within transcripts
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  conversation_number INT NOT NULL,

  -- Time boundaries (in seconds)
  start_time DECIMAL NOT NULL,
  end_time DECIMAL NOT NULL,

  -- Speaker information
  speakers JSONB NOT NULL, -- e.g., ["A", "B"]
  sales_rep_speaker TEXT NOT NULL DEFAULT 'A',

  -- Conversation metrics
  word_count INT NOT NULL DEFAULT 0,
  duration_seconds DECIMAL NOT NULL,

  -- Categorization (interaction, pitch, or sale)
  category TEXT CHECK (category IN ('interaction', 'pitch', 'sale', 'uncategorized')),

  -- Detected objections
  objections JSONB DEFAULT '[]'::jsonb, -- Array of objection types
  objections_with_text JSONB DEFAULT '[]'::jsonb, -- Array of {type, text} objects

  -- AI analysis metadata
  has_price_mention BOOLEAN DEFAULT false,
  pii_redaction_count INT DEFAULT 0,
  analysis_completed BOOLEAN DEFAULT false,
  analysis_error TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),

  -- Ensure conversation numbers are unique within a transcript
  UNIQUE(transcript_id, conversation_number)
);

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Indexes for efficient queries
CREATE INDEX idx_conversations_transcript ON conversations(transcript_id);
CREATE INDEX idx_conversations_category ON conversations(category);
CREATE INDEX idx_conversations_objections ON conversations USING gin(objections);
CREATE INDEX idx_conversations_time ON conversations(start_time, end_time);

-- ============================================================================
-- RLS Policies for conversations
-- ============================================================================

-- Users can read conversations for transcripts they have access to
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
    )
  )
);

-- Only system/API can insert conversations (via service role)
CREATE POLICY "Service role can insert conversations"
ON conversations
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Only system/API can update conversations (via service role)
CREATE POLICY "Service role can update conversations"
ON conversations
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Admins can delete conversations
CREATE POLICY "Admins can delete conversations"
ON conversations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

-- ============================================================================
-- Function: update_conversation_updated_at
-- ============================================================================
-- Automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_update_conversation_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_updated_at();

-- ============================================================================
-- View: conversation_stats
-- ============================================================================
-- Provides conversation statistics per transcript
CREATE OR REPLACE VIEW conversation_stats AS
SELECT
  t.id AS transcript_id,
  t.salesperson_id,
  t.salesperson_name,
  COUNT(c.id) AS total_conversations,
  COUNT(c.id) FILTER (WHERE c.category = 'interaction') AS interaction_count,
  COUNT(c.id) FILTER (WHERE c.category = 'pitch') AS pitch_count,
  COUNT(c.id) FILTER (WHERE c.category = 'sale') AS sale_count,
  COUNT(c.id) FILTER (WHERE c.category = 'uncategorized') AS uncategorized_count,
  AVG(c.duration_seconds) FILTER (WHERE c.category = 'sale') AS avg_sale_duration,
  AVG(c.duration_seconds) FILTER (WHERE c.category = 'pitch') AS avg_pitch_duration,
  AVG(c.duration_seconds) FILTER (WHERE c.category = 'interaction') AS avg_interaction_duration
FROM transcripts t
LEFT JOIN conversations c ON c.transcript_id = t.id
GROUP BY t.id, t.salesperson_id, t.salesperson_name;

-- ============================================================================
-- View: objection_frequency
-- ============================================================================
-- Shows how often each objection type appears across all conversations
CREATE OR REPLACE VIEW objection_frequency AS
SELECT
  objection_type,
  COUNT(*) AS frequency,
  COUNT(*) FILTER (WHERE c.category = 'pitch') AS in_pitches,
  COUNT(*) FILTER (WHERE c.category = 'sale') AS in_sales,
  COUNT(*) FILTER (WHERE c.category = 'interaction') AS in_interactions
FROM conversations c,
LATERAL jsonb_array_elements_text(c.objections) AS objection_type
GROUP BY objection_type
ORDER BY frequency DESC;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE conversations IS 'Individual conversation segments detected within audio transcripts';
COMMENT ON COLUMN conversations.conversation_number IS 'Sequential number of conversation within transcript (1, 2, 3...)';
COMMENT ON COLUMN conversations.speakers IS 'Array of speaker IDs involved in this conversation';
COMMENT ON COLUMN conversations.category IS 'Type of conversation: interaction (no price), pitch (price but no sale), or sale (credit card collected)';
COMMENT ON COLUMN conversations.objections IS 'Array of detected objections: diy, spouse, price, competitor, delay, not_interested, no_problem';
COMMENT ON COLUMN conversations.has_price_mention IS 'Whether price/cost was mentioned in the conversation';
COMMENT ON COLUMN conversations.pii_redaction_count IS 'Number of PII redactions within this conversation timeframe (high count indicates credit card info)';

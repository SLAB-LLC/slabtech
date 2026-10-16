-- Add objection_timestamps column to store the timestamp where each objection occurs
-- This allows users to click an objection and jump to that point in the audio

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS objection_timestamps JSONB DEFAULT '[]'::jsonb;

-- Example data structure:
-- [
--   {"type": "price", "text": "that's too expensive", "timestamp": 145.3},
--   {"type": "spouse", "text": "I need to ask my wife", "timestamp": 230.7}
-- ]

COMMENT ON COLUMN conversations.objection_timestamps IS 'Array of objections with their timestamps in the audio for click-to-navigate feature';

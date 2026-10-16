-- ============================================================================
-- Add objections_with_text column to conversations table
-- ============================================================================
-- Run this after the initial conversations migration

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS objections_with_text JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN conversations.objections_with_text IS 'Array of {type, text} objects containing objection types and the exact phrases where they occur';

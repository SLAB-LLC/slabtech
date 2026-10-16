-- Add shared_content_title field to chat_messages for better display of shared transcripts

ALTER TABLE chat_messages
ADD COLUMN shared_content_title TEXT;

COMMENT ON COLUMN chat_messages.shared_content_title IS 'Display title for shared content (e.g., "Rylan - Conversation #4")';

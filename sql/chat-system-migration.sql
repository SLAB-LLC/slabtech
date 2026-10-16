-- ============================================================================
-- SLAB Voice Chat System Migration
-- ============================================================================
-- This migration adds comprehensive chat functionality to SLAB Voice
-- Including DMs, group chats, reactions, read receipts, and transcript sharing
-- Run this in Supabase SQL Editor
-- ============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '🚀 Starting chat system migration...'; END $$;

-- ============================================================================
-- STEP 1: Create channels table (DMs and groups)
-- ============================================================================

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('dm', 'group')),

  -- Group chat metadata (NULL for DMs)
  name TEXT CHECK (
    (channel_type = 'group' AND name IS NOT NULL AND length(name) > 0 AND length(name) <= 100) OR
    (channel_type = 'dm' AND name IS NULL)
  ),
  description TEXT,
  picture_url TEXT, -- Storage path for group picture

  -- Creator/ownership
  created_by UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_channels_company ON channels(company_id);
CREATE INDEX idx_channels_type ON channels(channel_type);
CREATE INDEX idx_channels_created_by ON channels(created_by);
CREATE INDEX idx_channels_company_updated ON channels(company_id, updated_at DESC);

DO $$ BEGIN RAISE NOTICE '✓ Channels table created'; END $$;

-- ============================================================================
-- STEP 2: Create channel_members table
-- ============================================================================

CREATE TABLE IF NOT EXISTS channel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Join metadata
  joined_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  added_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

  -- Left/removed status
  left_at TIMESTAMPTZ,
  removed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,

  -- Last read tracking (for read receipts)
  last_read_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_read_message_id UUID, -- Will be set after chat_messages table is created

  -- Ensure user can only be member once per channel
  UNIQUE(channel_id, user_id)
);

CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);
CREATE INDEX idx_channel_members_active ON channel_members(channel_id, user_id)
  WHERE is_active = true;
CREATE INDEX idx_channel_members_user_active ON channel_members(user_id, is_active);

DO $$ BEGIN RAISE NOTICE '✓ Channel members table created'; END $$;

-- ============================================================================
-- STEP 3: Create chat_messages table
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Message content
  message_text TEXT NOT NULL CHECK (length(message_text) > 0 AND length(message_text) <= 5000),

  -- Transcript sharing (optional)
  transcript_id UUID REFERENCES transcripts(id) ON DELETE SET NULL,
  timestamp_start DECIMAL, -- Start time in seconds for audio clip
  timestamp_end DECIMAL,   -- End time in seconds for audio clip

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Messages cannot be deleted per requirements
  -- Only channels can be archived

  CONSTRAINT valid_timestamp_range CHECK (
    (timestamp_start IS NULL AND timestamp_end IS NULL AND transcript_id IS NULL) OR
    (timestamp_start IS NOT NULL AND timestamp_end IS NOT NULL AND transcript_id IS NOT NULL AND timestamp_end > timestamp_start)
  )
);

CREATE INDEX idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC);
CREATE INDEX idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX idx_chat_messages_transcript ON chat_messages(transcript_id)
  WHERE transcript_id IS NOT NULL;
CREATE INDEX idx_chat_messages_channel_time ON chat_messages(channel_id, created_at DESC);

DO $$ BEGIN RAISE NOTICE '✓ Chat messages table created'; END $$;

-- ============================================================================
-- STEP 4: Add foreign key constraint for last_read_message_id
-- ============================================================================

ALTER TABLE channel_members
  ADD CONSTRAINT fk_last_read_message
  FOREIGN KEY (last_read_message_id)
  REFERENCES chat_messages(id) ON DELETE SET NULL;

DO $$ BEGIN RAISE NOTICE '✓ Foreign key constraint added'; END $$;

-- ============================================================================
-- STEP 5: Create message_reactions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (length(emoji) > 0 AND length(emoji) <= 10),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- User can only react once with same emoji per message
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_message_reactions_user ON message_reactions(user_id);

DO $$ BEGIN RAISE NOTICE '✓ Message reactions table created'; END $$;

-- ============================================================================
-- STEP 6: Create channel_archives table (soft delete)
-- ============================================================================

CREATE TABLE IF NOT EXISTS channel_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- User can only archive a channel once
  UNIQUE(channel_id, user_id)
);

CREATE INDEX idx_channel_archives_user ON channel_archives(user_id);
CREATE INDEX idx_channel_archives_channel ON channel_archives(channel_id);

DO $$ BEGIN RAISE NOTICE '✓ Channel archives table created'; END $$;

-- ============================================================================
-- STEP 7: Create helper function to get or create DM channel
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_dm_channel(
  p_company_id UUID,
  p_user1_id UUID,
  p_user2_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_channel_id UUID;
  v_user_min UUID;
  v_user_max UUID;
BEGIN
  -- Order users deterministically to prevent duplicate DM channels
  IF p_user1_id < p_user2_id THEN
    v_user_min := p_user1_id;
    v_user_max := p_user2_id;
  ELSE
    v_user_min := p_user2_id;
    v_user_max := p_user1_id;
  END IF;

  -- Try to find existing DM channel between these two users
  SELECT cm1.channel_id INTO v_channel_id
  FROM channel_members cm1
  INNER JOIN channel_members cm2 ON cm1.channel_id = cm2.channel_id
  INNER JOIN channels c ON c.id = cm1.channel_id
  WHERE c.channel_type = 'dm'
    AND c.company_id = p_company_id
    AND cm1.user_id = v_user_min
    AND cm2.user_id = v_user_max
    AND cm1.is_active = true
    AND cm2.is_active = true
  LIMIT 1;

  -- If not found, create new DM channel
  IF v_channel_id IS NULL THEN
    INSERT INTO channels (company_id, channel_type, created_by)
    VALUES (p_company_id, 'dm', v_user_min)
    RETURNING id INTO v_channel_id;

    -- Add both users as members
    INSERT INTO channel_members (channel_id, user_id, added_by)
    VALUES
      (v_channel_id, v_user_min, v_user_min),
      (v_channel_id, v_user_max, v_user_min);
  END IF;

  RETURN v_channel_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '✓ get_or_create_dm_channel function created'; END $$;

-- ============================================================================
-- STEP 8: Create trigger to update channel updated_at on new message
-- ============================================================================

CREATE OR REPLACE FUNCTION update_channel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE channels SET updated_at = now() WHERE id = NEW.channel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_channel_on_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_channel_updated_at();

DO $$ BEGIN RAISE NOTICE '✓ Triggers created'; END $$;

-- ============================================================================
-- STEP 9: Enable Row Level Security
-- ============================================================================

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_archives ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN RAISE NOTICE '✓ RLS enabled on all tables'; END $$;

-- ============================================================================
-- STEP 10: Create RLS policies for channels
-- ============================================================================

-- Super admins see all channels
CREATE POLICY "Super admins see all channels"
ON channels FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Users see channels in their company where they're active members (not archived)
CREATE POLICY "Users see their channels"
ON channels FOR SELECT
TO authenticated
USING (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = channels.id
      AND user_id = auth.uid()
      AND is_active = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM channel_archives
    WHERE channel_id = channels.id AND user_id = auth.uid()
  )
);

-- Users can create channels in their company
CREATE POLICY "Users can create channels"
ON channels FOR INSERT
TO authenticated
WITH CHECK (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  AND created_by = auth.uid()
);

-- Only creator and company admins can update group channels
CREATE POLICY "Admins and creators can update channels"
ON channels FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
      AND company_id = channels.company_id
      AND role IN ('company_admin', 'super_admin')
  )
);

-- Super admins can delete any channel
CREATE POLICY "Super admins can delete channels"
ON channels FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

DO $$ BEGIN RAISE NOTICE '✓ Channels RLS policies created'; END $$;

-- ============================================================================
-- STEP 11: Create RLS policies for channel_members
-- ============================================================================

-- Super admins see all memberships
CREATE POLICY "Super admins see all memberships"
ON channel_members FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Users see memberships for channels they're in
CREATE POLICY "Users see channel memberships"
ON channel_members FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM channel_members cm
    WHERE cm.channel_id = channel_members.channel_id
      AND cm.user_id = auth.uid()
      AND cm.is_active = true
  )
);

-- Group creators and company admins can add members
CREATE POLICY "Admins can add members"
ON channel_members FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM channels c
    INNER JOIN user_profiles up ON up.id = auth.uid()
    WHERE c.id = channel_members.channel_id
      AND c.company_id = up.company_id
      AND (
        c.created_by = auth.uid()
        OR up.role IN ('company_admin', 'super_admin')
      )
  )
);

-- Users can update their own membership (last_read_at)
-- Admins can update others (for kicking)
CREATE POLICY "Users can update memberships"
ON channel_members FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM channels c
    INNER JOIN user_profiles up ON up.id = auth.uid()
    WHERE c.id = channel_members.channel_id
      AND up.role IN ('company_admin', 'super_admin')
      AND up.company_id = c.company_id
  )
);

DO $$ BEGIN RAISE NOTICE '✓ Channel members RLS policies created'; END $$;

-- ============================================================================
-- STEP 12: Create RLS policies for chat_messages
-- ============================================================================

-- Super admins see all messages
CREATE POLICY "Super admins see all messages"
ON chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Users see messages in channels they're active members of
CREATE POLICY "Users see channel messages"
ON chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = chat_messages.channel_id
      AND user_id = auth.uid()
      AND is_active = true
  )
);

-- Users can send messages to channels they're in
CREATE POLICY "Users can send messages"
ON chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = chat_messages.channel_id
      AND user_id = auth.uid()
      AND is_active = true
  )
);

-- Messages cannot be updated or deleted per requirements

DO $$ BEGIN RAISE NOTICE '✓ Chat messages RLS policies created'; END $$;

-- ============================================================================
-- STEP 13: Create RLS policies for message_reactions
-- ============================================================================

-- Super admins see all reactions
CREATE POLICY "Super admins see all reactions"
ON message_reactions FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Users see reactions on messages they can see
CREATE POLICY "Users see reactions"
ON message_reactions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chat_messages m
    INNER JOIN channel_members cm ON cm.channel_id = m.channel_id
    WHERE m.id = message_reactions.message_id
      AND cm.user_id = auth.uid()
      AND cm.is_active = true
  )
);

-- Users can add reactions to messages they can see
CREATE POLICY "Users can add reactions"
ON message_reactions FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM chat_messages m
    INNER JOIN channel_members cm ON cm.channel_id = m.channel_id
    WHERE m.id = message_reactions.message_id
      AND cm.user_id = auth.uid()
      AND cm.is_active = true
  )
);

-- Users can remove their own reactions
CREATE POLICY "Users can remove own reactions"
ON message_reactions FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DO $$ BEGIN RAISE NOTICE '✓ Message reactions RLS policies created'; END $$;

-- ============================================================================
-- STEP 14: Create RLS policies for channel_archives
-- ============================================================================

-- Users can manage their own archives
CREATE POLICY "Users can manage own archives"
ON channel_archives FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DO $$ BEGIN RAISE NOTICE '✓ Channel archives RLS policies created'; END $$;

-- ============================================================================
-- STEP 15: Create storage bucket for channel pictures
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('channel-pictures', 'channel-pictures', true)
ON CONFLICT (id) DO NOTHING;

-- Channel creators can upload pictures
CREATE POLICY "Channel creators can upload pictures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'channel-pictures'
  AND EXISTS (
    SELECT 1 FROM channels
    WHERE id::text = (storage.foldername(name))[1]
      AND created_by = auth.uid()
  )
);

-- Public can view channel pictures
CREATE POLICY "Channel pictures are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'channel-pictures');

DO $$ BEGIN RAISE NOTICE '✓ Storage bucket and policies created'; END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

DO $$ BEGIN RAISE NOTICE '✅ Chat system migration completed successfully!'; END $$;

COMMIT;

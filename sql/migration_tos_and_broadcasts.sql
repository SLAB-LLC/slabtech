-- =============================================================================
-- TOS acceptance + rich-content broadcasts
-- =============================================================================
-- Adds:
--   1. user_profiles.tos_accepted_at, tos_version_accepted (legal record)
--   2. broadcasts table (rich content for push notifications)
--   3. notification-media storage bucket + policies
--   4. notification_log.broadcast_id reference (link push to its broadcast row)
-- =============================================================================

-- ─── 1. TOS acceptance columns on user_profiles ──────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tos_version_accepted TEXT;

CREATE INDEX IF NOT EXISTS idx_user_profiles_tos_accepted
  ON user_profiles(tos_accepted_at)
  WHERE tos_accepted_at IS NOT NULL;

-- ─── 2. Broadcasts: rich-media records for push notifications ────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'updates',
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'gif') OR media_type IS NULL),
  thumbnail_url TEXT,
  target_type TEXT NOT NULL DEFAULT 'all',
  target_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at
  ON broadcasts(created_at DESC);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read broadcasts (so the mobile app can fetch one
-- when the user taps a push notification). Sensitive targeting is enforced
-- at send-time, not at read-time.
CREATE POLICY "Authenticated users read broadcasts"
  ON broadcasts FOR SELECT TO authenticated
  USING (true);

-- Only super admins can create/update/delete broadcasts
CREATE POLICY "Super admins manage broadcasts"
  ON broadcasts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ─── 3. Link push log → broadcast (optional) ─────────────────────────────────
ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_log_broadcast
  ON notification_log(broadcast_id) WHERE broadcast_id IS NOT NULL;

-- ─── 4. Storage bucket for broadcast media ───────────────────────────────────
-- Run this once in the Supabase dashboard or via the Supabase CLI:
--   bucket name: notification-media
--   public:      true (so push notification recipients can fetch without auth)
--
-- Using INSERT INTO storage.buckets so this migration is self-contained:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'notification-media',
  'notification-media',
  true,
  52428800, -- 50 MB
  ARRAY['image/png','image/jpeg','image/gif','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/mp4','audio/wav']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read media (since notifications are pushed to many devices)
CREATE POLICY "Public read notification media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'notification-media');

-- Only super admins can upload
CREATE POLICY "Super admins upload notification media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'notification-media'
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "Super admins delete notification media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'notification-media'
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

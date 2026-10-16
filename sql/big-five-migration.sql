-- Big Five Members table
CREATE TABLE IF NOT EXISTS big_five_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  profile_picture_url TEXT,
  background_picture_url TEXT,
  instagram_handle TEXT,
  best_day INTEGER DEFAULT 0,
  best_summer INTEGER DEFAULT 0,
  best_week INTEGER DEFAULT 0,
  retention_percentage NUMERIC(5,2) DEFAULT 0,
  bio TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Awards for Big Five members
CREATE TABLE IF NOT EXISTS big_five_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES big_five_members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Links Big Five members to their salesperson_name values in transcripts
CREATE TABLE IF NOT EXISTS big_five_transcript_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES big_five_members(id) ON DELETE CASCADE,
  salesperson_name TEXT NOT NULL,
  UNIQUE(member_id, salesperson_name)
);

-- User subscriptions to Big Five members
CREATE TABLE IF NOT EXISTS big_five_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID REFERENCES big_five_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, member_id)
);

-- Conversation upvotes
CREATE TABLE IF NOT EXISTS conversation_upvotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

-- Course reservations (Secrets page)
CREATE TABLE IF NOT EXISTS course_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES big_five_members(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add note column to user_favorites if not exists
ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS note TEXT;

-- RLS
ALTER TABLE big_five_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE big_five_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE big_five_transcript_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE big_five_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_upvotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_reservations ENABLE ROW LEVEL SECURITY;

-- big_five_members: anyone authenticated can read, only super_admin can write
CREATE POLICY "Anyone can view active big five members" ON big_five_members
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin can manage big five members" ON big_five_members
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- big_five_awards: same
CREATE POLICY "Anyone can view awards" ON big_five_awards
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin can manage awards" ON big_five_awards
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- big_five_transcript_links: same
CREATE POLICY "Anyone can view transcript links" ON big_five_transcript_links
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin can manage transcript links" ON big_five_transcript_links
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- big_five_subscriptions: users manage their own
CREATE POLICY "Users can view and manage their subscriptions" ON big_five_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- conversation_upvotes: users manage their own
CREATE POLICY "Users can manage their upvotes" ON conversation_upvotes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Anyone can read upvote counts" ON conversation_upvotes
  FOR SELECT TO authenticated USING (true);

-- course_reservations: users can insert, super_admin can read all
CREATE POLICY "Users can create reservations" ON course_reservations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Super admin can view all reservations" ON course_reservations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- Storage bucket for big-five-pictures (run in Supabase dashboard if not exists)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('big-five-pictures', 'big-five-pictures', true)
-- ON CONFLICT DO NOTHING;

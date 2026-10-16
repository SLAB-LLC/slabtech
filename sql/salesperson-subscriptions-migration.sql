-- Create salesperson_subscriptions table
-- Allows users to "subscribe" to a salesperson and automatically access all their audio files
-- When a subscribed salesperson uploads new audio, all subscribers can immediately access it

CREATE TABLE IF NOT EXISTS salesperson_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  salesperson_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_user_salesperson UNIQUE(user_id, salesperson_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON salesperson_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_salesperson ON salesperson_subscriptions(salesperson_name);

-- RLS Policies
ALTER TABLE salesperson_subscriptions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all subscriptions
CREATE POLICY "Admins can manage all subscriptions"
  ON salesperson_subscriptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Users can view their own subscriptions
CREATE POLICY "Users can view own subscriptions"
  ON salesperson_subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE salesperson_subscriptions IS 'User subscriptions to salespeople for automatic access to all their audio files';
COMMENT ON COLUMN salesperson_subscriptions.user_id IS 'The user who is subscribed';
COMMENT ON COLUMN salesperson_subscriptions.salesperson_name IS 'The salesperson they are subscribed to (e.g., "Rylan", "Cade", "Koni")';

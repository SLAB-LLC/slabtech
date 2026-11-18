-- Lock streak numbers, 2026-11-18 (Duncan: reps can't edit their own streaks; super admins can)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Before: any rep could write their own user_streaks row (current/longest streak), their own
-- daily_usage_stats (active minutes, which also count toward streaks), insert streak days for any
-- date (including future days) and insert heartbeats with any timestamp.
-- After: streaks are only changed by the database itself when a rep actually uses SLAB.
-- Reps can still log today's activity (the website and app do that); super admins can edit anything.

BEGIN;

-- The streak triggers now run with database rights, so they keep working without reps having write access
ALTER FUNCTION public.update_user_streak() SECURITY DEFINER;
ALTER FUNCTION public.update_user_streak() SET search_path = public;
ALTER FUNCTION public.trigger_sync_streaks_on_daily_stats() SECURITY DEFINER;
ALTER FUNCTION public.trigger_sync_streaks_on_daily_stats() SET search_path = public;

-- user_streaks: read only for reps
DROP POLICY IF EXISTS "Users can update own streaks" ON public.user_streaks;
DROP POLICY IF EXISTS "Users can insert own streak data" ON public.user_streaks;
DROP POLICY IF EXISTS "Users can update own streak data" ON public.user_streaks;
DROP POLICY IF EXISTS "SLAB admins manage streaks" ON public.user_streaks;
CREATE POLICY "SLAB admins manage streaks" ON public.user_streaks
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- daily_usage_stats: read only for reps (update_daily_usage_stats() fills it from real heartbeats)
DROP POLICY IF EXISTS "Users can manage own stats" ON public.daily_usage_stats;
DROP POLICY IF EXISTS "SLAB admins manage usage stats" ON public.daily_usage_stats;
CREATE POLICY "SLAB admins manage usage stats" ON public.daily_usage_stats
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- streak_activities: reps may only log a day around today (time zones allow one day either side),
-- never edit or delete past days
DROP POLICY IF EXISTS "Users can manage own streak activities" ON public.streak_activities;
DROP POLICY IF EXISTS "Users can insert own activities" ON public.streak_activities;
CREATE POLICY "Users can insert own activities" ON public.streak_activities
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND activity_date BETWEEN current_date - 1 AND current_date + 1);
DROP POLICY IF EXISTS "SLAB admins manage streak activities" ON public.streak_activities;
CREATE POLICY "SLAB admins manage streak activities" ON public.streak_activities
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- Heartbeats (which become active minutes) always carry the real time
CREATE OR REPLACE FUNCTION public.stamp_heartbeat_time()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.current_user_role() IS DISTINCT FROM 'super_admin' THEN
    NEW.heartbeat_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_heartbeat_time() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stamp_heartbeat_time ON public.activity_heartbeats;
CREATE TRIGGER stamp_heartbeat_time
  BEFORE INSERT ON public.activity_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.stamp_heartbeat_time();

COMMIT;

-- ============================================================================
-- Leaderboard rank-drop alerts (Duncan, 2026-11-24)
-- ============================================================================
-- A rep hears about it when someone knocks them down inside their company's
-- top 3 (#1 -> #2, #2 -> #3) or off the podium entirely. Nothing fires for
-- moves below #3, for climbing, or when the rep's own XP drops (an XP trade
-- for a slot spin).
--
-- The board is the app's company leaderboard: active reps of the company
-- ranked by all-time XP (xp_events). A tie goes to whoever got there first.
--
-- How it works
--   * leaderboard_podium keeps each company's current top 3.
--   * A trigger on xp_events recomputes the company's top 3 after every grant,
--     and for each rep who slid writes a rank_alerts row with the push copy.
--   * The app asks slabtech POST /api/app/rank-alerts right after it grants XP;
--     that claims pending alerts (claim_rank_alert_pushes) and sends them
--     through Expo. Alerts that weren't pushed within 30 minutes expire.
--   * In the app, my_rank_alerts() hands the rep the alerts they haven't seen
--     yet (a banner on open) and marks them seen.
--
-- Anti-spam (a rep can be passed back and forth all evening)
--   * At most one push per rep every 2 hours, and 4 a day. Drops inside
--     that window are still recorded and show in the app, just no push.
--   * A newer drop replaces an older one that hasn't been pushed yet.
--   * notification_preferences.rank_alerts (default on) turns the pushes off.
--
-- Requires xp-engine-migration.sql. Safe to run more than once.
-- ============================================================================

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS rank_alerts BOOLEAN NOT NULL DEFAULT true;

-- ---- each company's top 3, as of the last XP grant ----
CREATE TABLE IF NOT EXISTS leaderboard_podium (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  top_ids UUID[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE leaderboard_podium ENABLE ROW LEVEL SECURITY;
-- No policies: only the functions below read or write it

-- ---- the alerts ----
CREATE TABLE IF NOT EXISTS rank_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  old_rank INT NOT NULL,
  -- NULL: out of the top 3
  new_rank INT,
  passed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  -- pending: waiting for the push; sent; skipped: cooldown or replaced by a
  -- newer drop; muted: the rep turned rank alerts off; expired: never claimed
  push_state TEXT NOT NULL DEFAULT 'pending' CHECK (push_state IN ('pending', 'sent', 'skipped', 'muted', 'expired')),
  pushed_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rank_alerts_user ON rank_alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_alerts_pending ON rank_alerts(created_at) WHERE push_state = 'pending';

ALTER TABLE rank_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reps read their own rank alerts" ON rank_alerts;
CREATE POLICY "Reps read their own rank alerts"
ON rank_alerts FOR SELECT
TO authenticated
USING (user_id = auth.uid());
-- No write policies: the trigger and functions below write

-- ---- a company's top 3 right now ----
CREATE OR REPLACE FUNCTION company_podium(p_company_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(user_id ORDER BY total DESC, reached ASC), '{}')
  FROM (
    SELECT up.id AS user_id, SUM(x.amount) AS total, MAX(x.created_at) AS reached
    FROM user_profiles up
    JOIN xp_events x ON x.user_id = up.id
    WHERE up.company_id = p_company_id AND up.is_active = true
    GROUP BY up.id
    HAVING SUM(x.amount) > 0
    ORDER BY total DESC, reached ASC
    LIMIT 3
  ) t;
$$;
REVOKE ALL ON FUNCTION company_podium(UUID) FROM PUBLIC, anon, authenticated;

-- ---- the copy for one drop ----
CREATE OR REPLACE FUNCTION rank_alert_copy(p_old INT, p_new INT, p_passer TEXT, p_company TEXT, OUT title TEXT, OUT body TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  who TEXT := COALESCE(NULLIF(trim(p_passer), ''), 'Someone');
  board TEXT := CASE WHEN COALESCE(trim(p_company), '') = '' THEN 'the leaderboard' ELSE 'the ' || trim(p_company) || ' leaderboard' END;
BEGIN
  IF p_old = 1 THEN
    title := 'Your crown just got snatched 👑';
    body := who || ' took #1 on ' || board || CASE WHEN p_new IS NULL THEN ' and you slid out of the top 3.' ELSE '. You''re #' || p_new || ' now.' END || ' Go take it back.';
  ELSIF p_new IS NULL THEN
    title := 'You got knocked off the podium';
    body := who || ' just bumped you out of the top 3 on ' || board || '. A couple lessons gets you back.';
  ELSE
    title := 'You slid to #' || p_new;
    body := who || ' just passed you on ' || board || '. Stack some XP and take #' || p_old || ' back.';
  END IF;
END;
$$;

-- ---- after every XP grant: who slid? ----
CREATE OR REPLACE FUNCTION rank_alerts_on_xp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_company_name TEXT;
  v_old UUID[];
  v_new UUID[];
  v_uid UUID;
  v_old_rank INT;
  v_new_rank INT;
  v_actor_rank INT;
  v_passer UUID;
  v_passer_name TEXT;
  v_state TEXT;
  v_copy RECORD;
BEGIN
  SELECT company_id INTO v_company FROM user_profiles WHERE id = NEW.user_id;
  IF v_company IS NULL THEN RETURN NEW; END IF;

  -- One grant at a time per company, so two reps passing at once don't race
  PERFORM pg_advisory_xact_lock(hashtext('podium:' || v_company::text));

  SELECT top_ids INTO v_old FROM leaderboard_podium WHERE company_id = v_company;
  v_new := company_podium(v_company);

  IF v_old IS NULL THEN
    -- First grant we've seen for this company: remember the podium, no alerts
    INSERT INTO leaderboard_podium (company_id, top_ids) VALUES (v_company, v_new)
    ON CONFLICT (company_id) DO UPDATE SET top_ids = EXCLUDED.top_ids, updated_at = now();
    RETURN NEW;
  END IF;
  IF v_old = v_new THEN RETURN NEW; END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = v_company;
  v_actor_rank := array_position(v_new, NEW.user_id);

  FOR i IN 1 .. COALESCE(array_length(v_old, 1), 0) LOOP
    v_uid := v_old[i];
    v_old_rank := i;
    v_new_rank := array_position(v_new, v_uid);
    -- Held or climbed, or it was their own XP going down (a trade)
    CONTINUE WHEN v_new_rank IS NOT NULL AND v_new_rank <= v_old_rank;
    CONTINUE WHEN v_uid = NEW.user_id;
    -- Gone from the company or switched off: nothing to tell them
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = v_uid AND company_id = v_company AND is_active = true);

    -- Who passed them: the rep who just earned XP, if they're now ahead
    v_passer := CASE WHEN v_actor_rank IS NOT NULL AND v_actor_rank < COALESCE(v_new_rank, 4) THEN NEW.user_id END;
    v_passer_name := NULL;
    IF v_passer IS NOT NULL THEN
      SELECT split_part(trim(COALESCE(NULLIF(display_name, ''), split_part(email, '@', 1))), ' ', 1)
        INTO v_passer_name FROM user_profiles WHERE id = v_passer;
    END IF;
    SELECT * INTO v_copy FROM rank_alert_copy(v_old_rank, v_new_rank, v_passer_name, v_company_name);

    -- A newer drop replaces one that hasn't gone out yet
    UPDATE rank_alerts SET push_state = 'skipped' WHERE user_id = v_uid AND push_state = 'pending';

    IF EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = v_uid AND rank_alerts = false) THEN
      v_state := 'muted';
    ELSIF EXISTS (SELECT 1 FROM rank_alerts WHERE user_id = v_uid AND push_state = 'sent' AND pushed_at > now() - interval '2 hours')
       OR (SELECT count(*) FROM rank_alerts WHERE user_id = v_uid AND push_state = 'sent' AND pushed_at > now() - interval '24 hours') >= 4 THEN
      v_state := 'skipped';
    ELSE
      v_state := 'pending';
    END IF;

    INSERT INTO rank_alerts (user_id, company_id, old_rank, new_rank, passed_by, title, body, push_state)
    VALUES (v_uid, v_company, v_old_rank, v_new_rank, v_passer, v_copy.title, v_copy.body, v_state);
  END LOOP;

  UPDATE leaderboard_podium SET top_ids = v_new, updated_at = now() WHERE company_id = v_company;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- An alert must never cost a rep their XP
  RAISE WARNING 'rank_alerts_on_xp: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION rank_alerts_on_xp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rank_alerts_on_xp ON xp_events;
CREATE TRIGGER trg_rank_alerts_on_xp
AFTER INSERT ON xp_events
FOR EACH ROW EXECUTE FUNCTION rank_alerts_on_xp();

-- ---- the push sender (slabtech /api/app/rank-alerts, service role only) ----
-- Claims every pending alert so two callers never send the same one twice
CREATE OR REPLACE FUNCTION claim_rank_alert_pushes(p_limit INT DEFAULT 100)
RETURNS TABLE (id UUID, user_id UUID, company_id UUID, old_rank INT, new_rank INT, title TEXT, body TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE rank_alerts r SET push_state = 'expired'
  WHERE r.push_state = 'pending' AND r.created_at < now() - interval '30 minutes';

  RETURN QUERY
  UPDATE rank_alerts r SET push_state = 'sent', pushed_at = now()
  WHERE r.id IN (
    SELECT p.id FROM rank_alerts p
    WHERE p.push_state = 'pending'
    ORDER BY p.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING r.id, r.user_id, r.company_id, r.old_rank, r.new_rank, r.title, r.body;
END;
$$;
REVOKE ALL ON FUNCTION claim_rank_alert_pushes(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_rank_alert_pushes(INT) TO service_role;

-- ---- the app: drops the rep hasn't seen yet (last 3 days), newest first; marks them seen ----
CREATE OR REPLACE FUNCTION my_rank_alerts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'oldRank', r.old_rank, 'newRank', r.new_rank,
      'title', r.title, 'body', r.body, 'at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT * FROM rank_alerts
    WHERE user_id = auth.uid() AND seen_at IS NULL AND created_at > now() - interval '3 days'
    ORDER BY created_at DESC
    LIMIT 10
  ) r;

  UPDATE rank_alerts SET seen_at = now() WHERE user_id = auth.uid() AND seen_at IS NULL;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION my_rank_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_rank_alerts() TO authenticated;

-- ---- start from today's podiums, so turning this on doesn't fire a burst ----
INSERT INTO leaderboard_podium (company_id, top_ids)
SELECT c.id, company_podium(c.id) FROM companies c
ON CONFLICT (company_id) DO UPDATE SET top_ids = EXCLUDED.top_ids, updated_at = now();

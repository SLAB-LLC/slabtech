-- ============================================================================
-- XP engine: an append-only ledger of XP grants, written only by grant_xp()
-- ============================================================================
-- The app never inserts XP itself. It calls grant_xp(reason, source_id, tz)
-- and the database decides the amount from the company's app config
-- (company_app_config.features.xp, see company-app-config-migration.sql),
-- applies the streak multiplier and power hour, enforces daily caps and
-- one-time grants, and records the event.
--
-- Reasons and their config keys (defaults in brackets):
--   lesson_complete  xp.lesson [15]            once per lesson (source_id = video id)
--   book_pass        xp.book [50]              once per book
--   boss_win         xp.bossFirstWin [40]      first win per boss; later wins pay
--                    xp.bossRematch [10]       once per boss per day
--   vault_minute     xp.vaultPerMinute [5]     capped at xp.vaultDailyCap [300] a day
--   library_open     xp.libraryFirstOpen [5]   once per library item
--   coach_ask        xp.askCoach [8]           capped at xp.askCoachDailyCap [40] a day
--
-- Multipliers: streakTiers [{days, mult}] (default 1x, 1.25x at 5 days,
-- 1.5x at 15, 2x at 30) and powerHour {enabled, startHour, multiplier}
-- (default on, 20:00-21:00 in the rep's time zone, 2x).
--
-- Requires company-app-config-migration.sql. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  source_id TEXT,
  base_amount INT NOT NULL,
  multiplier NUMERIC(5,2) NOT NULL DEFAULT 1,
  amount INT NOT NULL,
  local_date DATE NOT NULL,
  power_hour BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_company ON xp_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_user_day ON xp_events(user_id, reason, local_date);
-- One-time grants (a lesson, a book, a boss's first win) can't be paid twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_xp_events_source
  ON xp_events(user_id, reason, source_id) WHERE source_id IS NOT NULL;

ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;

-- Reps see their own XP and their company's (leaderboards). No insert,
-- update or delete policies: only grant_xp() writes here.
DROP POLICY IF EXISTS "Read own and company XP" ON xp_events;
CREATE POLICY "Read own and company XP"
ON xp_events FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Totals per rep: all time, this month, this week (UTC boundaries)
CREATE OR REPLACE VIEW user_xp_totals
WITH (security_invoker = true) AS
SELECT
  user_id,
  (array_agg(company_id ORDER BY created_at DESC))[1] AS company_id,
  COALESCE(SUM(amount), 0)::INT AS total_xp,
  COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::INT AS month_xp,
  COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('week', now())), 0)::INT AS week_xp
FROM xp_events
GROUP BY user_id;

CREATE OR REPLACE FUNCTION grant_xp(
  p_reason TEXT,
  p_source_id TEXT DEFAULT NULL,
  p_tz TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company UUID;
  v_features JSONB;
  v_xp JSONB;
  v_tz TEXT := 'UTC';
  v_local TIMESTAMP;
  v_today DATE;
  v_reason TEXT := p_reason;
  v_source TEXT := NULLIF(p_source_id, '');
  v_base INT;
  v_cap INT;
  v_used INT;
  v_streak INT := 0;
  v_last DATE;
  v_mult NUMERIC := 1;
  v_tier JSONB;
  v_power BOOLEAN := false;
  v_ph JSONB;
  v_amount INT;
  v_inserted INT;
  v_total INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT company_id INTO v_company FROM user_profiles WHERE id = v_uid;

  SELECT COALESCE(features, '{}'::jsonb) INTO v_features
  FROM company_app_config WHERE company_id = v_company;
  v_features := COALESCE(v_features, '{}'::jsonb);
  v_xp := COALESCE(v_features->'xp', '{}'::jsonb);

  IF EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN
    v_tz := p_tz;
  END IF;
  v_local := now() AT TIME ZONE v_tz;
  v_today := v_local::date;

  -- Base amount, one-time rules and daily caps per reason
  CASE p_reason
    WHEN 'lesson_complete' THEN
      v_base := COALESCE((v_xp->>'lesson')::int, 15);
    WHEN 'book_pass' THEN
      v_base := COALESCE((v_xp->>'book')::int, 50);
    WHEN 'library_open' THEN
      v_base := COALESCE((v_xp->>'libraryFirstOpen')::int, 5);
    WHEN 'boss_win' THEN
      IF EXISTS (SELECT 1 FROM xp_events WHERE user_id = v_uid AND reason = 'boss_win' AND source_id = v_source) THEN
        v_reason := 'boss_rematch';
        v_source := v_source || ':' || v_today::text;
        v_base := COALESCE((v_xp->>'bossRematch')::int, 10);
      ELSE
        v_base := COALESCE((v_xp->>'bossFirstWin')::int, 40);
      END IF;
    WHEN 'vault_minute' THEN
      v_base := COALESCE((v_xp->>'vaultPerMinute')::int, 5);
      v_cap := COALESCE((v_xp->>'vaultDailyCap')::int, 300);
      v_source := NULL;
    WHEN 'coach_ask' THEN
      v_base := COALESCE((v_xp->>'askCoach')::int, 8);
      v_cap := COALESCE((v_xp->>'askCoachDailyCap')::int, 40);
      v_source := NULL;
    ELSE
      RAISE EXCEPTION 'Unknown XP reason: %', p_reason;
  END CASE;

  IF v_reason IN ('lesson_complete', 'book_pass', 'library_open', 'boss_win') AND v_source IS NULL THEN
    RAISE EXCEPTION 'XP reason % needs a source id', p_reason;
  END IF;

  IF v_cap IS NOT NULL THEN
    SELECT COALESCE(SUM(base_amount), 0) INTO v_used
    FROM xp_events
    WHERE user_id = v_uid AND reason = v_reason AND local_date = v_today;
    v_base := LEAST(v_base, GREATEST(v_cap - v_used, 0));
  END IF;

  -- Streak multiplier (a streak whose last day is before yesterday is broken)
  SELECT current_streak, last_activity_date INTO v_streak, v_last
  FROM user_streaks WHERE user_id = v_uid;
  IF v_last IS NULL OR v_last < v_today - 1 THEN
    v_streak := 0;
  END IF;
  FOR v_tier IN
    SELECT value FROM jsonb_array_elements(COALESCE(
      v_features->'streakTiers',
      '[{"days":0,"mult":1},{"days":5,"mult":1.25},{"days":15,"mult":1.5},{"days":30,"mult":2}]'::jsonb
    ))
  LOOP
    IF COALESCE(v_streak, 0) >= (v_tier->>'days')::int THEN
      v_mult := GREATEST(v_mult, (v_tier->>'mult')::numeric);
    END IF;
  END LOOP;

  -- Power hour
  v_ph := COALESCE(v_features->'powerHour', '{}'::jsonb);
  IF COALESCE((v_ph->>'enabled')::boolean, true)
     AND EXTRACT(HOUR FROM v_local) = COALESCE((v_ph->>'startHour')::int, 20) THEN
    v_power := true;
    v_mult := v_mult * COALESCE((v_ph->>'multiplier')::numeric, 2);
  END IF;

  v_amount := ROUND(v_base * v_mult)::int;

  IF v_base > 0 THEN
    INSERT INTO xp_events (user_id, company_id, reason, source_id, base_amount, multiplier, amount, local_date, power_hour)
    VALUES (v_uid, v_company, v_reason, v_source, v_base, v_mult, v_amount, v_today, v_power)
    ON CONFLICT (user_id, reason, source_id) WHERE source_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  ELSE
    v_inserted := 0;
  END IF;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_total FROM xp_events WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'granted', v_inserted > 0,
    'reason', v_reason,
    'amount', CASE WHEN v_inserted > 0 THEN v_amount ELSE 0 END,
    'multiplier', v_mult,
    'powerHour', v_power,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION grant_xp(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION grant_xp(TEXT, TEXT, TEXT) TO authenticated;

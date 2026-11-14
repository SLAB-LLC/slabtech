-- Lesson XP 15 -> 30 for every company (Alston, 2026-11-13).
-- Run once in the Supabase SQL editor. It redefines grant_xp() with 30 as the default for a finished lesson
-- (same function as sql/xp-engine-migration.sql, only that default changed) and sets 30 on any company whose
-- app config overrides the lesson amount. XP already earned is unchanged; new lessons pay 30.

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
      v_base := COALESCE((v_xp->>'lesson')::int, 30);
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

-- Companies that set their own lesson amount get 30 too
UPDATE company_app_config
SET features = jsonb_set(features, '{xp,lesson}', '30'::jsonb)
WHERE features ? 'xp' AND features->'xp' ? 'lesson';

-- Check: true, and no company still overriding with something else
SELECT (SELECT prosrc LIKE '%''lesson'')::int, 30)%' FROM pg_proc WHERE proname = 'grant_xp' LIMIT 1) AS default_is_30,
  (SELECT count(*) FROM company_app_config WHERE features->'xp' ? 'lesson' AND features->'xp'->>'lesson' <> '30') AS other_overrides;

-- End of lesson-xp-30.sql

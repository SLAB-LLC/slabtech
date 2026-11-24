-- ============================================================================
-- SLAB Slots: an in-app slot machine reps spin for XP, boosts, slot-only
-- outfits, Zach Kornfeld pitch videos and real SLAB merch (Duncan, 2026-11-24)
-- ============================================================================
-- Spins are only earned, never bought:
--   * Free Spin Saturday: one spin every Saturday (rep's time zone)
--   * Milestones: a 5, 15 and 30 day streak, and each boss's first win
--   * Trading XP: 100 XP for a spin, up to 2 a week (both in slot_settings)
--
-- Odds (slot_settings.odds, percent): miss 31, XP 33, boost 20, outfit 10,
-- video 5, merch 1. The server rolls every spin; the app only animates it.
--
-- Prizes:
--   xp      +50, +100 or +150 XP (xp_events reason 'slot_xp')
--   boost   2x XP for 30 minutes (adds +1x on top of streak and power hour,
--           starts right away), streak shield (keeps a streak through one
--           missed day), lucky charm (next spin can't miss), bonus spin
--   outfit  slot-only gear the game page draws (tools/game/slots.js in
--           slab-mobile); a duplicate pays 100 XP (reason 'slot_dupe')
--   video   a Zach Kornfeld full pitch; until the videos are loaded each win
--           is a request SLAB fulfills by hand, like merch
--   merch   SLAB Snapback, Specimen Sticker Pack + Hat or The Sloodie.
--           Capped at slot_settings.merch_monthly_cap wins a month across
--           every company (1 for now); past the cap it pays an outfit instead
--
-- A company can turn the machine off with company_app_config.features
-- {"slots": {"enabled": false}}. It's on by default.
--
-- Also redefines grant_xp() (same as lesson-xp-30.sql plus the 2x boost) and
-- update_user_streak() (plus the streak shield).
--
-- Requires xp-engine-migration.sql. Safe to run more than once.
-- ============================================================================

-- ---- settings (one row) ----
CREATE TABLE IF NOT EXISTS slot_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  launched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  odds JSONB NOT NULL DEFAULT '{"miss":31,"xp":33,"boost":20,"outfit":10,"video":5,"merch":1}'::jsonb,
  merch_monthly_cap INT NOT NULL DEFAULT 1,
  xp_trade_cost INT NOT NULL DEFAULT 100,
  trades_per_week INT NOT NULL DEFAULT 2,
  boost_minutes INT NOT NULL DEFAULT 30,
  dupe_outfit_xp INT NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO slot_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE slot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone signed in reads slot settings" ON slot_settings;
CREATE POLICY "Anyone signed in reads slot settings" ON slot_settings FOR SELECT TO authenticated USING (true);

-- ---- spins in and out: + earned, - spent ----
CREATE TABLE IF NOT EXISTS slot_spin_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  delta INT NOT NULL,
  reason TEXT NOT NULL,          -- saturday, streak5, streak15, streak30, boss, trade, bonus, admin, spin
  source_id TEXT NOT NULL,       -- what makes the grant one-time (a date, a boss, a spin id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_spin_ledger ON slot_spin_ledger(user_id, reason, source_id);
CREATE INDEX IF NOT EXISTS idx_slot_spin_ledger_user ON slot_spin_ledger(user_id, created_at DESC);
ALTER TABLE slot_spin_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own spin ledger" ON slot_spin_ledger;
CREATE POLICY "Read own spin ledger" ON slot_spin_ledger FOR SELECT TO authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- ---- every spin and what it paid; video and merch wins are orders to fulfill ----
CREATE TABLE IF NOT EXISTS slot_spins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('miss', 'xp', 'boost', 'outfit', 'video', 'merch')),
  prize_key TEXT,
  prize_name TEXT,
  xp INT NOT NULL DEFAULT 0,
  dupe BOOLEAN NOT NULL DEFAULT false,
  charm BOOLEAN NOT NULL DEFAULT false,
  -- orders: requested -> shipped (or cancelled); null for prizes paid on the spot
  status TEXT CHECK (status IN ('requested', 'shipped', 'cancelled')),
  claim JSONB,                    -- merch: size, name, address, phone, note from the rep
  admin_note TEXT,
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slot_spins_user ON slot_spins(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slot_spins_orders ON slot_spins(status, created_at DESC) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slot_spins_merch ON slot_spins(created_at) WHERE outcome = 'merch';
ALTER TABLE slot_spins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own spins" ON slot_spins;
CREATE POLICY "Read own spins" ON slot_spins FOR SELECT TO authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- ---- boosts won: xp2x runs from starts_at to ends_at; shield and charm wait until used ----
CREATE TABLE IF NOT EXISTS slot_boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('xp2x', 'shield', 'charm')),
  spin_id UUID REFERENCES slot_spins(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slot_boosts_user ON slot_boosts(user_id, kind, ends_at);
ALTER TABLE slot_boosts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own boosts" ON slot_boosts;
CREATE POLICY "Read own boosts" ON slot_boosts FOR SELECT TO authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- ============================================================================
-- Helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION slot_valid_tz(p_tz TEXT)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'America/Denver' END;
$$;

CREATE OR REPLACE FUNCTION slot_enabled(p_company UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT (features->'slots'->>'enabled')::boolean FROM company_app_config WHERE company_id = p_company), true);
$$;

CREATE OR REPLACE FUNCTION slot_balance(p_user UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(delta), 0)::int FROM slot_spin_ledger WHERE user_id = p_user;
$$;

-- weighted pick from {"key": weight, ...}
CREATE OR REPLACE FUNCTION slot_pick(p_weights JSONB)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_total NUMERIC := 0; v_r NUMERIC; v_k TEXT; v_w NUMERIC;
BEGIN
  SELECT COALESCE(SUM(value::numeric), 0) INTO v_total FROM jsonb_each_text(p_weights) WHERE value::numeric > 0;
  IF v_total <= 0 THEN RETURN NULL; END IF;
  v_r := random() * v_total;
  FOR v_k, v_w IN SELECT key, value::numeric FROM jsonb_each_text(p_weights) WHERE value::numeric > 0 ORDER BY key LOOP
    v_r := v_r - v_w;
    IF v_r < 0 THEN RETURN v_k; END IF;
  END LOOP;
  RETURN v_k;
END;
$$;

-- The prize catalog. Outfit keys match tools/game/slots.js in slab-mobile.
CREATE OR REPLACE FUNCTION slot_catalog()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "xp":     {"50": 40, "100": 40, "150": 20},
    "boost":  {"xp2x": 40, "shield": 25, "charm": 20, "bonus": 15},
    "outfit": {"hawaiian": 1, "suit": 1, "labcoat": 1, "hazmat": 1, "trout": 1, "neon": 1, "visor": 1, "rainbow": 1},
    "merch":  {"snapback": 45, "stickers": 40, "sloodie": 15},
    "names": {
      "xp2x": "Double XP, 30 minutes", "shield": "Streak shield", "charm": "Lucky charm", "bonus": "Bonus spin",
      "hawaiian": "Jackpot Hawaiian Shirt", "suit": "Black Tux", "labcoat": "Lab Coat + Goggles",
      "hazmat": "Hazmat Suit", "trout": "Trout Bucket Hat", "neon": "Neon Beaker Chain", "visor": "777 Visor", "rainbow": "Rainbow Glitter Fit",
      "zach": "Zach Kornfeld full pitch",
      "snapback": "SLAB Snapback", "stickers": "Specimen Sticker Pack + Hat", "sloodie": "The Sloodie"
    }
  }'::jsonb;
$$;

-- Grants the spins a rep has earned and not been given yet. Returns the new grants.
CREATE OR REPLACE FUNCTION slot_grant_earned(p_user UUID, p_company UUID, p_today DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_launch DATE;
  v_streak INT; v_last DATE; v_start DATE;
  v_n INT;
  v_out JSONB := '[]'::jsonb;
  v_row RECORD;
BEGIN
  SELECT (launched_at AT TIME ZONE 'America/Denver')::date INTO v_launch FROM slot_settings WHERE id = 1;

  -- Free Spin Saturday
  IF EXTRACT(ISODOW FROM p_today) = 6 THEN
    INSERT INTO slot_spin_ledger (user_id, company_id, delta, reason, source_id)
    VALUES (p_user, p_company, 1, 'saturday', p_today::text)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_out := v_out || jsonb_build_object('reason', 'saturday', 'label', 'Free Spin Saturday'); END IF;
  END IF;

  -- Streak milestones, once per streak run, for days reached since launch
  SELECT current_streak, last_activity_date INTO v_streak, v_last FROM user_streaks WHERE user_id = p_user;
  IF v_last IS NOT NULL AND v_last >= p_today - 1 AND COALESCE(v_streak, 0) > 0 THEN
    v_start := v_last - v_streak + 1;
    FOREACH v_n IN ARRAY ARRAY[5, 15, 30] LOOP
      IF v_streak >= v_n AND v_start + v_n - 1 >= v_launch THEN
        INSERT INTO slot_spin_ledger (user_id, company_id, delta, reason, source_id)
        VALUES (p_user, p_company, 1, 'streak' || v_n, v_start::text)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN v_out := v_out || jsonb_build_object('reason', 'streak' || v_n, 'label', v_n || '-day streak'); END IF;
      END IF;
    END LOOP;
  END IF;

  -- Each boss's first win since launch
  FOR v_row IN
    INSERT INTO slot_spin_ledger (user_id, company_id, delta, reason, source_id)
    SELECT p_user, p_company, 1, 'boss', e.source_id
    FROM xp_events e
    WHERE e.user_id = p_user AND e.reason = 'boss_win' AND e.source_id IS NOT NULL
      AND e.created_at >= (SELECT launched_at FROM slot_settings WHERE id = 1)
    ON CONFLICT DO NOTHING
    RETURNING source_id
  LOOP
    v_out := v_out || jsonb_build_object('reason', 'boss', 'label', 'Boss beaten');
  END LOOP;

  RETURN v_out;
END;
$$;

-- What the machine shows: spins, boosts, owned outfits, trades left, recent big wins
CREATE OR REPLACE FUNCTION slot_state(p_tz TEXT DEFAULT 'America/Denver')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company UUID;
  v_tz TEXT := slot_valid_tz(p_tz);
  v_today DATE := (now() AT TIME ZONE slot_valid_tz(p_tz))::date;
  v_set slot_settings;
  v_granted JSONB := '[]'::jsonb;
  v_enabled BOOLEAN;
  v_trades INT;
  v_feed JSONB;
  v_orders JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT company_id INTO v_company FROM user_profiles WHERE id = v_uid;
  SELECT * INTO v_set FROM slot_settings WHERE id = 1;
  v_enabled := slot_enabled(v_company);
  IF v_enabled THEN v_granted := slot_grant_earned(v_uid, v_company, v_today); END IF;

  SELECT COUNT(*) INTO v_trades FROM slot_spin_ledger
  WHERE user_id = v_uid AND reason = 'trade' AND source_id LIKE to_char(v_today, 'IYYY-IW') || ':%';

  SELECT COALESCE(jsonb_agg(f ORDER BY f->>'at' DESC), '[]'::jsonb) INTO v_feed FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 1), ''), 'A rep'),
      'outcome', s.outcome, 'prize', s.prize_name, 'at', s.created_at) AS f
    FROM slot_spins s LEFT JOIN user_profiles p ON p.id = s.user_id
    WHERE s.outcome IN ('outfit', 'video', 'merch') AND NOT s.dupe
      AND (s.company_id IS NOT DISTINCT FROM v_company)
    ORDER BY s.created_at DESC LIMIT 8
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'outcome', outcome, 'prize', prize_name, 'status', status,
    'claimed', claim IS NOT NULL, 'at', created_at) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_orders FROM slot_spins WHERE user_id = v_uid AND status IS NOT NULL;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'spins', slot_balance(v_uid),
    'granted', v_granted,
    'total', (SELECT COALESCE(SUM(amount), 0)::int FROM xp_events WHERE user_id = v_uid),
    'tradeCost', v_set.xp_trade_cost,
    'tradesLeft', GREATEST(v_set.trades_per_week - v_trades, 0),
    'tradesPerWeek', v_set.trades_per_week,
    'odds', v_set.odds,
    'boostEndsAt', (SELECT MAX(ends_at) FROM slot_boosts WHERE user_id = v_uid AND kind = 'xp2x' AND ends_at > now()),
    'charm', EXISTS (SELECT 1 FROM slot_boosts WHERE user_id = v_uid AND kind = 'charm' AND used_at IS NULL),
    'shield', EXISTS (SELECT 1 FROM slot_boosts WHERE user_id = v_uid AND kind = 'shield' AND used_at IS NULL),
    'owned', (SELECT COALESCE(jsonb_agg(DISTINCT prize_key), '[]'::jsonb) FROM slot_spins WHERE user_id = v_uid AND outcome = 'outfit'),
    'saturday', EXTRACT(ISODOW FROM v_today) = 6,
    'feed', v_feed,
    'orders', v_orders
  );
END;
$$;

-- One spin. The server rolls it and pays it.
CREATE OR REPLACE FUNCTION slot_spin(p_tz TEXT DEFAULT 'America/Denver')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company UUID;
  v_today DATE := (now() AT TIME ZONE slot_valid_tz(p_tz))::date;
  v_set slot_settings;
  v_cat JSONB := slot_catalog();
  v_odds JSONB;
  v_charm UUID;
  v_outcome TEXT;
  v_key TEXT;
  v_name TEXT;
  v_xp INT := 0;
  v_dupe BOOLEAN := false;
  v_status TEXT;
  v_spin UUID := gen_random_uuid();
  v_month_merch INT;
  v_ends TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT company_id INTO v_company FROM user_profiles WHERE id = v_uid;
  IF NOT slot_enabled(v_company) THEN RAISE EXCEPTION 'SLAB Slots is off for your company'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('slot:' || v_uid::text));
  PERFORM slot_grant_earned(v_uid, v_company, v_today);
  IF slot_balance(v_uid) < 1 THEN RAISE EXCEPTION 'No spins left'; END IF;
  SELECT * INTO v_set FROM slot_settings WHERE id = 1;

  -- a lucky charm takes miss off the table for this spin
  SELECT id INTO v_charm FROM slot_boosts WHERE user_id = v_uid AND kind = 'charm' AND used_at IS NULL ORDER BY created_at LIMIT 1;
  v_odds := v_set.odds;
  IF v_charm IS NOT NULL THEN
    v_odds := v_odds - 'miss';
    UPDATE slot_boosts SET used_at = now() WHERE id = v_charm;
  END IF;
  v_outcome := slot_pick(v_odds);

  -- real merch: capped across every company each month (Mountain time)
  IF v_outcome = 'merch' THEN
    PERFORM pg_advisory_xact_lock(hashtext('slot:merch'));
    SELECT COUNT(*) INTO v_month_merch FROM slot_spins
    WHERE outcome = 'merch' AND status IS DISTINCT FROM 'cancelled'
      AND created_at >= (date_trunc('month', now() AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver');
    IF v_month_merch >= v_set.merch_monthly_cap THEN v_outcome := 'outfit'; END IF;
  END IF;

  INSERT INTO slot_spin_ledger (user_id, company_id, delta, reason, source_id)
  VALUES (v_uid, v_company, -1, 'spin', v_spin::text);

  CASE v_outcome
    WHEN 'xp' THEN
      v_xp := slot_pick(v_cat->'xp')::int;
      v_key := v_xp::text; v_name := '+' || v_xp || ' XP';
    WHEN 'boost' THEN
      v_key := slot_pick(v_cat->'boost'); v_name := v_cat->'names'->>v_key;
    WHEN 'outfit' THEN
      v_key := slot_pick(v_cat->'outfit'); v_name := v_cat->'names'->>v_key;
      v_dupe := EXISTS (SELECT 1 FROM slot_spins WHERE user_id = v_uid AND outcome = 'outfit' AND prize_key = v_key);
      IF v_dupe THEN v_xp := v_set.dupe_outfit_xp; END IF;
    WHEN 'video' THEN
      v_key := 'zach'; v_name := v_cat->'names'->>'zach'; v_status := 'requested';
    WHEN 'merch' THEN
      v_key := slot_pick(v_cat->'merch'); v_name := v_cat->'names'->>v_key; v_status := 'requested';
    ELSE
      v_outcome := 'miss';
  END CASE;

  INSERT INTO slot_spins (id, user_id, company_id, outcome, prize_key, prize_name, xp, dupe, charm, status)
  VALUES (v_spin, v_uid, v_company, v_outcome, v_key, v_name, v_xp, v_dupe, v_charm IS NOT NULL, v_status);

  IF v_xp > 0 THEN
    INSERT INTO xp_events (user_id, company_id, reason, source_id, base_amount, multiplier, amount, local_date, power_hour)
    VALUES (v_uid, v_company, CASE WHEN v_dupe THEN 'slot_dupe' ELSE 'slot_xp' END, v_spin::text, v_xp, 1, v_xp, v_today, false);
  END IF;

  IF v_outcome = 'boost' THEN
    IF v_key = 'xp2x' THEN
      -- a second 2x while one runs adds its time to the end
      v_ends := GREATEST(now(), COALESCE((SELECT MAX(ends_at) FROM slot_boosts WHERE user_id = v_uid AND kind = 'xp2x'), now()))
                + make_interval(mins => v_set.boost_minutes);
      INSERT INTO slot_boosts (user_id, kind, spin_id, starts_at, ends_at) VALUES (v_uid, 'xp2x', v_spin, now(), v_ends);
    ELSIF v_key IN ('shield', 'charm') THEN
      INSERT INTO slot_boosts (user_id, kind, spin_id) VALUES (v_uid, v_key, v_spin);
    ELSIF v_key = 'bonus' THEN
      INSERT INTO slot_spin_ledger (user_id, company_id, delta, reason, source_id) VALUES (v_uid, v_company, 1, 'bonus', v_spin::text);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'spinId', v_spin,
    'outcome', v_outcome,
    'prizeKey', v_key,
    'prizeName', v_name,
    'xp', v_xp,
    'dupe', v_dupe,
    'charmUsed', v_charm IS NOT NULL,
    'needsClaim', v_outcome = 'merch',
    'requested', v_status = 'requested',
    'spins', slot_balance(v_uid),
    'total', (SELECT COALESCE(SUM(amount), 0)::int FROM xp_events WHERE user_id = v_uid),
    'boostEndsAt', (SELECT MAX(ends_at) FROM slot_boosts WHERE user_id = v_uid AND kind = 'xp2x' AND ends_at > now()),
    'charm', EXISTS (SELECT 1 FROM slot_boosts WHERE user_id = v_uid AND kind = 'charm' AND used_at IS NULL),
    'shield', EXISTS (SELECT 1 FROM slot_boosts WHERE user_id = v_uid AND kind = 'shield' AND used_at IS NULL)
  );
END;
$$;

-- Trade XP for a spin (up to trades_per_week a week). The XP comes off the rep's total.
CREATE OR REPLACE FUNCTION slot_trade(p_tz TEXT DEFAULT 'America/Denver')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company UUID;
  v_today DATE := (now() AT TIME ZONE slot_valid_tz(p_tz))::date;
  v_week TEXT := to_char((now() AT TIME ZONE slot_valid_tz(p_tz))::date, 'IYYY-IW');
  v_set slot_settings;
  v_used INT;
  v_total INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT company_id INTO v_company FROM user_profiles WHERE id = v_uid;
  IF NOT slot_enabled(v_company) THEN RAISE EXCEPTION 'SLAB Slots is off for your company'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('slot:' || v_uid::text));
  SELECT * INTO v_set FROM slot_settings WHERE id = 1;
  SELECT COUNT(*) INTO v_used FROM slot_spin_ledger WHERE user_id = v_uid AND reason = 'trade' AND source_id LIKE v_week || ':%';
  IF v_used >= v_set.trades_per_week THEN RAISE EXCEPTION 'You''ve used your % XP trades this week', v_set.trades_per_week; END IF;
  SELECT COALESCE(SUM(amount), 0)::int INTO v_total FROM xp_events WHERE user_id = v_uid;
  IF v_total < v_set.xp_trade_cost THEN RAISE EXCEPTION 'You need % XP to trade for a spin', v_set.xp_trade_cost; END IF;

  INSERT INTO xp_events (user_id, company_id, reason, source_id, base_amount, multiplier, amount, local_date, power_hour)
  VALUES (v_uid, v_company, 'slot_trade', v_week || ':' || (v_used + 1), -v_set.xp_trade_cost, 1, -v_set.xp_trade_cost, v_today, false);
  INSERT INTO slot_spin_ledger (user_id, company_id, delta, reason, source_id)
  VALUES (v_uid, v_company, 1, 'trade', v_week || ':' || (v_used + 1));

  RETURN jsonb_build_object(
    'spins', slot_balance(v_uid),
    'total', v_total - v_set.xp_trade_cost,
    'tradesLeft', v_set.trades_per_week - v_used - 1
  );
END;
$$;

-- The rep's size and shipping details for a merch win
CREATE OR REPLACE FUNCTION slot_claim(p_spin_id UUID, p_claim JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_claim JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  v_claim := jsonb_build_object(
    'size', left(COALESCE(p_claim->>'size', ''), 10),
    'name', left(COALESCE(p_claim->>'name', ''), 120),
    'address', left(COALESCE(p_claim->>'address', ''), 400),
    'phone', left(COALESCE(p_claim->>'phone', ''), 40),
    'note', left(COALESCE(p_claim->>'note', ''), 400),
    'at', now());
  IF COALESCE(v_claim->>'name', '') = '' OR COALESCE(v_claim->>'address', '') = '' THEN
    RAISE EXCEPTION 'Add your name and shipping address';
  END IF;
  UPDATE slot_spins SET claim = v_claim
  WHERE id = p_spin_id AND user_id = v_uid AND outcome = 'merch' AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'That prize can''t be claimed'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Super admins: the orders to fulfill, and marking them shipped or cancelled
CREATE OR REPLACE FUNCTION slot_admin_orders()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Super admins only';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(o ORDER BY (o->>'status') = 'requested' DESC, o->>'at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', s.id, 'outcome', s.outcome, 'prize', s.prize_name, 'status', s.status, 'claim', s.claim,
      'note', s.admin_note, 'at', s.created_at, 'fulfilledAt', s.fulfilled_at,
      'rep', COALESCE(p.display_name, p.email), 'email', p.email, 'company', c.name) AS o
    FROM slot_spins s
    LEFT JOIN user_profiles p ON p.id = s.user_id
    LEFT JOIN companies c ON c.id = s.company_id
    WHERE s.status IS NOT NULL
    ORDER BY s.created_at DESC LIMIT 300) q);
END;
$$;

CREATE OR REPLACE FUNCTION slot_admin_update(p_spin_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Super admins only';
  END IF;
  IF p_status NOT IN ('requested', 'shipped', 'cancelled') THEN RAISE EXCEPTION 'Unknown status %', p_status; END IF;
  UPDATE slot_spins SET status = p_status, admin_note = COALESCE(p_note, admin_note),
    fulfilled_at = CASE WHEN p_status = 'shipped' THEN now() ELSE NULL END,
    fulfilled_by = CASE WHEN p_status = 'shipped' THEN auth.uid() ELSE NULL END
  WHERE id = p_spin_id AND status IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION slot_valid_tz(TEXT), slot_enabled(UUID), slot_balance(UUID), slot_pick(JSONB), slot_catalog(),
  slot_grant_earned(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION slot_state(TEXT), slot_spin(TEXT), slot_trade(TEXT), slot_claim(UUID, JSONB),
  slot_admin_orders(), slot_admin_update(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION slot_state(TEXT), slot_spin(TEXT), slot_trade(TEXT), slot_claim(UUID, JSONB),
  slot_admin_orders(), slot_admin_update(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- grant_xp(): same as lesson-xp-30.sql, plus the slot machine's 2x boost,
-- which adds +1x on top of the streak and power hour multipliers
-- ============================================================================
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
  v_boost BOOLEAN := false;
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

  -- SLAB Slots 2x boost: +1x on top of everything else
  IF EXISTS (SELECT 1 FROM slot_boosts WHERE user_id = v_uid AND kind = 'xp2x' AND now() >= starts_at AND now() < ends_at) THEN
    v_boost := true;
    v_mult := v_mult + 1;
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
    'slotBoost', v_boost,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION grant_xp(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION grant_xp(TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- update_user_streak(): same as before, plus the streak shield. Coming back
-- after exactly one missed day uses a shield (if the rep has one) and the
-- streak carries on instead of resetting.
-- ============================================================================
CREATE OR REPLACE FUNCTION update_user_streak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shield UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM user_streaks WHERE user_id = NEW.user_id AND last_activity_date = NEW.activity_date - 2) THEN
    SELECT id INTO v_shield FROM slot_boosts
    WHERE user_id = NEW.user_id AND kind = 'shield' AND used_at IS NULL ORDER BY created_at LIMIT 1;
    IF v_shield IS NOT NULL THEN
      UPDATE slot_boosts SET used_at = now() WHERE id = v_shield;
    END IF;
  END IF;

  INSERT INTO user_streaks (user_id, company_id, current_streak, longest_streak, total_activities, last_activity_date, updated_at)
  VALUES (NEW.user_id, NEW.company_id, 1, 1, 1, NEW.activity_date, now())
  ON CONFLICT (user_id) DO UPDATE SET
    total_activities = user_streaks.total_activities + 1,
    current_streak = CASE
      WHEN user_streaks.last_activity_date = NEW.activity_date - INTERVAL '1 day' THEN user_streaks.current_streak + 1
      WHEN user_streaks.last_activity_date = NEW.activity_date THEN user_streaks.current_streak
      WHEN v_shield IS NOT NULL AND user_streaks.last_activity_date = NEW.activity_date - INTERVAL '2 days' THEN user_streaks.current_streak + 1
      ELSE 1
    END,
    longest_streak = GREATEST(
      user_streaks.longest_streak,
      CASE
        WHEN user_streaks.last_activity_date = NEW.activity_date - INTERVAL '1 day' THEN user_streaks.current_streak + 1
        WHEN user_streaks.last_activity_date = NEW.activity_date THEN user_streaks.current_streak
        WHEN v_shield IS NOT NULL AND user_streaks.last_activity_date = NEW.activity_date - INTERVAL '2 days' THEN user_streaks.current_streak + 1
        ELSE 1
      END
    ),
    last_activity_date = NEW.activity_date,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- End of slot-machine-migration.sql

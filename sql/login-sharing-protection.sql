-- Login-sharing protection, 2026-11-18
-- Run once in the Supabase SQL editor (or via the connector). Safe to re-run.
--
-- How it works (all inside the database, so it covers the website, the app and anything else
-- that signs in with Supabase, and a client can't skip it):
--  * Every new sign-in (a new row in auth.sessions) is written to public.login_events with its
--    IP, network and device (app / web).
--  * ONE SIGN-IN AT A TIME: the new sign-in signs out the account's other devices.
--    Their refresh tokens die at once. The website notices on the next page load, the app
--    within a minute (it checks while open); anything else within the hour when its token expires.
--    Super admins, and accounts with user_profiles.shared_login_ok = true, are exempt.
--  * "Overlap": the sign-in happened while another device on a DIFFERENT network had used the
--    account in the last 75 minutes. One overlap is normal (phone on cell, laptop on wifi).
--  * FLAG (never an automatic lockout) when, in the last 7 days (or since the flag was last
--    cleared), an account has 3+ overlaps, or signs in from 4+ different networks within 24 hours.
--    Flags show on the website at /security for super admins and are emailed to SLAB.
--  * A failure in any of this never blocks a sign-in.

BEGIN;

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS shared_login_ok BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id UUID,
  ip INET,
  network CIDR,
  user_agent TEXT,
  device TEXT,
  overlap BOOLEAN NOT NULL DEFAULT false,
  other_ip INET,
  other_device TEXT,
  signed_out_others INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_user_time ON public.login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_session ON public.login_events (auth_session_id);

CREATE TABLE IF NOT EXISTS public.account_security_flags (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'flagged' CHECK (status IN ('flagged', 'cleared', 'locked')),
  reason TEXT,
  overlap_count INT NOT NULL DEFAULT 0,
  network_count INT NOT NULL DEFAULT 0,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  note TEXT
);

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_security_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_events, public.account_security_flags FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.login_events, public.account_security_flags FROM authenticated;

DROP POLICY IF EXISTS "SLAB admins read login events" ON public.login_events;
CREATE POLICY "SLAB admins read login events" ON public.login_events
  FOR SELECT TO authenticated USING (public.current_user_role() = 'super_admin');
DROP POLICY IF EXISTS "SLAB admins read security flags" ON public.account_security_flags;
CREATE POLICY "SLAB admins read security flags" ON public.account_security_flags
  FOR SELECT TO authenticated USING (public.current_user_role() = 'super_admin');

-- Only SLAB can exempt an account from the one-device rule
CREATE OR REPLACE FUNCTION public.guard_user_profile_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() = 'super_admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.capture_protected IS DISTINCT FROM OLD.capture_protected THEN
    RAISE EXCEPTION 'capture_protected can only be changed by SLAB';
  END IF;
  IF NEW.shared_login_ok IS DISTINCT FROM OLD.shared_login_ok THEN
    RAISE EXCEPTION 'shared_login_ok can only be changed by SLAB';
  END IF;
  IF NEW.id = auth.uid() AND (
       NEW.role IS DISTINCT FROM OLD.role
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
  ) THEN
    RAISE EXCEPTION 'You cannot change your own role, company or status';
  END IF;
  RETURN NEW;
END;
$$;

-- /24 for IPv4, /48 for IPv6: the same wifi or office counts as one network
CREATE OR REPLACE FUNCTION public.ip_network(p_ip INET)
RETURNS CIDR LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_ip IS NULL THEN NULL
    ELSE network(set_masklen(p_ip, CASE WHEN family(p_ip) = 4 THEN 24 ELSE 48 END))::cidr END;
$$;

CREATE OR REPLACE FUNCTION public.login_device(p_user_agent TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_user_agent IS NULL THEN 'other'
    WHEN p_user_agent ILIKE 'SLABVoice/%' OR p_user_agent ILIKE 'SLAB-mobile%' OR p_user_agent ILIKE '%okhttp%'
      OR p_user_agent ILIKE '%CFNetwork%' THEN 'app'
    WHEN p_user_agent ILIKE 'Vercel%' THEN 'server'
    WHEN p_user_agent ILIKE '%Mozilla%' THEN 'web'
    ELSE 'other'
  END;
$$;

-- Recount an account's recent sign-ins and raise (or refresh) its flag
CREATE OR REPLACE FUNCTION public.evaluate_login_sharing(p_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_shared_ok BOOLEAN;
  v_flag account_security_flags;
  v_since TIMESTAMPTZ := now() - interval '7 days';
  v_overlaps INT;
  v_networks INT;
  v_reason TEXT;
BEGIN
  SELECT role, COALESCE(shared_login_ok, false) INTO v_role, v_shared_ok FROM user_profiles WHERE id = p_user_id;
  IF v_role = 'super_admin' OR v_shared_ok THEN RETURN; END IF;

  SELECT * INTO v_flag FROM account_security_flags WHERE user_id = p_user_id;
  IF v_flag.status = 'cleared' AND v_flag.reviewed_at > v_since THEN
    v_since := v_flag.reviewed_at;
  END IF;

  SELECT COUNT(*) FILTER (WHERE overlap) INTO v_overlaps
  FROM login_events WHERE user_id = p_user_id AND created_at > v_since;

  SELECT COUNT(DISTINCT network) INTO v_networks
  FROM login_events
  WHERE user_id = p_user_id AND network IS NOT NULL
    AND created_at > GREATEST(v_since, now() - interval '24 hours');

  IF v_overlaps >= 3 THEN
    v_reason := format('Signed in on a new device %s times while another device on a different network was using the account', v_overlaps);
  ELSIF v_networks >= 4 THEN
    v_reason := format('Signed in from %s different networks within 24 hours', v_networks);
  END IF;

  IF v_reason IS NULL THEN
    -- Keep counts fresh on an open flag even when below the line
    UPDATE account_security_flags SET overlap_count = v_overlaps, network_count = v_networks
    WHERE user_id = p_user_id AND status <> 'cleared';
    RETURN;
  END IF;

  INSERT INTO account_security_flags (user_id, status, reason, overlap_count, network_count, flagged_at, last_event_at)
  VALUES (p_user_id, 'flagged', v_reason, v_overlaps, v_networks, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    overlap_count = EXCLUDED.overlap_count,
    network_count = EXCLUDED.network_count,
    last_event_at = now(),
    -- A cleared flag opens again (and emails again); a locked account stays locked
    status = CASE WHEN account_security_flags.status = 'cleared' THEN 'flagged' ELSE account_security_flags.status END,
    flagged_at = CASE WHEN account_security_flags.status = 'cleared' THEN now() ELSE account_security_flags.flagged_at END,
    notified_at = CASE WHEN account_security_flags.status = 'cleared' THEN NULL ELSE account_security_flags.notified_at END;
END;
$$;

-- Runs on every new sign-in
CREATE OR REPLACE FUNCTION public.on_auth_session_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role TEXT;
  v_shared_ok BOOLEAN;
  v_net CIDR;
  v_device TEXT;
  v_other_ip INET;
  v_other_device TEXT;
  v_kicked INT := 0;
BEGIN
  BEGIN
    SELECT role, COALESCE(shared_login_ok, false) INTO v_role, v_shared_ok FROM public.user_profiles WHERE id = NEW.user_id;
    v_device := public.login_device(NEW.user_agent);
    -- A sign-in made by our own server (Vercel) doesn't carry the person's IP
    v_net := CASE WHEN v_device = 'server' THEN NULL ELSE public.ip_network(NEW.ip) END;

    -- Another device on a different network that used the account in the last 75 minutes.
    -- Its network comes from its own sign-in (auth.sessions.ip can later turn into Vercel's).
    IF v_net IS NOT NULL THEN
      SELECT le.ip, le.device INTO v_other_ip, v_other_device
      FROM auth.sessions s
      JOIN public.login_events le ON le.auth_session_id = s.id
      WHERE s.user_id = NEW.user_id AND s.id <> NEW.id
        AND GREATEST(s.created_at, s.updated_at, COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.created_at)) > now() - interval '75 minutes'
        AND le.network IS NOT NULL AND le.network <> v_net
      ORDER BY GREATEST(s.created_at, s.updated_at, COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.created_at)) DESC
      LIMIT 1;
    END IF;

    -- One sign-in at a time
    IF COALESCE(v_role, '') <> 'super_admin' AND NOT COALESCE(v_shared_ok, false) THEN
      DELETE FROM auth.sessions WHERE user_id = NEW.user_id AND id <> NEW.id;
      GET DIAGNOSTICS v_kicked = ROW_COUNT;
    END IF;

    INSERT INTO public.login_events (user_id, auth_session_id, ip, network, user_agent, device, overlap, other_ip, other_device, signed_out_others)
    VALUES (NEW.user_id, NEW.id, NEW.ip, v_net, left(NEW.user_agent, 400), v_device, v_other_ip IS NOT NULL, v_other_ip, v_other_device, v_kicked);

    PERFORM public.evaluate_login_sharing(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'login-sharing check failed for %: %', NEW.user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_session_created ON auth.sessions;
CREATE TRIGGER on_auth_session_created
  AFTER INSERT ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION public.on_auth_session_created();

-- The website fills in the real IP for a sign-in the database saw through Vercel
CREATE OR REPLACE FUNCTION public.set_login_event_ip(p_session_id UUID, p_ip TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID;
BEGIN
  UPDATE login_events SET ip = p_ip::inet, network = ip_network(p_ip::inet)
  WHERE auth_session_id = p_session_id AND network IS NULL
  RETURNING user_id INTO v_user;
  IF v_user IS NOT NULL THEN PERFORM evaluate_login_sharing(v_user); END IF;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN;
END;
$$;

-- Sign an account out everywhere (website "Sign out everywhere" and "Lock")
CREATE OR REPLACE FUNCTION public.security_sign_out_user(p_user_id UUID)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_count INT;
BEGIN
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Server-only helpers: not callable from the website or app with a user's key
REVOKE EXECUTE ON FUNCTION public.on_auth_session_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_login_sharing(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_login_event_ip(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_sign_out_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_login_sharing(UUID), public.set_login_event_ip(UUID, TEXT),
  public.security_sign_out_user(UUID) TO service_role;

COMMIT;

-- Exempt an account (for example a demo login SLAB shares on purpose):
--   UPDATE user_profiles SET shared_login_ok = true WHERE email = '...';

-- Security hardening, 2026-11-18 (audit thread "Audit security and stop login sharing")
-- Run once in the Supabase SQL editor (or via the connector). Safe to re-run.
--
-- What it closes (plain language):
--  1. STORAGE: a catch-all policy ("Allow all operations 12lxvn5_*") let ANYONE on the internet,
--     signed in or not, list, download, overwrite and delete every file in every bucket:
--     216 call recordings (unredacted customer audio) and 608 Vault audio files.
--     Replaced with narrow rules for what the website and app actually do.
--  2. VIEWS: four reporting views ran with owner rights and were readable without signing in
--     (emails + usage of every rep). Anonymous access removed; unused ones closed to reps too.
--  3. COMPANIES: anonymous visitors could read Stripe ids, billing email and fees of every company.
--     The logged-out login page keeps name/logo/colors only.
--  4. FUNCTIONS: create_user_profile could insert a super_admin profile when called by someone
--     with no profile (a NULL check bug). Dropped (nothing uses it). Session/login/heartbeat
--     functions accepted any user id, so anyone could fake or end other people's sessions.
--     DM channel creation let anyone open DMs between any two people in any company.
--  5. RLS: any signed-in rep could edit the PII redaction settings, read and edit purchase
--     inquiries (names, phones), edit any conversation, join any chat channel in any company
--     (reading other companies' chats) and create channels in other companies.

BEGIN;

-- ── 1. Storage ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all operations 12lxvn5_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow all operations 12lxvn5_1" ON storage.objects;
DROP POLICY IF EXISTS "Allow all operations 12lxvn5_2" ON storage.objects;
DROP POLICY IF EXISTS "Allow all operations 12lxvn5_3" ON storage.objects;

-- SLAB super admins can do anything in storage (admin transcript pages, redaction, deletes)
DROP POLICY IF EXISTS "SLAB admins manage storage" ON storage.objects;
CREATE POLICY "SLAB admins manage storage" ON storage.objects
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- Upload page (src/hooks/useAudioUpload.ts): signed-in people upload a recording, then
-- /api/process-audio signs a link to the file they just uploaded (their own files only).
DROP POLICY IF EXISTS "Signed-in users upload call recordings" ON storage.objects;
CREATE POLICY "Signed-in users upload call recordings" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'call-recordings');

DROP POLICY IF EXISTS "Uploaders read their own call recordings" ON storage.objects;
CREATE POLICY "Uploaders read their own call recordings" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'call-recordings' AND owner_id = auth.uid()::text);

-- Profile pictures on the dashboards are saved as "<user id>-<time>.<ext>" at the bucket root
DROP POLICY IF EXISTS "Users upload own profile picture file" ON storage.objects;
CREATE POLICY "Users upload own profile picture file" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-pictures' AND name LIKE auth.uid()::text || '-%');

DROP POLICY IF EXISTS "Users replace own profile picture file" ON storage.objects;
CREATE POLICY "Users replace own profile picture file" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-pictures' AND name LIKE auth.uid()::text || '-%')
  WITH CHECK (bucket_id = 'profile-pictures' AND name LIKE auth.uid()::text || '-%');

-- ── 2. Reporting views ──────────────────────────────────────────────────────
REVOKE SELECT ON public.user_usage_summary, public.user_quiz_progress, public.company_streak_leaderboard,
  public.channel_members_raw, public.company_usage_summary, public.conversation_stats,
  public.objection_frequency, public.user_login_stats, public.user_xp_totals,
  public.vault_days_index, public.weekly_usage_stats FROM anon;
-- Not used by the website or app; they listed every rep's email and usage across all companies
REVOKE SELECT ON public.user_usage_summary, public.user_quiz_progress, public.channel_members_raw FROM authenticated;

-- ── 3. Companies: logged-out visitors see branding only ─────────────────────
REVOKE SELECT ON public.companies FROM anon;
GRANT SELECT (id, name, slug, logo_url, primary_color, secondary_color, is_active) ON public.companies TO anon;

-- ── 4. Functions ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_user_profile(uuid, text, text, text, uuid);

-- Nothing here is meant to be called by someone who isn't signed in
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.auto_close_inactive_sessions()',
    'public.company_roster()',
    'public.end_user_session(uuid)',
    'public.get_dm_partner(uuid, uuid)',
    'public.get_or_create_dm_channel(uuid, uuid, uuid)',
    'public.get_user_blocking_videos(uuid)',
    'public.get_user_channel_ids(uuid)',
    'public.guard_user_profile_self_update()',
    'public.handle_new_user()',
    'public.invite_rep(text, text, text, uuid)',
    'public.log_user_login(uuid, text, text)',
    'public.manage_rep(uuid, text, text, uuid, boolean, boolean)',
    'public.owner_caller()',
    'public.record_activity_heartbeat(uuid, text, text, jsonb)',
    'public.save_team(uuid, text, uuid, integer)',
    'public.start_user_session(uuid, text, text)',
    'public.user_has_section_access(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  -- Trigger-only functions: nobody calls these directly
  REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
  REVOKE EXECUTE ON FUNCTION public.guard_user_profile_self_update() FROM authenticated;
END $$;

-- Sessions and logins: only for yourself (the service role, with no signed-in user, may do any)
CREATE OR REPLACE FUNCTION public.start_user_session(p_user_id uuid, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session_id UUID;
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT company_id INTO v_company_id FROM user_profiles WHERE id = p_user_id;
  INSERT INTO user_sessions (user_id, company_id, ip_address, user_agent, is_active)
  VALUES (p_user_id, v_company_id, p_ip_address, p_user_agent, true)
  RETURNING id INTO v_session_id;
  INSERT INTO user_activity_events (user_id, company_id, session_id, event_type)
  VALUES (p_user_id, v_company_id, v_session_id, 'login');
  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_user_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
BEGIN
  SELECT user_id, company_id INTO v_user_id, v_company_id FROM user_sessions WHERE id = p_session_id;
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE user_sessions SET session_end = NOW(), is_active = false WHERE id = p_session_id;
  INSERT INTO user_activity_events (user_id, company_id, session_id, event_type)
  VALUES (v_user_id, v_company_id, p_session_id, 'logout');
  PERFORM update_daily_usage_stats(v_user_id, CURRENT_DATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_user_login(p_user_id uuid, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO login_logs (user_id, ip_address, user_agent)
  VALUES (p_user_id, p_ip_address, p_user_agent)
  RETURNING id INTO v_log_id;
  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_activity_heartbeat(p_session_id uuid, p_page_path text, p_activity_type text DEFAULT 'page_active', p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_heartbeat_id UUID;
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM user_sessions WHERE id = p_session_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unknown session'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO activity_heartbeats (session_id, user_id, page_path, activity_type, metadata)
  VALUES (p_session_id, v_user_id, p_page_path, p_activity_type, p_metadata)
  RETURNING id INTO v_heartbeat_id;
  UPDATE user_sessions SET last_activity = NOW() WHERE id = p_session_id;
  RETURN v_heartbeat_id;
END;
$$;

-- DMs: the caller must be one of the two people, and both must be in that company
CREATE OR REPLACE FUNCTION public.get_or_create_dm_channel(p_company_id uuid, p_user1_id uuid, p_user2_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel_id UUID;
  v_user_min UUID;
  v_user_max UUID;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() NOT IN (p_user1_id, p_user2_id) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    IF current_user_role() <> 'super_admin' AND (
         NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user1_id AND company_id = p_company_id)
      OR NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user2_id AND company_id = p_company_id)
    ) THEN
      RAISE EXCEPTION 'Both people must be in this company';
    END IF;
  END IF;

  IF p_user1_id < p_user2_id THEN
    v_user_min := p_user1_id; v_user_max := p_user2_id;
  ELSE
    v_user_min := p_user2_id; v_user_max := p_user1_id;
  END IF;

  SELECT cm1.channel_id INTO v_channel_id
  FROM channel_members cm1
  JOIN channel_members cm2 ON cm1.channel_id = cm2.channel_id
  JOIN channels c ON c.id = cm1.channel_id
  WHERE c.channel_type = 'dm' AND c.company_id = p_company_id
    AND cm1.user_id = v_user_min AND cm2.user_id = v_user_max
    AND cm1.is_active = true AND cm2.is_active = true
  LIMIT 1;

  IF v_channel_id IS NULL THEN
    INSERT INTO channels (company_id, channel_type, created_by)
    VALUES (p_company_id, 'dm', v_user_min)
    RETURNING id INTO v_channel_id;
    INSERT INTO channel_members (channel_id, user_id, added_by)
    VALUES (v_channel_id, v_user_min, v_user_min), (v_channel_id, v_user_max, v_user_min);
  END IF;
  RETURN v_channel_id;
END;
$$;

-- ── 5. Row level security ───────────────────────────────────────────────────
-- PII redaction settings: SLAB admins only (the /config page and its API already require that)
DROP POLICY IF EXISTS "Allow authenticated users to update redaction config" ON public.redaction_config;
CREATE POLICY "SLAB admins update redaction config" ON public.redaction_config
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- Purchase inquiries hold names, emails and phone numbers: SLAB admins only
DROP POLICY IF EXISTS "Enable select for authenticated users" ON public.purchase_inquiries;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.purchase_inquiries;
CREATE POLICY "SLAB admins read inquiries" ON public.purchase_inquiries
  FOR SELECT TO authenticated USING (public.current_user_role() = 'super_admin');
CREATE POLICY "SLAB admins update inquiries" ON public.purchase_inquiries
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- Conversations are written by the server with the service role (which skips RLS);
-- these two policies let every signed-in rep insert or rewrite any conversation.
DROP POLICY IF EXISTS "Service role can insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Service role can update conversations" ON public.conversations;

-- Chat: only a channel's creator, that company's owner, or a SLAB admin adds members
CREATE OR REPLACE FUNCTION public.can_manage_channel(cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM channels c
    JOIN user_profiles me ON me.id = auth.uid()
    WHERE c.id = cid AND (
      c.created_by = auth.uid()
      OR me.role = 'super_admin'
      OR (me.role = 'company_admin' AND me.company_id = c.company_id)
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_manage_channel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_channel(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "channel_members_insert" ON public.channel_members;
CREATE POLICY "channel_members_insert" ON public.channel_members
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_channel(channel_id));

-- The stricter "Users can create channels" policy (own company only) stays; this looser one
-- let anyone create a channel inside another company.
DROP POLICY IF EXISTS "channels_insert" ON public.channels;

COMMIT;

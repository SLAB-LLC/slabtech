-- ============================================================================
-- Owner tools for the app: teams, the roster, and managing reps
-- ============================================================================
-- What the app's Owner view and My Team read and change:
--   teams                 a company's teams, each with a manager and a weekly XP goal
--   user_profiles.team_id which team a rep is on
--   company_invites.team_id the team an invited rep joins
--   company_roster()      every rep with their XP, streak, lessons, last open and look
--   manage_rep(...)       role, level, team and on/off for one rep
--   save_team(...)        create or change a team
--   invite_rep(...)       an invite link for a new rep
--
-- The rules match the website (src/utils/users/accounts.ts): owners act inside
-- their own company, SLAB admins anywhere, owners can't touch SLAB admins, nobody
-- changes their own role. Managers see and set the level of the reps on teams
-- they manage.
--
-- Safe to run more than once. Run after roles-migration.sql and xp-engine-migration.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  weekly_goal INT NOT NULL DEFAULT 3000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teams_company ON teams(company_id);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE company_invites ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Members read their company's teams; changes go through save_team()
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read company teams" ON teams;
CREATE POLICY "Members read company teams" ON teams FOR SELECT TO authenticated USING (
  company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
  OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- The caller, if they may run a company (owner or SLAB admin)
CREATE OR REPLACE FUNCTION owner_caller()
RETURNS user_profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me user_profiles;
BEGIN
  SELECT * INTO v_me FROM user_profiles WHERE id = auth.uid();
  IF v_me.id IS NULL OR v_me.role NOT IN ('company_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only owners can do that';
  END IF;
  IF v_me.company_id IS NULL THEN
    RAISE EXCEPTION 'Your account has no company';
  END IF;
  RETURN v_me;
END;
$$;

-- Every rep the caller can see, with what the Owner view and My Team show
CREATE OR REPLACE FUNCTION company_roster()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me user_profiles;
  v_owner BOOLEAN;
BEGIN
  SELECT * INTO v_me FROM user_profiles WHERE id = auth.uid();
  IF v_me.id IS NULL OR v_me.role NOT IN ('company_admin', 'super_admin', 'manager') THEN
    RAISE EXCEPTION 'Only owners and managers can see the roster';
  END IF;
  IF v_me.company_id IS NULL THEN
    RAISE EXCEPTION 'Your account has no company';
  END IF;
  v_owner := v_me.role IN ('company_admin', 'super_admin');

  RETURN jsonb_build_object(
    'seats', (SELECT account_limit FROM companies WHERE id = v_me.company_id),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'managerId', t.manager_id, 'goal', t.weekly_goal) ORDER BY t.created_at)
      FROM teams t WHERE t.company_id = v_me.company_id
    ), '[]'::jsonb),
    'reps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', COALESCE(NULLIF(p.display_name, ''), p.email),
        'email', p.email,
        'role', p.role,
        'level', COALESCE(p.level, 'rookie'),
        'active', COALESCE(p.is_active, true),
        'teamId', p.team_id,
        'weekXp', COALESCE(x.week_xp, 0),
        'totalXp', COALESCE(x.total_xp, 0),
        'lessons', COALESCE(x.lessons, 0),
        'vaultMinutes', COALESCE(x.vault_minutes, 0),
        'bosses', COALESCE(x.bosses, '[]'::jsonb),
        'streak', CASE WHEN s.last_activity_date >= current_date - 1 THEN COALESCE(s.current_streak, 0) ELSE 0 END,
        'lastActive', GREATEST(x.last_xp, u.last_sign_in_at),
        'look', a.look
      ) ORDER BY COALESCE(x.week_xp, 0) DESC)
      FROM user_profiles p
      LEFT JOIN auth.users u ON u.id = p.id
      LEFT JOIN user_streaks s ON s.user_id = p.id
      LEFT JOIN user_avatars a ON a.user_id = p.id
      LEFT JOIN LATERAL (
        SELECT
          SUM(e.amount) FILTER (WHERE e.created_at >= date_trunc('week', now()))::INT AS week_xp,
          SUM(e.amount)::INT AS total_xp,
          COUNT(DISTINCT e.source_id) FILTER (WHERE e.reason = 'lesson_complete')::INT AS lessons,
          COUNT(*) FILTER (WHERE e.reason = 'vault_minute')::INT AS vault_minutes,
          jsonb_agg(DISTINCT e.source_id) FILTER (WHERE e.reason = 'boss_win' AND e.source_id IS NOT NULL) AS bosses,
          MAX(e.created_at) AS last_xp
        FROM xp_events e WHERE e.user_id = p.id
      ) x ON true
      WHERE p.company_id = v_me.company_id
        AND (v_owner OR p.id = v_me.id OR p.team_id IN (SELECT id FROM teams WHERE manager_id = v_me.id))
    ), '[]'::jsonb),
    'invites', CASE WHEN v_owner THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'teamId', i.team_id, 'expiresAt', i.expires_at) ORDER BY i.created_at DESC)
      FROM company_invites i WHERE i.company_id = v_me.company_id AND NOT i.accepted AND i.expires_at > now()
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;

-- Role, level, team and on/off for one rep. Leave a field NULL to keep it.
CREATE OR REPLACE FUNCTION manage_rep(
  p_target UUID,
  p_role TEXT DEFAULT NULL,
  p_level TEXT DEFAULT NULL,
  p_team UUID DEFAULT NULL,
  p_clear_team BOOLEAN DEFAULT false,
  p_active BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me user_profiles;
  v_target user_profiles;
BEGIN
  SELECT * INTO v_me FROM user_profiles WHERE id = auth.uid();
  SELECT * INTO v_target FROM user_profiles WHERE id = p_target;
  IF v_me.id IS NULL OR v_target.id IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  -- Managers may only set the level of reps on teams they manage
  IF v_me.role = 'manager' THEN
    IF p_role IS NOT NULL OR p_team IS NOT NULL OR p_clear_team OR p_active IS NOT NULL THEN
      RAISE EXCEPTION 'Only owners can do that';
    END IF;
    IF v_target.company_id IS DISTINCT FROM v_me.company_id
       OR NOT EXISTS (SELECT 1 FROM teams WHERE id = v_target.team_id AND manager_id = v_me.id) THEN
      RAISE EXCEPTION 'That rep isn''t on your team';
    END IF;
  ELSIF v_me.role = 'company_admin' THEN
    IF v_target.company_id IS DISTINCT FROM v_me.company_id OR v_target.role = 'super_admin' THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
    IF p_role IS NOT NULL AND p_role NOT IN ('user', 'manager', 'company_admin') THEN
      RAISE EXCEPTION 'You can''t give that role';
    END IF;
  ELSIF v_me.role <> 'super_admin' THEN
    RAISE EXCEPTION 'Only owners can do that';
  END IF;

  IF p_role IS NOT NULL AND p_role NOT IN ('user', 'manager', 'company_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unknown role';
  END IF;
  IF p_role IS NOT NULL AND p_target = v_me.id AND p_role <> v_me.role THEN
    RAISE EXCEPTION 'You can''t change your own role';
  END IF;
  IF p_level IS NOT NULL AND p_level NOT IN ('rookie', 'vet') THEN
    RAISE EXCEPTION 'Level must be rookie or vet';
  END IF;
  IF p_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team AND company_id = v_target.company_id) THEN
    RAISE EXCEPTION 'That team isn''t in this company';
  END IF;
  IF p_active IS NOT NULL AND p_target = v_me.id THEN
    RAISE EXCEPTION 'You can''t turn off your own account';
  END IF;

  UPDATE user_profiles SET
    role = COALESCE(p_role, role),
    level = COALESCE(p_level, level),
    team_id = CASE WHEN p_clear_team THEN NULL ELSE COALESCE(p_team, team_id) END,
    is_active = COALESCE(p_active, is_active),
    updated_at = now()
  WHERE id = p_target;

  -- A rep who stops being a manager stops managing their teams
  IF p_role IS NOT NULL AND p_role = 'user' THEN
    UPDATE teams SET manager_id = NULL WHERE manager_id = p_target;
  END IF;
END;
$$;

-- Create (p_id NULL) or change a team. The manager joins the team and becomes a manager.
CREATE OR REPLACE FUNCTION save_team(
  p_id UUID,
  p_name TEXT,
  p_manager UUID DEFAULT NULL,
  p_goal INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me user_profiles := owner_caller();
  v_id UUID := p_id;
BEGIN
  IF COALESCE(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the team a name'; END IF;
  IF p_manager IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = p_manager AND company_id = v_me.company_id AND role <> 'super_admin'
  ) AND p_manager <> v_me.id THEN
    RAISE EXCEPTION 'The manager has to be in your company';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO teams (company_id, name, manager_id, weekly_goal)
    VALUES (v_me.company_id, trim(p_name), p_manager, GREATEST(500, COALESCE(p_goal, 3000)))
    RETURNING id INTO v_id;
  ELSE
    UPDATE teams SET
      name = trim(p_name),
      manager_id = p_manager,
      weekly_goal = GREATEST(500, COALESCE(p_goal, weekly_goal))
    WHERE id = v_id AND company_id = v_me.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Team not found'; END IF;
  END IF;

  IF p_manager IS NOT NULL THEN
    UPDATE user_profiles SET
      team_id = v_id,
      role = CASE WHEN role = 'user' THEN 'manager' ELSE role END,
      updated_at = now()
    WHERE id = p_manager;
  END IF;
  RETURN v_id;
END;
$$;

-- An invite for a new rep; returns the token for the link (site /invite/<token>).
-- Inviting the same email again sends a fresh link.
CREATE OR REPLACE FUNCTION invite_rep(
  p_email TEXT,
  p_role TEXT DEFAULT 'user',
  p_level TEXT DEFAULT 'rookie',
  p_team UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me user_profiles := owner_caller();
  v_email TEXT := lower(trim(p_email));
  v_limit INT;
  v_used INT;
  v_token TEXT := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'That email doesn''t look right'; END IF;
  IF p_role NOT IN ('user', 'manager', 'company_admin') THEN RAISE EXCEPTION 'You can''t give that role'; END IF;
  IF p_level NOT IN ('rookie', 'vet') THEN RAISE EXCEPTION 'Level must be rookie or vet'; END IF;
  IF p_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team AND company_id = v_me.company_id) THEN
    RAISE EXCEPTION 'That team isn''t in your company';
  END IF;
  IF EXISTS (SELECT 1 FROM user_profiles WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'That email already has an account';
  END IF;

  SELECT account_limit INTO v_limit FROM companies WHERE id = v_me.company_id;
  IF v_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_used FROM user_profiles WHERE company_id = v_me.company_id AND is_active;
    IF v_used >= v_limit THEN RAISE EXCEPTION 'No seats left (% of %). Free one up or add seats.', v_used, v_limit; END IF;
  END IF;

  INSERT INTO company_invites (company_id, email, role, level, team_id, token, expires_at, invited_by)
  VALUES (v_me.company_id, v_email, p_role, p_level, p_team, v_token, now() + interval '7 days', v_me.id)
  ON CONFLICT (company_id, email) DO UPDATE SET
    role = EXCLUDED.role, level = EXCLUDED.level, team_id = EXCLUDED.team_id, token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at, invited_by = EXCLUDED.invited_by, accepted = false, accepted_at = NULL;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION owner_caller() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION company_roster() TO authenticated;
GRANT EXECUTE ON FUNCTION manage_rep(UUID, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION save_team(UUID, TEXT, UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION invite_rep(TEXT, TEXT, TEXT, UUID) TO authenticated;

-- End of owner-tools-migration.sql

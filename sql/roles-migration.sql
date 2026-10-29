-- ============================================================================
-- Roles, the same everywhere: rep, manager, owner, SLAB admin
-- ============================================================================
-- user_profiles.role:
--   user           Rep
--   manager        Manager (a rep who runs a team; same access as a rep for now)
--   company_admin  Owner of their company
--   super_admin    SLAB admin, treated as an owner of every company
-- user_profiles.level: rookie | vet. Vets get every lesson open and the Vault and
-- chat without the XP unlock. Set by owners and admins on the website.
--
-- Safe to run more than once. Run after the multi-tenancy migration.
-- ============================================================================

-- Managers join the allowed roles
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin', 'company_admin', 'manager', 'user'));

-- Rookie / Vet
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'rookie';
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_level_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_level_check
  CHECK (level IN ('rookie', 'vet'));

-- Invites can be for any company role
ALTER TABLE company_invites DROP CONSTRAINT IF EXISTS company_invites_role_check;
ALTER TABLE company_invites ADD CONSTRAINT company_invites_role_check
  CHECK (role IN ('company_admin', 'manager', 'user'));
ALTER TABLE company_invites ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'rookie';
ALTER TABLE company_invites DROP CONSTRAINT IF EXISTS company_invites_level_check;
ALTER TABLE company_invites ADD CONSTRAINT company_invites_level_check
  CHECK (level IN ('rookie', 'vet'));

-- New accounts take role, level and company only from app metadata, which just the
-- website's server (service role) can set. User metadata is whatever the person
-- signing up sends, so trusting it let anyone call sign-up with role super_admin.
-- No company in app metadata means no profile here: the website writes the
-- profile itself right after making the login, and any other sign-up gets no
-- access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  user_level TEXT;
  user_company TEXT;
BEGIN
  user_company := NEW.raw_app_meta_data->>'company_id';
  IF user_company IS NULL OR user_company !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;

  user_role := COALESCE(NEW.raw_app_meta_data->>'role', 'user');
  IF user_role = 'admin' THEN
    user_role := 'super_admin';
  END IF;
  IF user_role NOT IN ('super_admin', 'company_admin', 'manager', 'user') THEN
    user_role := 'user';
  END IF;

  user_level := COALESCE(NEW.raw_app_meta_data->>'level', 'rookie');
  IF user_level NOT IN ('rookie', 'vet') THEN
    user_level := 'rookie';
  END IF;

  INSERT INTO public.user_profiles (id, email, display_name, role, level, company_id, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), NEW.email),
    user_role,
    user_level,
    user_company::UUID,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- End of roles-migration.sql

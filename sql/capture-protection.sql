-- Screenshot / screen-recording protection (2026-11-18).
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- 1. user_profiles.capture_protected: when true, the website shows a watermark with the
--    viewer's email and blocks copy/right-click/print, and the app blocks screenshots and
--    screen recordings (black on Android, blank on iOS) with the same watermark.
--    A whole company can be switched on with company_app_config.features.captureProtection.
-- 2. A guard so people can't edit their own role, company or protection flag through the API.
--    Before this, the "Admins can update profiles" policy let anyone update every column of
--    their own row (including role). Admin tools use the service key and are not affected.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS capture_protected BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_user_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service key / SQL editor (no signed-in user) and SLAB super admins can change anything
  IF auth.uid() IS NULL OR public.current_user_role() = 'super_admin' THEN
    RETURN NEW;
  END IF;

  -- Only SLAB can switch capture protection on or off
  IF NEW.capture_protected IS DISTINCT FROM OLD.capture_protected THEN
    RAISE EXCEPTION 'capture_protected can only be changed by SLAB';
  END IF;

  -- Nobody promotes themselves or moves themselves to another company
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

DROP TRIGGER IF EXISTS guard_user_profile_self_update ON user_profiles;
CREATE TRIGGER guard_user_profile_self_update
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_profile_self_update();

-- Turn it on for one person (prospect logins, e.g. Devin at Cru, community solar):
UPDATE user_profiles SET capture_protected = true
WHERE email = 'devin@itscru.com';

-- Or for a whole company:
-- UPDATE company_app_config a
-- SET features = a.features || '{"captureProtection": true}'::jsonb
-- FROM companies c WHERE c.id = a.company_id AND c.slug = '<slug>';

-- Check
SELECT email, capture_protected FROM user_profiles WHERE capture_protected;

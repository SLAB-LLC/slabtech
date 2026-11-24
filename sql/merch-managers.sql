-- ============================================================================
-- Merch managers: people who can run SLAB Slots merch/video fulfillment
-- (/slot-orders) like a super admin, without being one. (2026-11-24)
--
-- A merch manager keeps their normal role and company. The only thing this adds
-- is access to slot_admin_orders() and slot_admin_update(), which list every
-- slot prize SLAB has to fulfill (all companies, with shipping addresses) and
-- mark them shipped/delivered/cancelled.
--
-- Nobody can add themselves: the table has no insert/update/delete policies,
-- so rows are only written from the SQL editor / service key.
-- Run after sql/slot-machine-migration.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS merch_managers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE merch_managers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own merch manager row" ON merch_managers;
CREATE POLICY "Read own merch manager row" ON merch_managers FOR SELECT TO authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- True for SLAB super admins and merch managers (active accounts only)
CREATE OR REPLACE FUNCTION can_manage_merch()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles p
    WHERE p.id = auth.uid() AND p.is_active
      AND (p.role = 'super_admin' OR EXISTS (SELECT 1 FROM merch_managers m WHERE m.user_id = p.id))
  );
$$;
REVOKE ALL ON FUNCTION can_manage_merch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_manage_merch() TO authenticated;

-- Same as slot-machine-migration.sql, but the guard is can_manage_merch()
CREATE OR REPLACE FUNCTION slot_admin_orders()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT can_manage_merch() THEN
    RAISE EXCEPTION 'Super admins and merch managers only';
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
  IF NOT can_manage_merch() THEN
    RAISE EXCEPTION 'Super admins and merch managers only';
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

-- Add a merch manager (run in the SQL editor):
INSERT INTO merch_managers (user_id, note)
SELECT id, 'Merch fulfillment (Duncan, 2026-11-24)' FROM user_profiles WHERE lower(email) = 'elise1006@icloud.com'
ON CONFLICT (user_id) DO NOTHING;

-- Remove one:
--   DELETE FROM merch_managers WHERE user_id = (SELECT id FROM user_profiles WHERE lower(email) = '...');

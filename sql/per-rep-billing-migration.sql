-- ============================================================================
-- Per-rep billing: companies that pay per active rep instead of a flat fee
-- ============================================================================
-- Run once in the Supabase SQL Editor after stripe-usage-migration.sql. Safe to re-run.
--
-- companies.billing_plan
--   'flat'    : $300/mo platform fee (Ace). Default, so existing companies don't change.
--   'per_rep' : $5 per active rep per month (Flex). Checkout uses STRIPE_PRICE_ACTIVE_REP
--               instead of STRIPE_PRICE_PLATFORM. Both plans also pay $8 per rep audio day.
--
-- An active rep = a user_profiles row in the company with is_active = true (SLAB
-- super_admins are never counted). The month's bill uses the PEAK count seen that
-- calendar month (America/Denver), so a rep enabled at any time in the month counts.
--
-- The daily cron (/api/billing/report-usage) calls record_active_reps(), which bumps
-- each per-rep company's peak for this month, then sends the peak to the Stripe meter
-- "active_reps" (aggregation: Last), so the invoice charges the month's peak.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_plan TEXT NOT NULL DEFAULT 'flat';
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_billing_plan_check;
ALTER TABLE companies ADD CONSTRAINT companies_billing_plan_check CHECK (billing_plan IN ('flat', 'per_rep'));

CREATE TABLE IF NOT EXISTS billing_active_reps (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month DATE NOT NULL,          -- first day of the calendar month
  peak INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, month)
);

-- Only the server (service role) reads and writes this table
ALTER TABLE billing_active_reps ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_active_reps()
RETURNS TABLE (company_id UUID, stripe_customer_id TEXT, month DATE, peak INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', now() AT TIME ZONE 'America/Denver')::date;
  v_today DATE := (now() AT TIME ZONE 'America/Denver')::date;
BEGIN
  INSERT INTO billing_active_reps AS b (company_id, month, peak)
  SELECT c.id, v_month, COUNT(p.id)::int
  FROM companies c
  LEFT JOIN user_profiles p
    ON p.company_id = c.id AND p.is_active IS TRUE AND p.role <> 'super_admin'
  WHERE c.billing_plan = 'per_rep'
    AND c.stripe_subscription_id IS NOT NULL
    AND c.billing_status = 'active'
    AND c.billing_start_date IS NOT NULL
    AND c.billing_start_date <= v_today
  GROUP BY c.id
  ON CONFLICT (company_id, month)
  DO UPDATE SET peak = GREATEST(b.peak, EXCLUDED.peak), updated_at = now();

  RETURN QUERY
  SELECT b.company_id, c.stripe_customer_id, b.month, b.peak
  FROM billing_active_reps b
  JOIN companies c ON c.id = b.company_id
  WHERE b.month = v_month
    AND c.billing_plan = 'per_rep'
    AND c.stripe_customer_id IS NOT NULL
    AND c.billing_status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.record_active_reps() FROM PUBLIC, anon, authenticated;

-- Flex: switch to per-rep billing once their company row exists (slug may differ):
-- UPDATE companies SET billing_plan = 'per_rep', billing_start_date = '<signing date + 30 days>' WHERE slug = 'flex';

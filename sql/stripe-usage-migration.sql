-- ============================================================================
-- Stripe usage: count each company's billable rep audio days and send them to Stripe
-- ============================================================================
-- Run once in the Supabase SQL Editor after stripe-billing-migration.sql. Safe to re-run.
--
-- A billable audio day = one rep, one recording date, published to the company's
-- own Vault (not the global Marshall pack), on or after companies.billing_start_date,
-- while the company has an active Stripe subscription. It's billed in the month it
-- was published. Each day is counted once, ever.
--
-- /api/billing/report-usage (daily Vercel cron) calls collect_billable_audio_days(),
-- then sends every unreported row to Stripe's meter and stamps reported_at.
-- ============================================================================

-- When paid billing starts (Ace: 2027-01-01). Checkout delays the first charge to
-- this date, and audio days published before it are free.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_start_date DATE;

CREATE TABLE IF NOT EXISTS billing_audio_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rep_name TEXT NOT NULL,
  recording_date DATE NOT NULL,
  vault_day_id UUID REFERENCES vault_days(id) ON DELETE SET NULL,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_audio_days_unique
  ON billing_audio_days(company_id, lower(rep_name), recording_date);
CREATE INDEX IF NOT EXISTS idx_billing_audio_days_unreported
  ON billing_audio_days(counted_at) WHERE reported_at IS NULL;

-- Only the server (service role) reads and writes this table
ALTER TABLE billing_audio_days ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.collect_billable_audio_days()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO billing_audio_days (company_id, rep_name, recording_date, vault_day_id)
  SELECT DISTINCT ON (v.company_id, lower(trim(v.rep_name)), COALESCE(v.recording_date, v.published_at::date))
    v.company_id, trim(v.rep_name), COALESCE(v.recording_date, v.published_at::date), v.id
  FROM vault_days v
  JOIN companies c ON c.id = v.company_id
  WHERE v.visibility = 'company'
    AND c.stripe_subscription_id IS NOT NULL
    AND c.billing_status = 'active'
    AND c.billing_start_date IS NOT NULL
    AND v.published_at >= c.billing_start_date
  ORDER BY v.company_id, lower(trim(v.rep_name)), COALESCE(v.recording_date, v.published_at::date), v.published_at
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.collect_billable_audio_days() FROM PUBLIC, anon, authenticated;

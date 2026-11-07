-- ============================================================================
-- Stripe billing: link each company to its Stripe customer and subscription
-- ============================================================================
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Written by /api/billing/webhook after a company finishes Stripe checkout.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_stripe_customer ON companies(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_stripe_subscription ON companies(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

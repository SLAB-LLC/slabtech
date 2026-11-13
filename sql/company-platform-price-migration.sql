-- Per-company platform price (2026-11-12)
-- Most companies pay the default STRIPE_PRICE_PLATFORM ($300/mo). A company with its own
-- deal gets its own Stripe price here; checkout uses it instead of the default, and the
-- billing page shows platform_fee_cents. Run once in the Supabase SQL editor.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS platform_price_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER;

-- ProTerra Pest Control: $50/mo flat, contract starts at signing (2026-11-13).
-- billing_start_date also turns on the $8 rep audio-day count from that date.
-- Check the slug first: SELECT id, slug, name FROM companies WHERE name ILIKE '%terra%';
UPDATE companies
SET platform_price_id = 'price_1Ub8KOHbnln68isJe8ihkzgc',
    platform_fee_cents = 5000,
    billing_start_date = '2026-11-13'
WHERE slug = 'proterra';

-- Add account_limit field to companies table
-- This allows super admins to set a maximum number of active users per company

ALTER TABLE companies
ADD COLUMN IF NOT EXISTS account_limit INTEGER DEFAULT NULL;

COMMENT ON COLUMN companies.account_limit IS 'Maximum number of active user accounts allowed for this company. NULL means unlimited.';

-- Update existing companies to have unlimited accounts
UPDATE companies
SET account_limit = NULL
WHERE account_limit IS NULL;

DO $$ BEGIN RAISE NOTICE 'Account limit field added to companies table'; END $$;

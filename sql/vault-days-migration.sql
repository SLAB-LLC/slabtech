-- ============================================================================
-- Vault days: recorded days, cut to door pitches and redacted, for the app's Vault
-- ============================================================================
-- The recording pipeline (slab-pipeline) cuts each day to its door pitches, bleeps
-- private details, re-checks every pitch and finds the objection and close moments.
-- It publishes the result here, and the app's Vault reads it:
--   vault_days            one row per published day: doors and clips in the app's
--                         VX_DATA shape (see docs/app-integration.md)
--   storage `vault-audio` one mp3 per door at <company_id or global>/<day id>/<NN>.mp3
--
-- Who sees a day: visibility 'global' is the Marshall pack every company sees;
-- 'company' is only the day's own company. SLAB admins see everything.
-- The app loads featured days (each carries its full transcript, so only a dozen at a time).
-- Only the pipeline writes (service role); the app only reads.
--
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vault_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID UNIQUE REFERENCES transcripts(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'company' CHECK (visibility IN ('company', 'global')),
  featured BOOLEAN NOT NULL DEFAULT false,
  rep_name TEXT NOT NULL,
  recording_date DATE,
  area TEXT,
  minutes NUMERIC NOT NULL DEFAULT 0,
  doors JSONB NOT NULL DEFAULT '[]',
  clips JSONB NOT NULL DEFAULT '[]',
  audio_prefix TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_days_company ON vault_days(company_id);

ALTER TABLE vault_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reps see their company's and global vault days" ON vault_days;
CREATE POLICY "Reps see their company's and global vault days"
ON vault_days FOR SELECT
TO authenticated
USING (
  visibility = 'global'
  OR company_id = (SELECT up.company_id FROM public.user_profiles up WHERE up.id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role = 'super_admin')
);

-- Private bucket; the app signs URLs with the rep's session
INSERT INTO storage.buckets (id, name, public)
VALUES ('vault-audio', 'vault-audio', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Reps play their company's and global vault audio" ON storage.objects;
CREATE POLICY "Reps play their company's and global vault audio"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'vault-audio'
  AND (
    (storage.foldername(name))[1] = 'global'
    OR (storage.foldername(name))[1] = (SELECT up.company_id::text FROM public.user_profiles up WHERE up.id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role = 'super_admin')
  )
);

-- End of vault-days-migration.sql

-- ============================================================================
-- Vault index: every published day, light enough to load all at once
-- ============================================================================
-- The app used to load only featured days (vault_days.featured), because each day
-- carries every door's full transcript (~95 KB a day). This view gives the app every
-- day with the transcripts left out, except on doors a reel clip plays from (the reels
-- show captions). The app fetches a day's transcripts from vault_days when a rep
-- opens that day.
--
-- security_invoker: the view runs as the rep, so vault_days' RLS still decides
-- what each rep sees.
--
-- Safe to run more than once.
-- ============================================================================

CREATE OR REPLACE VIEW vault_days_index
WITH (security_invoker = true) AS
SELECT
  v.id,
  v.rep_name,
  v.recording_date,
  v.area,
  v.minutes,
  v.clips,
  v.audio_prefix,
  v.featured,
  v.published_at,
  COALESCE((
    SELECT jsonb_agg(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(v.clips) c
          WHERE (c->>'door') = (d->>'n')
        ) THEN d
        ELSE d - 'lines'
      END
      ORDER BY t.ord
    )
    FROM jsonb_array_elements(v.doors) WITH ORDINALITY AS t(d, ord)
  ), '[]'::jsonb) AS doors
FROM vault_days v;

GRANT SELECT ON vault_days_index TO authenticated;

-- End of vault-days-index-view.sql

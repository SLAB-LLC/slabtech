-- ============================================================================
-- Ask Marshall: the app's AI coach, built from a top rep's own pitches
-- ============================================================================
-- Each company gets a coach modeled on its top rep (Ace: Marshall Hawks). The coach
-- answers as that rep, from three things:
--   coach_personas   who the coach is and how they talk and sell (a style guide the
--                    recording pipeline writes from their recorded doors)
--   coach_moments    their tagged objection and close moments, redacted, searched for
--                    each sales question; audio_path points into the vault-audio bucket
--   coach_playbook   the company's business facts (minimums, services, policies, books),
--                    edited by company admins; the coach answers business questions only
--                    from these
-- coach_messages keeps each question, answer and thumbs up/down for review.
--
-- The app calls /api/app/coach with the rep's token, so these policies decide what a
-- rep's coach can see. The pipeline writes personas and moments with the service role.
--
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS coach_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS coach_moments (
  id BIGSERIAL PRIMARY KEY,
  persona_id UUID NOT NULL REFERENCES coach_personas(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  outcome TEXT NOT NULL,
  title TEXT NOT NULL,
  recording_date DATE,
  text TEXT NOT NULL,
  customer_line TEXT NOT NULL DEFAULT '',
  st NUMERIC NOT NULL,
  en NUMERIC NOT NULL,
  audio_path TEXT,
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || text)) STORED
);
CREATE INDEX IF NOT EXISTS idx_coach_moments_persona ON coach_moments(persona_id, tag);
CREATE INDEX IF NOT EXISTS idx_coach_moments_search ON coach_moments USING GIN (search);

CREATE TABLE IF NOT EXISTS coach_playbook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  topic TEXT NOT NULL DEFAULT 'Other',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  sort INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_coach_playbook_company ON coach_playbook(company_id);

CREATE TABLE IF NOT EXISTS coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES coach_personas(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  clip_ids BIGINT[] NOT NULL DEFAULT '{}',
  vote TEXT CHECK (vote IN ('up', 'down')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_messages_company ON coach_messages(company_id, created_at DESC);

ALTER TABLE coach_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_playbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_messages ENABLE ROW LEVEL SECURITY;

-- Members use their own company's coach; SLAB admins see every company's
DROP POLICY IF EXISTS "Members read own company coach" ON coach_personas;
CREATE POLICY "Members read own company coach"
ON coach_personas FOR SELECT
TO authenticated
USING (
  company_id = (SELECT up.company_id FROM public.user_profiles up WHERE up.id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role = 'super_admin')
);

DROP POLICY IF EXISTS "Members read own company coach moments" ON coach_moments;
CREATE POLICY "Members read own company coach moments"
ON coach_moments FOR SELECT
TO authenticated
USING (
  persona_id IN (SELECT id FROM coach_personas)
);

DROP POLICY IF EXISTS "Members read own company playbook" ON coach_playbook;
CREATE POLICY "Members read own company playbook"
ON coach_playbook FOR SELECT
TO authenticated
USING (
  company_id = (SELECT up.company_id FROM public.user_profiles up WHERE up.id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role = 'super_admin')
);

-- Company admins keep their own company's playbook; SLAB admins any company's
DROP POLICY IF EXISTS "Admins manage own company playbook" ON coach_playbook;
CREATE POLICY "Admins manage own company playbook"
ON coach_playbook FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid()
    AND (up.role = 'super_admin' OR (up.role = 'company_admin' AND up.company_id = coach_playbook.company_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid()
    AND (up.role = 'super_admin' OR (up.role = 'company_admin' AND up.company_id = coach_playbook.company_id))
  )
);

-- Reps write and vote on their own messages; their company's admins read them for review
DROP POLICY IF EXISTS "Reps keep their own coach messages" ON coach_messages;
CREATE POLICY "Reps keep their own coach messages"
ON coach_messages FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read company coach messages" ON coach_messages;
CREATE POLICY "Admins read company coach messages"
ON coach_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid()
    AND (up.role = 'super_admin' OR (up.role = 'company_admin' AND up.company_id = coach_messages.company_id))
  )
);

-- A coach's moments best matching a question (any of the words). Only doors they sold teach:
-- on the others a rep often hands out a number just to get off the porch.
-- Runs as the caller, so the policies above still apply.
CREATE OR REPLACE FUNCTION coach_search(p_persona UUID, p_tag TEXT, p_query TEXT, p_limit INT DEFAULT 4)
RETURNS SETOF coach_moments
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.* FROM coach_moments m
  WHERE m.persona_id = p_persona
    AND m.outcome = 'sale'
    AND (p_tag IS NULL OR m.tag = p_tag)
  ORDER BY
    ts_rank(m.search, to_tsquery('english', coalesce(nullif(
      array_to_string(array(SELECT quote_literal(w) FROM regexp_split_to_table(lower(p_query), '[^a-z0-9]+') w
                            WHERE length(w) > 2), ' | '), ''), 'xyzzy'))) DESC,
    m.id
  LIMIT least(p_limit, 8);
$$;

-- End of ask-marshall-migration.sql

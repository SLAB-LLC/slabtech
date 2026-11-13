-- ============================================================================
-- Ask Marshall daily limit: index for the per-rep daily question count
-- ============================================================================
-- /api/app/coach counts a rep's coach_messages since midnight (America/Denver)
-- before calling Claude. The limit works without this; the index keeps the
-- count fast as coach_messages grows. Safe to run more than once.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_coach_messages_user_day ON coach_messages(user_id, created_at DESC);

-- End of coach-daily-limit-index.sql

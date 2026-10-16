-- Create a function to automatically close inactive sessions
-- Call this periodically (e.g., from a cron job or before displaying usage data)

CREATE OR REPLACE FUNCTION auto_close_inactive_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  closed_count INTEGER;
BEGIN
  -- Update sessions where:
  -- 1. Session is marked as active (is_active = true)
  -- 2. Session has no end time (session_end IS NULL)
  -- 3. Last heartbeat was more than 5 minutes ago

  WITH last_heartbeats AS (
    SELECT
      session_id,
      MAX(heartbeat_at) as last_beat
    FROM activity_heartbeats
    GROUP BY session_id
  )
  UPDATE user_sessions us
  SET
    session_end = lh.last_beat,
    is_active = false
  FROM last_heartbeats lh
  WHERE us.id = lh.session_id
    AND us.is_active = true
    AND us.session_end IS NULL
    AND lh.last_beat < NOW() - INTERVAL '5 minutes';

  GET DIAGNOSTICS closed_count = ROW_COUNT;

  RETURN closed_count;
END;
$$;

-- Run it once now to close all currently inactive sessions
SELECT auto_close_inactive_sessions() as "Sessions Closed";

-- Also close any sessions with no heartbeats at all that are older than 1 hour
UPDATE user_sessions
SET
  session_end = session_start + INTERVAL '1 minute',
  is_active = false
WHERE is_active = true
  AND session_end IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM activity_heartbeats
    WHERE activity_heartbeats.session_id = user_sessions.id
  )
  AND session_start < NOW() - INTERVAL '1 hour';

-- Verify: Show all closed sessions (most recent first)
SELECT
  up.email,
  us.session_start,
  us.session_end,
  EXTRACT(EPOCH FROM (us.session_end - us.session_start))/60 as duration_minutes,
  us.is_active
FROM user_sessions us
JOIN user_profiles up ON up.id = us.user_id
WHERE us.session_end IS NOT NULL
ORDER BY us.session_end DESC
LIMIT 10;

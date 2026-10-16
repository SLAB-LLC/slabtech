# Usage Tracking System - Setup Guide

This comprehensive usage tracking system monitors and analyzes user engagement on the Slab Voice platform. It tracks active time spent on the platform, session data, and provides detailed analytics for case study purposes.

## Overview

The system tracks:
- **Active time**: Real active engagement time (not just login duration)
- **Sessions**: When users login and logout
- **Daily/Weekly/Lifetime stats**: Aggregated usage metrics per user
- **Activity events**: Specific actions like transcript views, uploads, audio playback
- **Heartbeat monitoring**: 30-second pings to track genuine active time

## Setup Instructions

### Step 1: Run Database Migration

Execute the migration SQL file in your Supabase SQL Editor:

```bash
# The migration file is located at:
usage-tracking-migration.sql
```

This creates:
- `user_sessions` - Tracks login/logout sessions
- `activity_heartbeats` - Stores heartbeat pings for active time calculation
- `daily_usage_stats` - Pre-aggregated daily statistics per user
- `user_activity_events` - Specific user actions
- Database functions for session management
- Views for easy querying (`user_usage_summary`, `company_usage_summary`, `weekly_usage_stats`)

### Step 2: Verify Tables Created

After running the migration, verify these tables exist in Supabase:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'user_sessions',
    'activity_heartbeats',
    'daily_usage_stats',
    'user_activity_events'
  );
```

### Step 3: Deploy Code Changes

The tracking system has already been integrated into the codebase:

#### Files Created:
1. **Database**
   - `usage-tracking-migration.sql` - Database schema and functions

2. **Hooks**
   - `src/hooks/useActivityTracking.ts` - React hook for client-side tracking

3. **API Endpoints**
   - `src/app/api/activity/session/route.ts` - Session management
   - `src/app/api/activity/heartbeat/route.ts` - Heartbeat recording
   - `src/app/api/activity/event/route.ts` - Event tracking

4. **Dashboards**
   - `src/app/(admin)/usage-analytics/page.tsx` - Super admin dashboard
   - `src/app/c/[slug]/usage/page.tsx` - Company admin dashboard
   - `src/app/(admin)/users/[id]/usage/page.tsx` - Individual user details

5. **Components**
   - `src/components/ActivityTrackingProvider.tsx` - Auto-tracking wrapper

#### Files Modified:
- `src/app/(admin)/layout.tsx` - Added activity tracking
- `src/app/c/[slug]/layout.tsx` - Added activity tracking
- `src/app/(admin)/admin/page.tsx` - Added usage analytics link
- `src/components/CompanyNav.tsx` - Added usage link for company admins
- `src/components/index.ts` - Exported ActivityTrackingProvider

### Step 4: Deploy and Test

1. Deploy your Next.js application with the new changes
2. Login as a super admin
3. Navigate to the Usage Analytics page from the admin panel
4. The system will automatically start tracking your activity

## How It Works

### Automatic Tracking

Once deployed, the system automatically:

1. **Creates a session** when a user logs in
2. **Sends heartbeat pings** every 30 seconds when the user is active
3. **Tracks audio playback** - Automatically detects when users are listening to audio
4. **Pauses tracking** after 2 minutes of inactivity (UNLESS audio is playing)
5. **Ends the session** in two ways:
   - **On Logout**: Automatically when user clicks logout button
   - **Auto-Close**: Sessions with no heartbeat for 5+ minutes are auto-closed

### Active Time Calculation

The system calculates active time using heartbeat intervals:
- Heartbeats sent every 30 seconds during activity
- If gap between heartbeats > 2 minutes, user was inactive
- Only counts genuine active time, not idle time

### Audio Playback Tracking

**Critical for your use case:** The system automatically detects and tracks audio listening:
- Detects when ANY `<audio>` element on the page starts playing
- Keeps the user marked as "active" while audio is playing
- Continues sending heartbeats with `activity_type: 'audio_playing'`
- Prevents the 2-minute inactivity timeout during audio playback
- Tracks audio play, pause, and completion events
- Works with dynamically loaded audio elements

**This means:** Users listening to training audio will be correctly tracked as active, even if they're not moving their mouse or keyboard. Their listening time counts toward their total active time.

### Session Management

Sessions are automatically managed to ensure accurate tracking:

**Session Start:**
- Created when user logs in or first activity is detected
- Stored in sessionStorage to persist across page refreshes
- Includes IP address and user agent for security

**Session End (Two Methods):**
1. **On Logout** (Immediate):
   - Activity tracking hook listens for auth state changes
   - Automatically calls `end_user_session()` when logout is detected
   - Session marked as `is_active = false` and `session_end` timestamp set

2. **Auto-Close Inactive Sessions** (Background):
   - Function `auto_close_inactive_sessions()` runs when usage dashboards load
   - Closes any session with no heartbeat in the last 5 minutes
   - Handles cases where user closes browser without logging out
   - Sets `session_end` to timestamp of last heartbeat

**Why Two Methods?**
- Logout provides immediate, accurate session end time
- Auto-close catches abandoned sessions (browser crash, force close, etc.)
- Ensures all sessions eventually close for accurate reporting

### Data Aggregation

Daily stats are updated automatically via the `update_daily_usage_stats()` function:
- Can be called manually or set up as a cron job
- Aggregates heartbeats into total active minutes
- Updates session counts, transcript views, etc.

## Accessing Analytics

### For Super Admins

Navigate to: `/usage-analytics`

Features:
- View all users across all companies
- Filter and sort by time period (7d, 30d, lifetime)
- See company-level aggregations
- Drill down into individual users

### For Company Admins

Navigate to: `/c/[company-slug]/usage`

Features:
- View users in their company only
- Filter active/inactive users
- Summary statistics for the company
- Drill down into individual users

### Individual User Details

Navigate to: `/users/[user-id]/usage`

Features:
- Lifetime usage statistics
- Weekly breakdown
- Daily activity logs
- Recent session history
- Charts and trends

## Key Metrics

### User-Level Metrics
- **Lifetime Active Minutes**: Total time actively engaged on platform (includes audio listening time)
- **Total Days Active**: Number of unique days user was active
- **Average per Active Day**: Average minutes per day when active
- **Session Count**: Total number of login sessions
- **Last Active Date**: Most recent activity
- **Audio Listen Minutes**: Time spent listening to audio specifically (tracked separately)
- **Transcript Views**: Number of times transcripts were viewed
- **Uploads**: Number of audio files uploaded

### Company-Level Metrics
- **Total Users**: All users in company
- **Active Users**: Users with activity in time period
- **Total Active Time**: Sum of all user active time
- **Average per User**: Mean active time across users

## Manual Data Queries

### Get user's daily usage for last 30 days
```sql
SELECT * FROM daily_usage_stats
WHERE user_id = 'USER_UUID'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;
```

### Get company usage summary
```sql
SELECT * FROM company_usage_summary
WHERE company_id = 'COMPANY_UUID';
```

### Get all users' summary stats
```sql
SELECT * FROM user_usage_summary
ORDER BY last_7_days_active_minutes DESC;
```

### Manual daily stats update (if needed)
```sql
-- Update stats for a specific user and date
SELECT update_daily_usage_stats('USER_UUID', '2026-01-15');

-- Update stats for today for all active users
DO $$
DECLARE
  user_record RECORD;
BEGIN
  FOR user_record IN
    SELECT DISTINCT user_id
    FROM activity_heartbeats
    WHERE heartbeat_at >= CURRENT_DATE
  LOOP
    PERFORM update_daily_usage_stats(user_record.user_id, CURRENT_DATE);
  END LOOP;
END $$;
```

## Maintenance

### Cleanup Old Heartbeats

The database includes a cleanup function to prevent table bloat:

```sql
-- Delete heartbeats older than 90 days
SELECT cleanup_old_heartbeats();
```

Recommend setting this up as a weekly cron job in Supabase.

### Monitor Table Sizes

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('activity_heartbeats', 'user_sessions', 'daily_usage_stats')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Troubleshooting

### Users Not Being Tracked

1. Check browser console for API errors
2. Verify Supabase RLS policies allow inserts
3. Check that ActivityTrackingProvider is in the layout
4. Ensure user is authenticated

### Missing Data in Dashboards

1. Run manual daily stats update:
   ```sql
   SELECT update_daily_usage_stats(user_id, CURRENT_DATE);
   ```
2. Check that heartbeats are being recorded in `activity_heartbeats` table
3. Verify database views exist and have correct permissions

### High Database Usage

1. Run heartbeat cleanup:
   ```sql
   SELECT cleanup_old_heartbeats();
   ```
2. Consider adjusting heartbeat interval (increase from 30s to 60s)
3. Archive old daily_usage_stats to a separate table

## Export Data for Case Study

### Export all user usage to CSV

```sql
COPY (
  SELECT
    email,
    display_name,
    company_name,
    lifetime_active_minutes / 60.0 AS lifetime_hours,
    total_days_active,
    avg_minutes_per_active_day,
    last_7_days_active_minutes / 60.0 AS last_7_days_hours,
    last_30_days_active_minutes / 60.0 AS last_30_days_hours
  FROM user_usage_summary
  ORDER BY lifetime_active_minutes DESC
) TO '/tmp/user_usage_export.csv' WITH CSV HEADER;
```

### Export daily breakdown

```sql
COPY (
  SELECT
    up.email,
    up.display_name,
    dus.date,
    dus.total_active_minutes,
    dus.session_count,
    dus.transcript_views,
    dus.uploads_count
  FROM daily_usage_stats dus
  JOIN user_profiles up ON up.id = dus.user_id
  WHERE dus.date >= '2026-01-01'
  ORDER BY dus.date DESC, up.email
) TO '/tmp/daily_usage_export.csv' WITH CSV HEADER;
```

## Privacy & Compliance

- All tracking is for authenticated users only
- No personally identifiable information beyond email is stored
- IP addresses are stored for session security only
- Users can view their own usage data
- Data can be deleted via user account deletion

## Support

For issues or questions:
1. Check the database logs in Supabase
2. Review API endpoint responses in browser dev tools
3. Verify RLS policies are correctly set up
4. Check that all database functions exist

---

**Ready to Use!** The system is now set up and will automatically track user engagement. Check the dashboards to see your data.

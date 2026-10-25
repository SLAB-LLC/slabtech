import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createServerClient } from '@supabase/supabase-js';

/**
 * POST /api/activity/heartbeat
 * Record a heartbeat ping to track active time
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sessionId, pagePath, activityType = 'page_active', metadata = {} } = body;

    if (!sessionId || !pagePath) {
      return NextResponse.json(
        { error: 'Session ID and page path required' },
        { status: 400 }
      );
    }

    // Validate activity type
    const validActivityTypes = ['page_active', 'audio_playing', 'video_playing', 'transcript_viewing', 'upload_activity'];
    if (!validActivityTypes.includes(activityType)) {
      return NextResponse.json(
        { error: 'Invalid activity type' },
        { status: 400 }
      );
    }

    // Record heartbeat using database function
    const record = (type: string) => supabase.rpc('record_activity_heartbeat', {
      p_session_id: sessionId,
      p_page_path: pagePath,
      p_activity_type: type,
      p_metadata: metadata,
    });
    let { data, error } = await record(activityType);

    // Before sql/usage-report-migration.sql runs, the table rejects 'video_playing'
    if (error && activityType === 'video_playing') {
      ({ data, error } = await record('page_active'));
    }

    if (error) {
      console.error('Error recording heartbeat:', error);
      return NextResponse.json(
        { error: 'Failed to record heartbeat' },
        { status: 500 }
      );
    }

    // Auto-update daily stats for today (keeps dashboard current)
    // Use service role client to bypass RLS for aggregation
    // Run this in background - don't wait for it or fail if it errors
    const supabaseAdmin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    supabaseAdmin.rpc('update_daily_usage_stats', {
      p_user_id: user.id,
      p_date: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD
    }).then(({ error: statsError }) => {
      if (statsError) {
        console.warn('Failed to update daily stats:', statsError);
      }
    });

    return NextResponse.json({ heartbeatId: data, success: true });
  } catch (error) {
    console.error('Heartbeat recording error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

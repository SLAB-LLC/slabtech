import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { sendPush } from '@/utils/push'

/**
 * Leaderboard rank-drop pushes (sql/rank-drop-alerts-migration.sql).
 *
 * The database writes an alert whenever someone knocks a rep down inside their company's top 3 or off
 * it. The app calls this right after it grants XP (that grant is what moves the board), with the rep's
 * Supabase access token, and this sends every pending alert in SLAB, not just the caller's company.
 * Claiming is atomic, so two calls never push the same alert twice.
 *
 * POST -> { sent: number, alerts: number }
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.rpc('claim_rank_alert_pushes', { p_limit: 100 })
    if (error) throw error
    const alerts = (data ?? []) as { id: string; user_id: string; new_rank: number | null; title: string; body: string }[]

    let sent = 0
    for (const a of alerts) {
      const res = await sendPush(service, {
        userIds: [a.user_id],
        title: a.title,
        body: a.body,
        // sendPush skips reps who turned notification_preferences.rank_alerts off
        category: 'rank_alerts',
        data: { alertId: a.id, screen: 'leaderboard' },
      })
      sent += res.sent
    }
    return NextResponse.json({ sent, alerts: alerts.length })
  } catch (error) {
    console.error('POST /api/app/rank-alerts:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

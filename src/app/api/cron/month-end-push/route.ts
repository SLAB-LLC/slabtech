import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { sendPush } from '@/utils/push'
import { REPORT_TZ } from '@/utils/reports/monthlyReport'

export const maxDuration = 60

/**
 * GET /api/cron/month-end-push - Daily Vercel cron at 00:00 UTC (5-6 PM Mountain the day before).
 * Sends on the 25th and on the last day of the month, Mountain time; other days do nothing.
 * Every active rep with the app gets a countdown with their spot on the company board
 * (sql/engagement-nudges-migration.sql). Reps who turned off leaderboard alerts are skipped.
 * ?force=1 sends today regardless of the date (for testing; still needs CRON_SECRET).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: REPORT_TZ })
  const [y, m, d] = today.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const daysLeft = lastDay - d + 1 // counting today
  const force = request.nextUrl.searchParams.get('force') === '1'
  if (!force && d !== 25 && d !== lastDay) return NextResponse.json({ skipped: today })
  const monthName = new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })

  const service = createServiceRoleClient()
  const [{ data: reps, error }, { data: board, error: boardError }] = await Promise.all([
    service.from('user_profiles').select('id, company_id, companies(name)').eq('is_active', true).in('role', ['user', 'manager']).not('company_id', 'is', null),
    service.rpc('company_board_positions'),
  ])
  if (error || boardError) {
    console.error('[month-end-push] load failed:', error || boardError)
    return NextResponse.json({ error: 'Load failed' }, { status: 500 })
  }
  const spots = new Map(
    ((board ?? []) as { user_id: string; rank: number; gap_to_next: number | null; board_size: number }[]).map((b) => [b.user_id, b])
  )

  // Group reps by message so each push batch is one call
  const groups = new Map<string, { title: string; body: string; ids: string[] }>()
  const left = daysLeft === 1 ? 'Last day' : `${daysLeft} days left`
  for (const r of (reps ?? []) as { id: string; companies: { name: string } | { name: string }[] | null }[]) {
    const c = Array.isArray(r.companies) ? r.companies[0] : r.companies
    const company = String(c?.name || '').trim()
    const board = company ? `the ${company} board` : 'the board'
    const spot = spots.get(r.id)
    let title: string
    let body: string
    if (!spot) {
      title = `${left} in ${monthName}`
      body = `You're not on ${board} yet. One lesson or a few minutes in the Vault gets you on it.`
    } else if (spot.rank === 1) {
      title = `${left} in ${monthName}: you're #1`
      body = `Hold the top spot on ${board}. Keep stacking XP before the month closes.`
    } else {
      title = `${left} in ${monthName}: you're #${spot.rank}`
      body = `${spot.gap_to_next ?? 1} XP passes #${spot.rank - 1} on ${board}. Go get it.`
    }
    const key = `${title}\u0000${body}`
    const g = groups.get(key) ?? { title, body, ids: [] }
    g.ids.push(r.id)
    groups.set(key, g)
  }

  let sent = 0
  for (const g of groups.values()) {
    try {
      const res = await sendPush(service, { userIds: g.ids, title: g.title, body: g.body, category: 'rank_alerts', data: { screen: 'leaderboard' } })
      sent += res.sent
    } catch (e) {
      console.error('[month-end-push] send failed:', e)
    }
  }
  return NextResponse.json({ day: today, daysLeft, reps: reps?.length ?? 0, sent })
}

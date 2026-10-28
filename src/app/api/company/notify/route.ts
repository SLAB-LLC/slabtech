import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { sendPush } from '@/utils/push'

/**
 * Announcements, nudges and shout-outs from the app's Owner view and My Team.
 * The app sends its Supabase access token as a bearer token (no website cookie).
 *
 * POST { title, body, to: 'all' | 'team' | 'rep', teamId?, repId? }
 *   Owners and SLAB admins can reach anyone in their company; managers reach
 *   their own team or one rep on it.
 * GET  the company's last announcements, newest first (owners)
 */

interface Caller {
  id: string
  role: string
  company_id: string
}

async function getCaller(request: NextRequest): Promise<Caller | NextResponse> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: me } = await service.from('user_profiles').select('id, role, company_id').eq('id', user.id).single()
  if (!me?.company_id || !['company_admin', 'super_admin', 'manager'].includes(me.role)) {
    return NextResponse.json({ error: 'Only owners and managers can send these' }, { status: 403 })
  }
  return me as Caller
}

export async function POST(request: NextRequest) {
  try {
    const me = await getCaller(request)
    if (me instanceof NextResponse) return me
    const service = createServiceRoleClient()

    const { title, body, to = 'all', teamId, repId } = await request.json()
    const t = String(title || '').trim().slice(0, 60)
    const b = String(body || '').trim().slice(0, 240)
    if (!t || !b) return NextResponse.json({ error: 'Add a title and a message' }, { status: 400 })

    const owner = me.role !== 'manager'
    const { data: myTeams } = await service.from('teams').select('id').eq('company_id', me.company_id).eq('manager_id', me.id)
    const managed = new Set((myTeams ?? []).map((x) => x.id))

    let query = service.from('user_profiles').select('id, team_id').eq('company_id', me.company_id).eq('is_active', true).neq('id', me.id)
    if (to === 'team') {
      if (!teamId || (!owner && !managed.has(teamId))) return NextResponse.json({ error: 'Pick one of your teams' }, { status: 403 })
      query = query.eq('team_id', teamId)
    } else if (to === 'rep') {
      if (!repId) return NextResponse.json({ error: 'Pick a rep' }, { status: 400 })
      query = query.eq('id', repId)
    } else if (!owner) {
      return NextResponse.json({ error: 'Managers send to their own team' }, { status: 403 })
    }
    const { data: people, error } = await query
    if (error) throw error
    const recipients = (people ?? []).filter((p) => owner || managed.has(p.team_id))
    if (recipients.length === 0) return NextResponse.json({ error: 'Nobody to send that to' }, { status: 400 })

    const targetType = to === 'rep' ? 'user' : to === 'team' ? 'team' : 'company'
    const targetId = to === 'rep' ? repId : to === 'team' ? teamId : me.company_id
    const { data: row, error: rowErr } = await service
      .from('broadcasts')
      .insert({ sent_by: me.id, title: t, body: b, category: 'company_alerts', target_type: targetType, target_id: targetId })
      .select('id')
      .single()
    if (rowErr) throw rowErr

    const result = await sendPush(service, {
      userIds: recipients.map((p) => p.id),
      title: t,
      body: b,
      category: 'company_alerts',
      data: { broadcast_id: row.id },
    })
    const { error: logErr } = await service.from('notification_log').insert({
      sent_by: me.id, title: t, body: b, category: 'company_alerts', target_type: targetType, target_id: targetId,
      recipient_count: result.sent, broadcast_id: row.id,
    })
    if (logErr) console.error('notification_log insert failed:', logErr.message)

    return NextResponse.json({ reach: recipients.length, sent: result.sent, broadcast_id: row.id })
  } catch (err) {
    console.error('Company notify failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const me = await getCaller(request)
    if (me instanceof NextResponse) return me
    if (me.role === 'manager') return NextResponse.json({ sent: [] })
    const service = createServiceRoleClient()
    const { data: senders } = await service.from('user_profiles').select('id').eq('company_id', me.company_id)
    const { data: rows, error } = await service
      .from('broadcasts')
      .select('id, title, body, target_type, target_id, created_at')
      .eq('category', 'company_alerts')
      .in('sent_by', (senders ?? []).map((s) => s.id))
      .order('created_at', { ascending: false })
      .limit(15)
    if (error) throw error
    return NextResponse.json({ sent: rows ?? [] })
  } catch (err) {
    console.error('Company notify history failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 })
  }
}

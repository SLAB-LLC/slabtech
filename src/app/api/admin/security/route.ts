import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { requireSuperAdmin } from '@/utils/security/superAdmin'

// Login-sharing review for SLAB super admins (the /security page).
// Detection lives in sql/login-sharing-protection.sql.

// GET /api/admin/security - flagged/locked accounts, plus recent sign-ins that overlapped
export async function GET() {
  if (!(await requireSuperAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()

  const since = new Date(Date.now() - 14 * 86400_000).toISOString()
  const [{ data: flags, error }, { data: overlaps }] = await Promise.all([
    service.from('account_security_flags').select('*').order('last_event_at', { ascending: false }).limit(200),
    service
      .from('login_events')
      .select('user_id, created_at, ip, device, other_ip, other_device')
      .eq('overlap', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  if (error) {
    return NextResponse.json({ error: 'Run sql/login-sharing-protection.sql first', details: error.message }, { status: 500 })
  }

  const ids = Array.from(new Set([...(flags ?? []).map((f) => f.user_id), ...(overlaps ?? []).map((o) => o.user_id)]))
  const [{ data: profiles }, { data: events }] = ids.length
    ? await Promise.all([
        service.from('user_profiles').select('id, email, display_name, role, shared_login_ok, companies(name)').in('id', ids),
        service
          .from('login_events')
          .select('user_id, created_at, ip, device, overlap, signed_out_others')
          .in('user_id', ids)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1000),
      ])
    : [{ data: [] }, { data: [] }]

  const people = Object.fromEntries(
    (profiles ?? []).map((p: any) => [
      p.id,
      {
        email: p.email,
        name: p.display_name,
        role: p.role,
        sharedLoginOk: p.shared_login_ok,
        company: Array.isArray(p.companies) ? p.companies[0]?.name ?? null : p.companies?.name ?? null,
        logins: (events ?? []).filter((e: any) => e.user_id === p.id).slice(0, 20),
      },
    ])
  )
  return NextResponse.json({ flags: flags ?? [], overlaps: overlaps ?? [], people })
}

const ACTIONS = ['clear', 'signout', 'lock', 'unlock', 'exempt', 'unexempt'] as const
type Action = (typeof ACTIONS)[number]

// POST /api/admin/security { userId, action, note? }
//   clear     - reviewed, looks fine (a new pattern flags it again)
//   signout   - signs the account out on every device
//   lock      - signs out everywhere and blocks sign-in until unlocked
//   unlock    - allows sign-in again
//   exempt    - allow this login on several devices at once (e.g. a demo login SLAB shares)
//   unexempt  - back to one device at a time
export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId : ''
  const action = body.action as Action
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null
  if (!userId || !ACTIONS.includes(action)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data: target } = await service.from('user_profiles').select('id, role').eq('id', userId).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (target.role === 'super_admin' && (action === 'lock' || action === 'signout')) {
    return NextResponse.json({ error: 'Super admins can’t be locked here' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const review = { reviewed_by: admin.id, reviewed_at: now, ...(note ? { note } : {}) }
  const setFlag = (status: 'cleared' | 'locked', extra: Record<string, unknown> = {}) =>
    service.from('account_security_flags').upsert({ user_id: userId, status, last_event_at: now, ...review, ...extra }, { onConflict: 'user_id' })

  try {
    switch (action) {
      case 'clear': {
        const { error } = await service.from('account_security_flags').update({ status: 'cleared', ...review }).eq('user_id', userId)
        if (error) throw error
        break
      }
      case 'signout': {
        const { error } = await service.rpc('security_sign_out_user', { p_user_id: userId })
        if (error) throw error
        break
      }
      case 'lock': {
        const { error: banError } = await service.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
        if (banError) throw banError
        const { error } = await service.rpc('security_sign_out_user', { p_user_id: userId })
        if (error) throw error
        const { error: flagError } = await setFlag('locked', { reason: 'Locked by SLAB' })
        if (flagError) throw flagError
        break
      }
      case 'unlock': {
        const { error: banError } = await service.auth.admin.updateUserById(userId, { ban_duration: 'none' })
        if (banError) throw banError
        const { error } = await setFlag('cleared')
        if (error) throw error
        break
      }
      case 'exempt':
      case 'unexempt': {
        const { error } = await service.from('user_profiles').update({ shared_login_ok: action === 'exempt' }).eq('id', userId)
        if (error) throw error
        break
      }
    }
  } catch (err: any) {
    console.error('[security] action failed:', action, userId, err)
    return NextResponse.json({ error: err?.message || 'Action failed' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

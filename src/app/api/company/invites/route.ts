import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'
import { assignableRoles, COMPANY_ROLES, isLevel } from '@/utils/users/roles'
import { accountErrorResponse, companyFor } from '@/utils/users/accounts'

/**
 * POST /api/company/invites
 * Create a new company invite
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user role and company
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['company_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { email, role = 'user', level = 'rookie', companyId } = body

  // Validate email
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Same role rules as creating an account directly (src/utils/users/accounts.ts)
  if (!(COMPANY_ROLES as string[]).includes(role) || !assignableRoles(profile.role).includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (!isLevel(level)) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }
  let targetCompanyId: string
  try {
    targetCompanyId = companyFor({ id: user.id, role: profile.role, company_id: profile.company_id }, companyId)
  } catch (err) {
    const { body, status } = accountErrorResponse(err)
    return NextResponse.json(body, { status })
  }

  // Use service role to create invite
  const serviceSupabase = createServiceRoleClient()

  // Generate secure token
  const token = crypto.randomUUID() + '-' + Date.now()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const { data: invite, error } = await serviceSupabase
    .from('company_invites')
    .insert({
      company_id: targetCompanyId,
      email,
      role,
      level,
      token,
      expires_at: expiresAt.toISOString(),
      invited_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create invite:', error)

    // Check for unique constraint violation
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'An invite already exists for this email' },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
  }

  // Build invite URL
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const inviteUrl = `${baseUrl}/invite/${token}`

  return NextResponse.json({
    success: true,
    inviteUrl,
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
    },
  })
}

/**
 * GET /api/company/invites
 * List all invites for the current user's company
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user role
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['company_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch invites for this company
  const { data: invites, error } = await supabase
    .from('company_invites')
    .select('id, email, role, created_at, expires_at, accepted, accepted_at')
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch invites:', error)
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 })
  }

  return NextResponse.json({ invites })
}

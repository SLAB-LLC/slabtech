import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { NextRequest, NextResponse } from 'next/server'
import { provisionAccount } from '@/utils/users/accounts'

/**
 * POST /api/invite/[token]/accept
 * Accept an invite and create a new user account
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const supabase = createServiceRoleClient()
  const body = await request.json()
  const { password, displayName } = body
  const { token } = await params

  // Validate input
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  if (!displayName || displayName.trim().length === 0) {
    return NextResponse.json({ error: 'Display name is required' }, { status: 400 })
  }

  // Get invite
  const { data: invite, error: inviteError } = await supabase
    .from('company_invites')
    .select('*')
    .eq('token', token)
    .eq('accepted', false)
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
  }

  // Check if invite has expired
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invite has expired' }, { status: 400 })
  }

  try {
    // Same account setup as owners and admins use (src/utils/users/accounts.ts)
    const newUser = await provisionAccount({
      email: invite.email,
      password,
      displayName: displayName.trim(),
      role: invite.role,
      level: invite.level || 'rookie',
      companyId: invite.company_id,
    })
    const authData = { user: newUser }

    // Mark invite as accepted
    const { error: updateError } = await supabase
      .from('company_invites')
      .update({
        accepted: true,
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: authData.user.id,
      })
      .eq('id', invite.id)

    if (updateError) {
      console.error('Failed to mark invite as accepted:', updateError)
      // Don't fail the request, user was created successfully
    }

    return NextResponse.json({
      success: true,
      message: 'Account created successfully',
    })
  } catch (error) {
    console.error('Unexpected error accepting invite:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

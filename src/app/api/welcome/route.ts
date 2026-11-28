import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { readSignInToken, tokenMatches } from '@/utils/nudges/signInLink'

// POST { token, password } - A rep who never signed in picks their password from the
// sign-in email (/welcome/[token]). The link works once.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const password = typeof body?.password === 'string' ? body.password : ''
  const parsed = readSignInToken(body?.token)
  if (!parsed) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Use at least 8 characters.' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data: profile } = await service
    .from('user_profiles')
    .select('id, sign_in_nudged_at, is_active')
    .eq('id', parsed.userId)
    .single()
  if (!profile || profile.is_active === false || !tokenMatches(parsed.nudgedAtMs, profile.sign_in_nudged_at)) {
    return NextResponse.json({ error: 'This link was already used or a newer one was sent.' }, { status: 400 })
  }

  // Clear first so the link can't be used twice, even by two requests at once
  const { data: claimed } = await service
    .from('user_profiles')
    .update({ sign_in_nudged_at: null })
    .eq('id', profile.id)
    .eq('sign_in_nudged_at', profile.sign_in_nudged_at)
    .select('id')
  if (!claimed?.length) return NextResponse.json({ error: 'This link was already used.' }, { status: 400 })

  const { error } = await service.auth.admin.updateUserById(profile.id, { password })
  if (error) {
    // Put the link back so they can try a different password
    await service.from('user_profiles').update({ sign_in_nudged_at: profile.sign_in_nudged_at }).eq('id', profile.id)
    return NextResponse.json({ error: error.message || 'Could not set that password.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

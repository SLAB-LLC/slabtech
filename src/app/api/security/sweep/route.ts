import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { sendLoginSharingAlerts } from '@/utils/security/loginAlerts'

// GET /api/security/sweep - Daily Vercel cron (vercel.json). Emails any login-sharing flag
// that wasn't emailed at sign-in time (for example when the mail service was down).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sent = await sendLoginSharingAlerts(createServiceRoleClient())
  return NextResponse.json({ sent })
}

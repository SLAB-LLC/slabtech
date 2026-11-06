import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { accountErrorResponse, getManagingActor, setAccountPassword } from '@/utils/users/accounts'

// POST /api/company/users/[id]/password - An owner (or SLAB admin) sets a new password for a rep who forgot theirs.
// Same rules as every other account change: src/utils/users/accounts.ts
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const actor = await getManagingActor(supabase)
    const { password } = await request.json()
    await setAccountPassword(actor, id, password)
    return NextResponse.json({ success: true })
  } catch (error) {
    const { body, status } = accountErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

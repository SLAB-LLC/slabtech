import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { accountErrorResponse, getManagingActor, updateAccount } from '@/utils/users/accounts'

// PATCH /api/company/users/[id] - An owner (or SLAB admin) changes an account: active, role, level, name.
// Same rules as the admin pages: src/utils/users/accounts.ts
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const actor = await getManagingActor(supabase)
    const body = await request.json()
    // Moving people between companies stays on the admin pages
    delete body.company_id
    await updateAccount(actor, id, body)
    return NextResponse.json({ success: true })
  } catch (error) {
    const { body, status } = accountErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

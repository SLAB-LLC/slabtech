import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { accountErrorResponse, createAccount, getManagingActor } from '@/utils/users/accounts'

// POST /api/company/users - An owner (or SLAB admin) creates an account in a company.
// Same rules as the admin pages: src/utils/users/accounts.ts
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const actor = await getManagingActor(supabase)
    const body = await request.json()
    const user = await createAccount(actor, {
      email: body.email,
      password: body.password,
      displayName: body.display_name ?? body.displayName,
      role: body.role,
      level: body.level,
      companyId: body.company_id ?? body.companyId,
    })
    return NextResponse.json({ success: true, user: { id: user.id, email: user.email } })
  } catch (error) {
    const { body, status } = accountErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

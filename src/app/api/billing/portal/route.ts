import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { AccountError, accountErrorResponse, companyFor, getManagingActor } from '@/utils/users/accounts'
import { getStripe } from '@/utils/stripe'

// POST /api/billing/portal - Sends an owner to Stripe's billing portal (invoices,
// receipts, bank account / card). Works from a plain <form method="POST">.
export async function POST(request: NextRequest) {
  try {
    const actor = await getManagingActor(await createClient())
    const form = (request.headers.get('content-type') || '').includes('form') ? await request.formData() : null
    const companyId = companyFor(actor, (form?.get('company_id') as string | null) || null)

    const { data: company } = await createServiceRoleClient()
      .from('companies')
      .select('slug, stripe_customer_id')
      .eq('id', companyId)
      .single()
    if (!company?.stripe_customer_id) {
      return NextResponse.json({ error: 'Billing is not set up for this company yet' }, { status: 400 })
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin
    const session = await getStripe().billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${origin}/c/${company.slug}/billing`,
    })
    return NextResponse.redirect(session.url, 303)
  } catch (error) {
    if (error instanceof AccountError) {
      const { body, status } = accountErrorResponse(error)
      return NextResponse.json(body, { status })
    }
    console.error('Stripe portal error:', error)
    return NextResponse.json({ error: 'Could not open billing' }, { status: 500 })
  }
}

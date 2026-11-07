import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { AccountError, accountErrorResponse, companyFor, getManagingActor } from '@/utils/users/accounts'
import { getStripe } from '@/utils/stripe'

// POST /api/billing/checkout - An owner (or SLAB admin) starts the company's monthly
// subscription on Stripe's hosted checkout page. Works from a plain
// <form method="POST" action="/api/billing/checkout">; SLAB admins can pass company_id.
// Stripe redirects back to the company dashboard; the webhook saves the result.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const actor = await getManagingActor(supabase)

    let requested: string | null = null
    const type = request.headers.get('content-type') || ''
    if (type.includes('application/json')) {
      requested = (await request.json().catch(() => ({})))?.company_id ?? null
    } else if (type.includes('form')) {
      requested = ((await request.formData()).get('company_id') as string | null) || null
    }
    const companyId = companyFor(actor, requested)

    const service = createServiceRoleClient()
    const { data: company } = await service
      .from('companies')
      .select('id, slug, name, billing_email, stripe_customer_id, billing_start_date')
      .eq('id', companyId)
      .single()
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    // Platform fee (flat monthly) plus, if set, the metered per-rep audio day price
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: process.env.STRIPE_PRICE_PLATFORM || 'price_...', quantity: 1 },
    ]
    if (process.env.STRIPE_PRICE_AUDIO_DAY) lineItems.push({ price: process.env.STRIPE_PRICE_AUDIO_DAY })

    const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin
    const back = `${origin}/c/${company.slug}/billing`

    // Free until billing_start_date (Ace: 2027-01-01): Stripe saves the payment method
    // now and sends the first invoice on that date. Stripe needs it at least 2 days out.
    const startsAt = company.billing_start_date ? Date.parse(`${company.billing_start_date}T07:00:00Z`) : 0
    const trialEnd = startsAt > Date.now() + 2 * 86400_000 ? Math.floor(startsAt / 1000) : undefined

    const session = await getStripe().checkout.sessions.create({
      ui_mode: 'hosted_page',
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${back}?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}?billing=cancelled`,
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      payment_method_collection: 'always',
      submit_type: 'auto',
      integration_identifier: 'hosted_web_0001',
      origin_context: 'web',
      client_reference_id: company.id,
      ...(company.stripe_customer_id
        ? { customer: company.stripe_customer_id }
        : company.billing_email
          ? { customer_email: company.billing_email }
          : {}),
      subscription_data: { metadata: { company_id: company.id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
      metadata: { company_id: company.id },
    })

    if (!session.url) return NextResponse.json({ error: 'Stripe did not return a checkout link' }, { status: 502 })
    return NextResponse.redirect(session.url, 303)
  } catch (error) {
    if (error instanceof AccountError) {
      const { body, status } = accountErrorResponse(error)
      return NextResponse.json(body, { status })
    }
    console.error('Stripe checkout error:', error)
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 })
  }
}

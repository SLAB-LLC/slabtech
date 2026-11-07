import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { getStripe } from '@/utils/stripe'

// POST /api/billing/webhook - Stripe tells us when a company's subscription starts or ends.
// Add this URL in Stripe (Developers > Webhooks) with the events below, and put its
// signing secret in STRIPE_WEBHOOK_SECRET.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get('stripe-signature')
  if (!secret || !signature) return NextResponse.json({ error: 'Not configured' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), signature, secret)
  } catch (err) {
    console.error('Stripe webhook signature failed:', err)
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const companyId = session.client_reference_id || session.metadata?.company_id
      if (!companyId) break
      const { error } = await service
        .from('companies')
        .update({
          stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          stripe_subscription_id:
            typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null,
          billing_status: 'active',
          ...(session.customer_details?.email ? { billing_email: session.customer_details.email } : {}),
        })
        .eq('id', companyId)
      // Usage billing starts today unless a start date was already set (e.g. Ace: 2027-01-01)
      if (!error) {
        await service
          .from('companies')
          .update({ billing_start_date: new Date().toISOString().slice(0, 10) })
          .eq('id', companyId)
          .is('billing_start_date', null)
      }
      if (error) {
        console.error('Saving Stripe checkout failed:', error)
        return NextResponse.json({ error: 'Save failed' }, { status: 500 })
      }
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      await service.from('companies').update({ billing_status: 'cancelled' }).eq('stripe_subscription_id', sub.id)
      break
    }
  }

  return NextResponse.json({ received: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { getStripe } from '@/utils/stripe'

export const maxDuration = 60

// GET /api/billing/report-usage - Daily Vercel cron (vercel.json). Counts new billable
// rep audio days (sql/stripe-usage-migration.sql) and sends each one to the Stripe
// meter, so it lands on the company's next invoice. Safe to run any number of times.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()
  const { data: counted, error: countError } = await service.rpc('collect_billable_audio_days')
  if (countError) {
    console.error('Counting audio days failed:', countError)
    return NextResponse.json({ error: 'Count failed' }, { status: 500 })
  }

  const { data: rows, error } = await service
    .from('billing_audio_days')
    .select('id, counted_at, companies!inner(stripe_customer_id)')
    .is('reported_at', null)
    .order('counted_at')
    .limit(500)
  if (error) {
    console.error('Loading audio days failed:', error)
    return NextResponse.json({ error: 'Load failed' }, { status: 500 })
  }

  const stripe = getStripe()
  const eventName = process.env.STRIPE_METER_EVENT || 'rep_audio_days'
  let reported = 0
  const failed: string[] = []

  for (const row of rows ?? []) {
    const customer = (row.companies as unknown as { stripe_customer_id: string | null })?.stripe_customer_id
    if (!customer) continue
    try {
      await stripe.billing.meterEvents.create({
        event_name: eventName,
        identifier: row.id, // Stripe ignores a repeat of the same identifier
        payload: { stripe_customer_id: customer, value: '1' },
      })
      await service.from('billing_audio_days').update({ reported_at: new Date().toISOString() }).eq('id', row.id)
      reported++
    } catch (err) {
      console.error('Stripe meter event failed:', row.id, err)
      failed.push(row.id)
    }
  }

  return NextResponse.json({ counted, reported, failed: failed.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { getStripe } from '@/utils/stripe'

export const maxDuration = 60

// GET /api/billing/report-usage - Daily Vercel cron (vercel.json). Counts new billable
// rep audio days (sql/stripe-usage-migration.sql) and sends each one to the Stripe
// meter, so it lands on the company's next invoice. For per-rep companies it also
// sends this month's peak active rep count (sql/per-rep-billing-migration.sql).
// Safe to run any number of times.
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

  const activeReps = await reportActiveReps(service, stripe)

  return NextResponse.json({ counted, reported, failed: failed.length, activeReps })
}

// Per-rep plan: send each company's peak active rep count for this month to the
// "active_reps" meter (aggregation: Last), so the invoice bills peak x $5.
// One event per company per day; Stripe ignores a repeat of the same identifier.
async function reportActiveReps(
  service: ReturnType<typeof createServiceRoleClient>,
  stripe: ReturnType<typeof getStripe>,
) {
  const eventName = process.env.STRIPE_ACTIVE_REP_METER_EVENT || 'active_reps'
  const { data, error } = await service.rpc('record_active_reps')
  if (error) {
    // Before sql/per-rep-billing-migration.sql is run the function doesn't exist yet
    console.error('Counting active reps failed:', error)
    return { reported: 0, failed: 0, error: true }
  }

  const today = new Date().toISOString().slice(0, 10)
  let reported = 0
  let failed = 0
  for (const row of (data ?? []) as { company_id: string; stripe_customer_id: string | null; peak: number }[]) {
    if (!row.stripe_customer_id) continue
    try {
      await stripe.billing.meterEvents.create({
        event_name: eventName,
        identifier: `active-reps-${row.company_id}-${today}`,
        payload: { stripe_customer_id: row.stripe_customer_id, value: String(row.peak) },
      })
      reported++
    } catch (err) {
      console.error('Stripe active rep meter event failed:', row.company_id, err)
      failed++
    }
  }
  return { reported, failed }
}

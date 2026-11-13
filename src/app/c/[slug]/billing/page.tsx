import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { canManageCompany } from '@/utils/users/roles'
import { Container } from '@/components'

const DEFAULT_PLATFORM_FEE = 300
const AUDIO_DAY_FEE = 8
const ACTIVE_REP_FEE = 5

function formatDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Owners see their plan, this month's billable audio days, and get to Stripe from here.
export default async function CompanyBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ billing?: string }>
}) {
  const { slug } = await params
  const { billing } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/c/${slug}/login`)

  const { data: profile } = await supabase.from('user_profiles').select('role, company_id').eq('id', user.id).single()
  if (!canManageCompany(profile?.role)) redirect(`/c/${slug}/dashboard`)

  const service = createServiceRoleClient()
  const { data: company } = await service
    .from('companies')
    .select('*') // '*' so this still works before billing_plan / platform_fee_cents exist
    .eq('slug', slug)
    .single()
  if (!company || (profile?.role !== 'super_admin' && company.id !== profile?.company_id)) redirect(`/c/${slug}/dashboard`)

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const { count } = await service
    .from('billing_audio_days')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company.id)
    .gte('counted_at', monthStart.toISOString())
  const audioDays = count ?? 0

  // Per-rep plan: show this month's billable peak, or today's active count before billing starts
  const perRep = company.billing_plan === 'per_rep'
  let activeReps = 0
  if (perRep) {
    const { count: current } = await service
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('is_active', true)
      .neq('role', 'super_admin')
    const { data: peakRow } = await service
      .from('billing_active_reps')
      .select('peak')
      .eq('company_id', company.id)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()
    activeReps = Math.max(current ?? 0, peakRow?.peak ?? 0)
  }

  const platformFee = company.platform_fee_cents != null ? company.platform_fee_cents / 100 : DEFAULT_PLATFORM_FEE
  const today = new Date().toISOString().slice(0, 10)
  const subscribed = !!company.stripe_subscription_id && company.billing_status !== 'cancelled'
  const freeUntil = company.billing_start_date && company.billing_start_date > today ? company.billing_start_date : null
  const monthName = monthStart.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })

  const status = !company.stripe_subscription_id
    ? 'Not set up'
    : company.billing_status === 'cancelled'
      ? 'Cancelled'
      : freeUntil
        ? `Free until ${formatDate(freeUntil)}`
        : 'Active'

  return (
    <Container maxWidth="lg" padding="lg">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="mt-1 text-sm text-gray-500">{company.name}&apos;s SLAB plan, paid through Stripe.</p>
        </div>

        {billing === 'success' && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            You&apos;re all set. Billing is connected, and Stripe will email invoices to {company.billing_email || 'your billing email'}.
          </div>
        )}
        {billing === 'cancelled' && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            Checkout was cancelled. Nothing was charged.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Status</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{status}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Rep audio days in {monthName}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{audioDays}</p>
            <p className="text-xs text-gray-500">${AUDIO_DAY_FEE} each, billed next month</p>
          </div>
          {perRep ? (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-sm text-gray-500">Active reps in {monthName}</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {activeReps} &times; ${ACTIVE_REP_FEE} = ${activeReps * ACTIVE_REP_FEE}
              </p>
              <p className="text-xs text-gray-500">
                {freeUntil ? `Free trial until ${formatDate(freeUntil)}` : 'Peak for the month, billed next month'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="text-sm text-gray-500">Monthly platform fee</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">${platformFee}</p>
              <p className="text-xs text-gray-500">
                {freeUntil
                  ? `First charge ${formatDate(freeUntil)}`
                  : company.platform_price_id
                    ? 'Billed monthly from the day you set up billing'
                    : 'Billed on the 1st'}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          {subscribed ? (
            <form method="POST" action="/api/billing/portal" className="flex flex-wrap items-center justify-between gap-4">
              <input type="hidden" name="company_id" value={company.id} />
              <p className="text-sm text-gray-600">See invoices and receipts, or change the bank account or card on file.</p>
              <button type="submit" className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700">
                Manage billing
              </button>
            </form>
          ) : (
            <form method="POST" action="/api/billing/checkout" className="flex flex-wrap items-center justify-between gap-4">
              <input type="hidden" name="company_id" value={company.id} />
              <p className="text-sm text-gray-600">
                Add a bank account (ACH) or card on Stripe&apos;s secure page to start your plan.
                {freeUntil && ` You won't be charged until ${formatDate(freeUntil)}.`}
              </p>
              <button type="submit" className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600">
                Set up billing
              </button>
            </form>
          )}
        </div>
      </div>
    </Container>
  )
}

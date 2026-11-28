import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { loadMonthlyReport, previousMonth, reportCsv } from '@/utils/reports/monthlyReport'

// GET /api/company/[slug]/usage-report?month=YYYY-MM - On-demand CSV of the monthly
// engagement report (Ace contract 7.3). Company owners and SLAB super admins only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const [{ data: profile }, { data: company }] = await Promise.all([
    service.from('user_profiles').select('role, company_id').eq('id', user.id).single(),
    service.from('companies').select('id').eq('slug', slug).single(),
  ])
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  const allowed =
    profile?.role === 'super_admin' || (profile?.role === 'company_admin' && profile.company_id === company.id)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const month = request.nextUrl.searchParams.get('month') || previousMonth()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  try {
    const report = await loadMonthlyReport(service, company.id, month)
    return new NextResponse(reportCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-slab-report-${month}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[usage-report] failed:', e)
    return NextResponse.json({ error: 'Report failed' }, { status: 500 })
  }
}

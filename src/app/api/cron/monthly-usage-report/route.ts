import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { emailMonthlyReport, loadMonthlyReport, previousMonth, reportRecipients } from '@/utils/reports/monthlyReport'

export const maxDuration = 60

// GET /api/cron/monthly-usage-report - Vercel cron on the 1st (vercel.json).
// Emails last month's engagement report (CSV attached) to the owners of every
// company with monthly_report_enabled (Ace contract 7.3).
// ?month=YYYY-MM resends a given month; ?company=<slug> limits it to one company.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const month = request.nextUrl.searchParams.get('month') || previousMonth()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  const only = request.nextUrl.searchParams.get('company')

  const service = createServiceRoleClient()
  let query = service.from('companies').select('id, slug, monthly_report_to, monthly_report_from').eq('monthly_report_enabled', true)
  if (only) query = query.eq('slug', only)
  const { data: companies, error } = await query
  if (error) {
    console.error('[monthly-report] loading companies failed:', error)
    return NextResponse.json({ error: 'Load failed' }, { status: 500 })
  }

  const sent: string[] = []
  const failed: { slug: string; error: string }[] = []
  const skipped: string[] = []
  for (const c of companies ?? []) {
    // No report for months before the company's reporting start (e.g. Ace: the contract term).
    if (c.monthly_report_from && `${month}-01` < c.monthly_report_from) {
      skipped.push(c.slug)
      continue
    }
    try {
      const to = await reportRecipients(service, c.id, c.monthly_report_to)
      const report = await loadMonthlyReport(service, c.id, month)
      await emailMonthlyReport(report, to)
      sent.push(c.slug)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[monthly-report] ${c.slug} failed:`, message)
      failed.push({ slug: c.slug, error: message })
    }
  }
  return NextResponse.json({ month, sent, skipped, failed }, { status: failed.length && !sent.length ? 500 : 200 })
}

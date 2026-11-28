import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { sendPush } from '@/utils/push'
import { REPORT_TZ } from '@/utils/reports/monthlyReport'

export const maxDuration = 60
const DEFAULT_FROM = 'SLAB <noreply@slabtraining.com>'

interface Row {
  company_id: string
  company_name: string
  company_slug: string
  team_id: string | null
  team_name: string | null
  manager_id: string | null
  user_id: string
  name: string
  email: string
  last_active: string | null
}

function esc(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * GET /api/cron/weekly-manager-nudge - Vercel cron, Mondays 8 AM Mountain.
 * For companies with weekly_nudge_enabled, emails each team's manager the reps on their team who
 * haven't opened SLAB in 7 days (plus a push if the manager has the app). Reps with no team, or
 * whose team has no manager, go to the company's owners instead.
 * ?company=<slug> limits it to one company.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY missing' }, { status: 500 })
  const only = request.nextUrl.searchParams.get('company')

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('weekly_inactive_reps')
  if (error) {
    console.error('[weekly-nudge] load failed:', error)
    return NextResponse.json({ error: 'Load failed' }, { status: 500 })
  }
  const rows = ((data ?? []) as Row[]).filter((r) => !only || r.company_slug === only)
  if (!rows.length) return NextResponse.json({ emails: 0 })

  const companyIds = [...new Set(rows.map((r) => r.company_id))]
  const managerIds = [...new Set(rows.map((r) => r.manager_id).filter(Boolean))] as string[]
  const [{ data: owners }, { data: managers }] = await Promise.all([
    service.from('user_profiles').select('id, email, company_id').in('company_id', companyIds).eq('role', 'company_admin').neq('is_active', false),
    managerIds.length
      ? service.from('user_profiles').select('id, email, display_name, is_active').in('id', managerIds)
      : Promise.resolve({ data: [] as { id: string; email: string; display_name: string | null; is_active: boolean | null }[] }),
  ])
  const managerById = new Map((managers ?? []).filter((m) => m.is_active !== false).map((m) => [m.id, m]))

  // One message per recipient group: a team's manager, or a company's owners
  type Group = { to: string[]; pushIds: string[]; company: Row; label: string; reps: Row[] }
  const groups = new Map<string, Group>()
  for (const r of rows) {
    const mgr = r.manager_id ? managerById.get(r.manager_id) : undefined
    const key = mgr ? `m:${mgr.id}:${r.team_id}` : `o:${r.company_id}`
    let g = groups.get(key)
    if (!g) {
      g = mgr
        ? { to: [mgr.email], pushIds: [mgr.id], company: r, label: r.team_name ? `your team (${r.team_name})` : 'your team', reps: [] }
        : {
            to: (owners ?? []).filter((o) => o.company_id === r.company_id).map((o) => o.email),
            pushIds: (owners ?? []).filter((o) => o.company_id === r.company_id).map((o) => o.id),
            company: r,
            label: 'reps without a team manager',
            reps: [],
          }
      groups.set(key, g)
    }
    g.reps.push(r)
  }

  const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: REPORT_TZ }) : 'Never'
  const resend = new Resend(apiKey)
  const from = process.env.RESEND_FROM || DEFAULT_FROM
  let emails = 0
  let pushes = 0
  const failed: string[] = []
  for (const g of groups.values()) {
    if (!g.to.length) continue
    const reps = [...g.reps].sort((a, b) => (a.last_active ?? '').localeCompare(b.last_active ?? '') || a.name.localeCompare(b.name))
    const never = reps.filter((r) => !r.last_active).length
    const company = g.company.company_name
    const link = `https://www.slabtraining.com/c/${g.company.company_slug}/usage`
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111">
  <h2 style="margin:0 0 6px">${reps.length} ${reps.length === 1 ? 'rep hasn’t' : 'reps haven’t'} opened SLAB this week</h2>
  <p style="margin:0 0 14px;color:#555;font-size:14px">${esc(company)}, ${esc(g.label)}. No time in the app or website in the last 7 days${never ? `; ${never} have never signed in` : ''}. A quick text from you is the fastest way to get them back on.</p>
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    <tr style="color:#888;font-size:12px;text-align:left"><th style="padding:4px 8px 4px 0">Rep</th><th style="padding:4px 8px 4px 0">Email</th><th style="padding:4px 0">Last active</th></tr>
    ${reps.slice(0, 200).map((r) => `<tr><td style="padding:4px 8px 4px 0">${esc(r.name)}</td><td style="padding:4px 8px 4px 0;color:#555">${esc(r.email)}</td><td style="padding:4px 0">${esc(day(r.last_active))}</td></tr>`).join('')}
  </table>
  ${reps.length > 200 ? `<p style="font-size:13px;color:#555">And ${reps.length - 200} more.</p>` : ''}
  <p style="margin:16px 0 0;font-size:14px">Reps who never signed in can be sent a set-password link from <a href="${link}">the Usage page</a>.</p>
</div>`
    const { error: sendError } = await resend.emails.send({
      from,
      to: g.to,
      subject: `${company}: ${reps.length} ${reps.length === 1 ? 'rep' : 'reps'} haven't opened SLAB this week`,
      html,
    })
    if (sendError) {
      console.error('[weekly-nudge] email failed:', sendError)
      failed.push(g.to.join(','))
      continue
    }
    emails += 1
    try {
      const res = await sendPush(service, {
        userIds: g.pushIds,
        title: `${reps.length} ${reps.length === 1 ? 'rep' : 'reps'} went quiet this week`,
        body: `They haven't opened SLAB in 7 days. Check your email for the list and give them a nudge.`,
        category: 'company_alerts',
      })
      pushes += res.sent
    } catch (e) {
      console.error('[weekly-nudge] push failed:', e)
    }
    await new Promise((r) => setTimeout(r, 600)) // stay under Resend's rate limit
  }
  return NextResponse.json({ emails, pushes, failed })
}

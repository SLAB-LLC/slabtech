/**
 * Monthly engagement report (Ace contract 7.3). Data comes from
 * company_monthly_report() in sql/monthly-usage-report-migration.sql.
 *
 * Used by the cron on the 1st (/api/cron/monthly-usage-report) and the owner
 * export (/api/company/[slug]/usage-report). Numbers are reported as tracked.
 */
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'

export const REPORT_TZ = 'America/Denver'
const DEFAULT_FROM = 'SLAB <noreply@slabtraining.com>'

export interface ReportUser {
  name: string
  email: string
  role: string
  status: string
  team: string | null
  manager: string | null
  joined: string | null
  last_sign_in: string | null
  last_active: string | null
  active_seconds: number
  listening_seconds: number
  active_days: number
  xp_period: number
  xp_total: number
  streak: number
  lessons_period: number
  lessons_total: number
  videos_done: number
  videos_total: number
}

export interface ReportInvite {
  email: string
  role: string
  team: string | null
  invited: string
  expires: string | null
  expired: boolean
}

export interface MonthlyReport {
  company: { id: string; name: string; slug: string }
  start: string
  end: string
  timezone: string
  users: ReportUser[]
  invites: ReportInvite[]
}

/** A "YYYY-MM" month -> first and last day. */
export function monthRange(month: string): { start: string; end: string; label: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}`, label }
}

/** The month before today in the report time zone, as "YYYY-MM". */
export function previousMonth(now = new Date()): string {
  const [y, m] = now.toLocaleDateString('en-CA', { timeZone: REPORT_TZ }).split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, '0')}`
}

export async function loadMonthlyReport(service: SupabaseClient, companyId: string, month: string): Promise<MonthlyReport> {
  const { start, end } = monthRange(month)

  const { data, error } = await service.rpc('company_monthly_report', {
    p_company_id: companyId,
    p_start: start,
    p_end: end,
    p_tz: REPORT_TZ,
  })
  if (error) throw new Error(error.message)
  const report = data as MonthlyReport
  report.company.name = report.company.name.trim()
  return report
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: REPORT_TZ }) : ''
const hours = (s: number) => (s / 3600).toFixed(1)
const minutes = (s: number) => Math.round(s / 60)

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',')

export function summarize(r: MonthlyReport) {
  const reps = r.users.filter((u) => u.role === 'user')
  const active = reps.filter((u) => u.active_days > 0)
  const totalSeconds = r.users.reduce((n, u) => n + u.active_seconds, 0)
  return {
    members: r.users.length,
    reps: reps.length,
    activeReps: active.length,
    neverSignedIn: r.users.filter((u) => !u.last_sign_in).length,
    pendingInvites: r.invites.length,
    totalHours: totalSeconds / 3600,
    xp: r.users.reduce((n, u) => n + u.xp_period, 0),
    lessons: r.users.reduce((n, u) => n + u.lessons_period, 0),
  }
}

/** Per-user rows, then unaccepted invitations, then a team roll-up. */
export function reportCsv(r: MonthlyReport): string {
  const lines: string[] = []
  const { label } = monthRange(r.start.slice(0, 7))
  lines.push(csvLine([`${r.company.name} SLAB engagement report`, label, `Times in ${r.timezone}`]))
  lines.push('')
  lines.push(csvLine([
    'Name', 'Email', 'Role', 'Status', 'Team', 'Manager', 'Joined', 'Last sign-in', 'Last active',
    'Hours this month', 'Listening minutes', 'Active days (2+ min)', 'XP this month', 'Total XP',
    'Current streak', 'Lessons this month', 'Lessons total', 'Training videos completed', 'Training videos assigned',
  ]))
  for (const u of r.users) {
    lines.push(csvLine([
      u.name, u.email, u.role, u.status, u.team ?? '', u.manager ?? '', day(u.joined), day(u.last_sign_in),
      day(u.last_active), hours(u.active_seconds), minutes(u.listening_seconds), u.active_days, u.xp_period,
      u.xp_total, u.streak, u.lessons_period, u.lessons_total, u.videos_done, u.videos_total,
    ]))
  }

  lines.push('')
  lines.push(csvLine(['Invitations not accepted']))
  lines.push(csvLine(['Email', 'Role', 'Team', 'Invited', 'Expires', 'Expired']))
  for (const i of r.invites) {
    lines.push(csvLine([i.email, i.role, i.team ?? '', day(i.invited), day(i.expires), i.expired ? 'yes' : 'no']))
  }

  lines.push('')
  lines.push(csvLine(['By team and manager']))
  lines.push(csvLine(['Team', 'Manager', 'Members', 'Active this month', 'Hours', 'XP this month', 'Lessons this month']))
  const teams = new Map<string, ReportUser[]>()
  for (const u of r.users) {
    const key = `${u.team ?? 'No team'}\u0000${u.manager ?? ''}`
    teams.set(key, [...(teams.get(key) ?? []), u])
  }
  for (const [key, us] of teams) {
    const [team, manager] = key.split('\u0000')
    lines.push(csvLine([
      team, manager, us.length, us.filter((u) => u.active_days > 0).length,
      hours(us.reduce((n, u) => n + u.active_seconds, 0)),
      us.reduce((n, u) => n + u.xp_period, 0), us.reduce((n, u) => n + u.lessons_period, 0),
    ]))
  }
  return lines.join('\r\n') + '\r\n'
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Owner emails for a company, or the company's monthly_report_to override. */
export async function reportRecipients(service: SupabaseClient, companyId: string, override: string | null): Promise<string[]> {
  if (override?.trim()) return override.split(',').map((s) => s.trim()).filter(Boolean)
  const { data } = await service
    .from('user_profiles')
    .select('email')
    .eq('company_id', companyId)
    .eq('role', 'company_admin')
    .neq('is_active', false)
  return (data ?? []).map((p: { email: string }) => p.email).filter(Boolean)
}

export async function emailMonthlyReport(r: MonthlyReport, to: string[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY missing')
  if (!to.length) throw new Error('No recipients')
  const { label } = monthRange(r.start.slice(0, 7))
  const s = summarize(r)
  const csv = reportCsv(r)
  const link = `https://www.slabtraining.com/c/${r.company.slug}/usage`

  const top = [...r.users].sort((a, b) => b.xp_period - a.xp_period).filter((u) => u.xp_period > 0).slice(0, 5)
  const row = (k: string, v: string | number) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#555">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111">
  <h2 style="margin:0 0 4px">${esc(r.company.name)} on SLAB: ${esc(label)}</h2>
  <p style="margin:0 0 16px;color:#555">Your monthly engagement report. The full report by rep, team and manager is attached as a CSV.</p>
  <table style="border-collapse:collapse;font-size:14px">
    ${row('Members', s.members)}
    ${row('Reps active this month', `${s.activeReps} of ${s.reps}`)}
    ${row('Time on SLAB', `${s.totalHours.toFixed(1)} hours`)}
    ${row('XP earned', s.xp.toLocaleString('en-US'))}
    ${row('Lessons completed', s.lessons)}
    ${row('Never signed in', s.neverSignedIn)}
    ${row('Invitations not accepted', s.pendingInvites)}
  </table>
  ${top.length ? `<h3 style="margin:20px 0 6px;font-size:15px">Top XP this month</h3><ol style="margin:0;padding-left:20px;font-size:14px">${top.map((u) => `<li>${esc(u.name)}: ${u.xp_period.toLocaleString('en-US')} XP</li>`).join('')}</ol>` : ''}
  <p style="margin:20px 0 0;font-size:14px">You can pull this report any time at <a href="${link}">${esc(link.replace('https://', ''))}</a>.</p>
  <p style="margin:16px 0 0;font-size:12px;color:#888">Time counts minutes the website or app was open and in use (${esc(r.timezone)}). An active day is 2+ minutes.</p>
</div>`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || DEFAULT_FROM,
    to,
    subject: `${r.company.name} SLAB engagement report: ${label}`,
    html,
    attachments: [{ filename: `${r.company.slug}-slab-report-${r.start.slice(0, 7)}.csv`, content: Buffer.from(csv, "utf8") }],
  })
  if (error) throw new Error(error.message)
}

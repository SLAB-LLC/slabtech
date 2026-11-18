/**
 * Login-sharing alerts (sql/login-sharing-protection.sql raises the flags).
 *
 * Sends one email per newly flagged account, then marks it notified so nobody is emailed twice.
 * Best-effort: a mail failure leaves the flag un-notified for the next try (the next sign-in
 * or the daily sweep), and never breaks a sign-in.
 *
 * Config:
 *   RESEND_API_KEY          Without it, nothing is sent (flags still show at /security).
 *   SECURITY_ALERT_TO       Comma-separated recipients. Falls back to INQUIRY_NOTIFY_TO, then SLAB's inbox.
 *   RESEND_FROM             From header on a domain verified in Resend.
 */
import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_TO = 'duncan@slabtraining.com'
const DEFAULT_FROM = 'SLAB <noreply@slabtraining.com>'

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface FlagRow {
  user_id: string
  reason: string | null
  overlap_count: number
  network_count: number
  flagged_at: string
}

/** Email every flagged account that hasn't been emailed yet (optionally just these users). */
export async function sendLoginSharingAlerts(service: SupabaseClient, onlyUserIds?: string[]): Promise<number> {
  let query = service
    .from('account_security_flags')
    .select('user_id, reason, overlap_count, network_count, flagged_at')
    .eq('status', 'flagged')
    .is('notified_at', null)
    .limit(25)
  if (onlyUserIds?.length) query = query.in('user_id', onlyUserIds)
  const { data: flags, error } = await query
  if (error || !flags?.length) return 0

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[security] RESEND_API_KEY missing; login-sharing flags only show at /security')
    return 0
  }

  const ids = (flags as FlagRow[]).map((f) => f.user_id)
  const [{ data: profiles }, { data: events }] = await Promise.all([
    service.from('user_profiles').select('id, email, display_name, companies(name)').in('id', ids),
    service
      .from('login_events')
      .select('user_id, created_at, ip, device, overlap')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const to = (process.env.SECURITY_ALERT_TO || process.env.INQUIRY_NOTIFY_TO || DEFAULT_TO)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://slabtraining.com'
  const resend = new Resend(apiKey)
  let sent = 0

  for (const flag of flags as FlagRow[]) {
    const p = (profiles ?? []).find((x: any) => x.id === flag.user_id) as any
    const company = Array.isArray(p?.companies) ? p.companies[0]?.name : p?.companies?.name
    const who = p?.display_name || p?.email || flag.user_id
    const recent = (events ?? []).filter((e: any) => e.user_id === flag.user_id).slice(0, 8)
    const rows = recent
      .map(
        (e: any) =>
          `<tr><td style="padding:4px 10px 4px 0;">${esc(new Date(e.created_at).toLocaleString('en-US', { timeZone: 'America/Boise' }))}</td>` +
          `<td style="padding:4px 10px 4px 0;">${esc(e.device)}</td><td style="padding:4px 10px 4px 0;">${esc(e.ip ?? '?')}</td>` +
          `<td style="padding:4px 0;">${e.overlap ? '<b style="color:#C2560F;">overlap</b>' : ''}</td></tr>`
      )
      .join('')

    const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:560px;">
      <h2 style="margin:0 0 8px;">Possible login sharing</h2>
      <p style="margin:0 0 12px;"><b>${esc(who)}</b>${p?.email && p.email !== who ? ` (${esc(p.email)})` : ''}${company ? ` at <b>${esc(company)}</b>` : ''}</p>
      <p style="margin:0 0 12px;">${esc(flag.reason)}.</p>
      <p style="margin:0 0 12px;color:#555;">Nothing was locked. Each new sign-in already signs the other device out.
      Review it and choose Clear, Sign out everywhere or Lock.</p>
      <table style="font-size:13px;border-collapse:collapse;margin:0 0 16px;">${rows}</table>
      <a href="${baseUrl}/security" style="background:#F4711E;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Review in SLAB</a>
    </div>`

    try {
      const { error: sendError } = await resend.emails.send({
        from: process.env.RESEND_FROM ?? DEFAULT_FROM,
        to,
        subject: `SLAB security: possible login sharing (${who}${company ? `, ${company}` : ''})`,
        html,
      })
      if (sendError) {
        console.error('[security] Resend rejected the alert:', sendError)
        continue
      }
      await service.from('account_security_flags').update({ notified_at: new Date().toISOString() }).eq('user_id', flag.user_id)
      sent++
    } catch (err) {
      console.error('[security] alert email failed:', err)
    }
  }
  return sent
}

/** The Supabase sign-in this access token belongs to (the JWT's session_id claim). */
export function sessionIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.session_id === 'string' ? payload.session_id : null
  } catch {
    return null
  }
}

/** The visitor's IP as Vercel reports it. */
export function requestIp(headers: Headers): string | null {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')
  return ip || null
}

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { canManageCompany } from '@/utils/users/roles'
import { makeSignInToken } from '@/utils/nudges/signInLink'

const DEFAULT_FROM = 'SLAB <noreply@slabtraining.com>'
const RESEND_AFTER_MS = 3 * 86400000 // don't email the same person more than once every 3 days

interface Pending {
  id: string
  email: string
  display_name: string | null
  role: string
  created_at: string
  sign_in_nudged_at: string | null
}

async function ownerOf(slug: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const service = createServiceRoleClient()
  const [{ data: profile }, { data: company }] = await Promise.all([
    service.from('user_profiles').select('role, company_id').eq('id', user.id).single(),
    service.from('companies').select('id, name, slug, logo_url').eq('slug', slug).single(),
  ])
  if (!company) return { error: NextResponse.json({ error: 'Company not found' }, { status: 404 }) }
  const ok = profile?.role === 'super_admin' || (canManageCompany(profile?.role) && profile?.company_id === company.id)
  if (!ok) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { service, company: { ...company, name: String(company.name).trim() } }
}

// GET -> reps and managers in the company who have never signed in.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await ownerOf(slug)
  if ('error' in ctx) return ctx.error
  const { data, error } = await ctx.service.rpc('company_never_signed_in', { p_company_id: ctx.company.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ people: data ?? [] })
}

function esc(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// POST { userIds?: string[] } -> emails each person (all of them if no ids) a link to pick a
// password and get the app. Skips anyone emailed in the last 3 days.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await ownerOf(slug)
  if ('error' in ctx) return ctx.error
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Email is not set up' }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const only: string[] | null = Array.isArray(body?.userIds) ? body.userIds.map(String) : null

  const { data, error } = await ctx.service.rpc('company_never_signed_in', { p_company_id: ctx.company.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const now = Date.now()
  const targets = ((data ?? []) as Pending[])
    .filter((p) => !only || only.includes(p.id))
    .filter((p) => !p.sign_in_nudged_at || now - new Date(p.sign_in_nudged_at).getTime() > RESEND_AFTER_MS)
    .slice(0, 300)
  const skipped = (only?.length ?? (data?.length ?? 0)) - targets.length
  if (!targets.length) return NextResponse.json({ sent: 0, skipped })

  const nudgedAt = new Date().toISOString()
  const ids = targets.map((t) => t.id)
  const { error: markError } = await ctx.service.from('user_profiles').update({ sign_in_nudged_at: nudgedAt }).in('id', ids)
  if (markError) return NextResponse.json({ error: markError.message }, { status: 500 })

  const origin = 'https://www.slabtraining.com'
  const company = ctx.company
  const emails = targets.map((p) => {
    const link = `${origin}/welcome/${makeSignInToken(p.id, nudgedAt)}`
    const first = (p.display_name || '').trim().split(/\s+/)[0]
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#111">
  ${company.logo_url ? `<img src="${esc(company.logo_url)}" alt="${esc(company.name)}" style="height:48px;margin-bottom:12px">` : ''}
  <h2 style="margin:0 0 8px">${first ? `${esc(first)}, your` : 'Your'} SLAB account is waiting</h2>
  <p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(company.name)} set you up on SLAB, the training app with real recorded doors from top reps, daily lessons and the team leaderboard. You haven't signed in yet.</p>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.5">Pick your password, get the app, and sign in with <b>${esc(p.email)}</b>.</p>
  <a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Set my password</a>
  <p style="margin:18px 0 0;font-size:12px;color:#888">This link works once and expires in 21 days. If you already know your password, just open the SLAB app and sign in.</p>
</div>`
    return {
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      to: [p.email],
      subject: `Your ${company.name} SLAB account is ready`,
      html,
    }
  })

  const resend = new Resend(apiKey)
  let sent = 0
  const failed: string[] = []
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100)
    const { error: sendError } = await resend.batch.send(chunk)
    if (sendError) {
      console.error('[sign-in-nudge] batch failed:', sendError)
      failed.push(...chunk.map((e) => e.to[0]))
    } else sent += chunk.length
  }
  if (failed.length) {
    // Let them be emailed again right away
    await ctx.service.from('user_profiles').update({ sign_in_nudged_at: null }).in('email', failed).eq('company_id', company.id)
  }
  return NextResponse.json({ sent, skipped, failed: failed.length })
}

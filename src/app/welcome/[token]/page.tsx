import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { readSignInToken, tokenMatches } from '@/utils/nudges/signInLink'
import WelcomeForm from './WelcomeForm'

export const dynamic = 'force-dynamic'

// Landing page for the "your SLAB account is waiting" email (api/company/[slug]/sign-in-nudge).
export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const parsed = readSignInToken(token)
  let person: { email: string; company: string; logo: string | null; color: string } | null = null
  if (parsed) {
    const { data } = await createServiceRoleClient()
      .from('user_profiles')
      .select('email, sign_in_nudged_at, companies(name, logo_url, primary_color)')
      .eq('id', parsed.userId)
      .single()
    const c = (Array.isArray(data?.companies) ? data?.companies[0] : data?.companies) as
      | { name: string; logo_url: string | null; primary_color: string | null }
      | undefined
    if (data && tokenMatches(parsed.nudgedAtMs, data.sign_in_nudged_at)) {
      person = { email: data.email, company: String(c?.name || '').trim(), logo: c?.logo_url ?? null, color: c?.primary_color || '#FFD700' }
    }
  }

  if (!person) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f] px-4">
        <div className="max-w-md w-full bg-[#001155]/80 rounded-lg p-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">This link has expired</h1>
          <p className="text-gray-300">
            It was already used, or a newer email was sent. If you set your password, open the SLAB app and sign in.
            Otherwise ask your manager to send a new link.
          </p>
        </div>
      </div>
    )
  }
  return <WelcomeForm token={token} {...person} />
}

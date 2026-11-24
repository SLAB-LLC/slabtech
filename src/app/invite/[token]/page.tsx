import { createServiceRoleClient } from '@/utils/supabase/service-role'
import InviteAcceptForm from './InviteAcceptForm'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  // Next 15+ passes params as a Promise; reading params.token directly gives undefined.
  const { token } = await params

  // The person opening an invite is signed out, and RLS on company_invites only lets
  // owners/admins read it, so look the token up server-side with the service role.
  // Only the fields the accept form needs are selected.
  const supabase = createServiceRoleClient()

  // Fetch invite with company details
  const { data: invite } = await supabase
    .from('company_invites')
    .select('id, token, email, role, expires_at, companies!inner(name, slug, logo_url, primary_color, secondary_color)')
    .eq('token', token)
    .eq('accepted', false)
    .single()

  // Invite not found or already accepted
  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f]">
        <div className="max-w-md w-full bg-[#001155]/80 rounded-lg p-8 text-center">
          <div className="text-6xl mb-4">❌</div>
          <h1 className="text-2xl font-bold text-white mb-2">Invite Not Found</h1>
          <p className="text-gray-400">
            This invite link is invalid or has already been used.
          </p>
        </div>
      </div>
    )
  }

  // Check if invite has expired
  const expiresAt = new Date(invite.expires_at)
  const now = new Date()

  if (expiresAt < now) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f]">
        <div className="max-w-md w-full bg-[#001155]/80 rounded-lg p-8 text-center">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-2xl font-bold text-white mb-2">Invite Expired</h1>
          <p className="text-gray-400">This invite link has expired. Please request a new invite.</p>
        </div>
      </div>
    )
  }

  // companies is a many-to-one join, so it comes back as one object at runtime
  return <InviteAcceptForm invite={invite as unknown as Parameters<typeof InviteAcceptForm>[0]["invite"]} />
}

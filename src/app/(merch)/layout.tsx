import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { AdminShell, ADMIN_NAV } from '@/components/AdminShell'

// /slot-orders: SLAB super admins plus merch managers (sql/merch-managers.sql), who run merch
// fulfillment without being super admins. Merch managers only see the Slot Orders tab; the data
// itself is gated in the database by can_manage_merch().
export default async function MerchLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active, companies(slug)')
    .eq('id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }
  if (!profile.is_active) {
    await supabase.auth.signOut()
    redirect('/login?error=account_disabled')
  }

  const isSuperAdmin = profile.role === 'super_admin'
  if (!isSuperAdmin) {
    const { data: canManage } = await supabase.rpc('can_manage_merch')
    if (canManage !== true) {
      const company = profile.companies as unknown as { slug: string } | { slug: string }[] | null
      const slug = Array.isArray(company) ? company[0]?.slug : company?.slug
      redirect(slug ? `/c/${slug}/dashboard` : '/login')
    }
  }

  return (
    <AdminShell
      nav={isSuperAdmin ? ADMIN_NAV : [['/slot-orders', 'Slot Orders']]}
      email={user.email ?? ''}
      badge={isSuperAdmin ? 'Super Admin' : 'Merch'}
    >
      {children}
    </AdminShell>
  )
}

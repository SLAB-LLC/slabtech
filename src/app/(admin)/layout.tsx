import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { AdminShell, ADMIN_NAV } from '@/components/AdminShell'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Only SLAB super admins get the admin pages. A missing profile is NOT treated as an admin
  // (it used to be, so any signed-in account without a profile could open these pages).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active, companies(slug)')
    .eq('id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  } else if (!profile.is_active) {
    // User is disabled
    await supabase.auth.signOut()
    redirect('/login?error=account_disabled')
  } else if (profile.role !== 'super_admin') {
    // Non-super-admin users are redirected to their company dashboard
    const company = profile.companies as unknown as { slug: string } | { slug: string }[] | null
    const slug = Array.isArray(company) ? company[0]?.slug : company?.slug
    redirect(slug ? `/c/${slug}/dashboard` : '/login')
  }

  return (
    <AdminShell nav={ADMIN_NAV} email={user.email ?? ''} badge="Super Admin">
      {children}
    </AdminShell>
  )
}

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { CompanyBrandingProvider } from '@/components/CompanyBrandingProvider'
import { CompanyNav } from '@/components/CompanyNav'
import { ActivityTrackingProvider } from '@/components/ActivityTrackingProvider'
import { CaptureGuard } from '@/components/CaptureGuard'
import { getCaptureProtection } from '@/utils/captureProtection'

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/c/${slug}/login`)
  }

  // Get user's profile with company info
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active, company_id, companies!inner(id, name, slug, logo_url, primary_color, secondary_color)')
    .eq('id', user.id)
    .single()

  if (!profile?.is_active) {
    await supabase.auth.signOut()
    redirect(`/c/${slug}/login?error=account_disabled`)
  }

  // Verify user belongs to this company (unless super admin)
  if (profile.role !== 'super_admin' && (profile.companies as any)?.slug !== slug) {
    redirect(`/c/${(profile.companies as any)?.slug}/dashboard`)
  }

  // Get the company info (for super admins viewing other companies)
  const { data: company } = await supabase
    .from('companies')
    .select('id, name, slug, logo_url, primary_color, secondary_color')
    .eq('slug', slug)
    .single()

  if (!company) {
    return <div>Company not found</div>
  }

  const primaryColor = company.primary_color || '#f39c12'
  const secondaryColor = company.secondary_color || '#001199'
  const isCompanyAdmin = profile.role === 'company_admin'
  const isSuperAdmin = profile.role === 'super_admin'
  const protect = await getCaptureProtection(supabase, user.id, profile)
  // Merch managers (sql/merch-managers.sql) get a link to the slot prize orders they fulfill
  const { data: canManageMerch } = isSuperAdmin ? { data: false } : await supabase.rpc('can_manage_merch')

  return (
    <ActivityTrackingProvider>
      <CaptureGuard enabled={protect.on} watermark={protect.watermark} email={user.email ?? ''}>
      <CompanyBrandingProvider primaryColor={primaryColor} secondaryColor={secondaryColor}>
        <div className="min-h-screen bg-gray-100">
        <nav className="bg-pure-white border-b-2" style={{ borderColor: primaryColor }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between items-center">
            {/* Left: Back to admin (for super admins) */}
            {isSuperAdmin && (
              <Link href="/admin" className="text-sm text-steel-gray hover:text-success-gold">
                ← Admin
              </Link>
            )}

            {/* Center: Company Logo (clickable to leaderboard) */}
            <Link
              href={`/c/${slug}/leaderboard`}
              className={`flex items-center hover:opacity-80 transition-opacity ${isSuperAdmin ? 'absolute left-1/2 transform -translate-x-1/2' : ''}`}
            >
              {company.logo_url ? (
                <Image
                  src={company.logo_url}
                  alt={company.name}
                  width={50}
                  height={50}
                  className="h-[50px] w-auto"
                  priority
                />
              ) : (
                <div
                  className="text-2xl font-bold px-4 py-2 rounded"
                  style={{ color: primaryColor }}
                >
                  {company.name}
                </div>
              )}
            </Link>

            {/* Right: Navigation & User Info */}
            <div className="flex items-center gap-4">
              {/* Navigation Links */}
              <CompanyNav
                slug={slug}
                isCompanyAdmin={isCompanyAdmin}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
              />

              {canManageMerch === true && (
                <Link href="/slot-orders" className="text-sm font-medium text-steel-gray hover:text-success-gold">
                  Slot Orders
                </Link>
              )}

              {/* User Info */}
              <span className="text-sm text-steel-gray">{user.email}</span>
              {isCompanyAdmin && (
                <span className="px-2 py-1 text-xs font-medium rounded-full" style={{
                  backgroundColor: `${primaryColor}20`,
                  color: primaryColor
                }}>
                  Admin
                </span>
              )}
              {isSuperAdmin && (
                <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                  Super Admin
                </span>
              )}

              {/* Sign Out */}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="text-sm text-steel-gray hover:text-success-gold transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
      </CompanyBrandingProvider>
      </CaptureGuard>
    </ActivityTrackingProvider>
  )
}

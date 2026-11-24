import Link from 'next/link'
import Image from 'next/image'
import { ActivityTrackingProvider } from '@/components/ActivityTrackingProvider'

// The top bar for SLAB's own pages: the super admin pages and /slot-orders (which merch managers can open too)
export const ADMIN_NAV: [string, string][] = [
  ['/admin', 'Dashboard'],
  ['/companies', 'Companies'],
  ['/dashboard', 'Transcripts'],
  ['/users', 'Users'],
  ['/usage-analytics', 'Usage'],
  ['/config', 'Config'],
  ['/purchase-inquiries', 'Inquiries'],
  ['/notifications', 'Notifications'],
  ['/security', 'Security'],
  ['/slot-orders', 'Slot Orders'],
]


export function AdminShell({
  nav,
  email,
  badge,
  children,
}: {
  nav: [string, string][]
  email: string
  badge: string
  children: React.ReactNode
}) {
  return (
    <ActivityTrackingProvider>
      <div className="min-h-screen bg-gray-100">
        <nav className="bg-pure-white border-b-2 border-midnight-blue">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 justify-between items-center">
              <div className="flex items-center gap-8">
                <Link href="/">
                  <Image
                    src="/slab-logo.png"
                    alt="SLAB"
                    width={50}
                    height={50}
                    className="h-[50px] w-auto"
                    priority
                  />
                </Link>
                <div className="hidden md:flex items-center gap-6">
                  {nav.map(([href, label]) => (
                    <Link key={href} href={href} className="text-midnight-blue hover:text-success-gold font-medium transition-colors">
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="hidden lg:inline text-sm text-steel-gray">{email}</span>
                <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                  {badge}
                </span>
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
            {/* Phones: the same links in a row you can swipe */}
            <div className="md:hidden flex gap-5 overflow-x-auto pb-3 -mx-4 px-4 text-sm whitespace-nowrap">
              {nav.map(([href, label]) => (
                <Link key={href} href={href} className="text-midnight-blue hover:text-success-gold font-medium">
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </ActivityTrackingProvider>
  )
}

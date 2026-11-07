import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Set to false to re-enable access
const MAINTENANCE_MODE = false

export async function middleware(request: NextRequest) {
  // Block all company-facing routes during maintenance (super admin /admin routes stay open)
  if (MAINTENANCE_MODE) {
    const path = request.nextUrl.pathname
    const isAdminRoute = path.startsWith('/admin') || path.startsWith('/dashboard') ||
      path.startsWith('/users') || path.startsWith('/config') || path.startsWith('/transcripts') ||
      path.startsWith('/companies') || path.startsWith('/usage-analytics') ||
      path.startsWith('/purchase-inquiries') ||
      path.startsWith('/notifications') || path.startsWith('/upload')
    const isMaintenancePage = path.startsWith('/maintenance')
    const isApiRoute = path.startsWith('/api/')
    const isStaticAsset = path.startsWith('/_next') || path.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/)

    if (!isAdminRoute && !isMaintenancePage && !isApiRoute && !isStaticAsset) {
      return NextResponse.redirect(new URL('/maintenance', request.url))
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Company routes (/c/[slug]/...) require auth and company membership
  if (request.nextUrl.pathname.startsWith('/c/')) {
    const pathParts = request.nextUrl.pathname.split('/')
    const companySlug = pathParts[2]

    // Allow access to login pages without auth
    if (request.nextUrl.pathname.includes('/login')) {
      return supabaseResponse
    }

    // If not logged in, redirect to company login
    if (!user) {
      const loginUrl = new URL(`/c/${companySlug}/login`, request.url)
      loginUrl.searchParams.set('next', request.nextUrl.pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Verify user belongs to this company (unless super admin)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, company_id, companies!inner(slug)')
      .eq('id', user.id)
      .single()

    // If no profile or no company, prevent redirect loop
    if (!profile || !profile.companies) {
      console.error('User has no profile or company:', user.id)
      return supabaseResponse
    }

    // Super admins can access any company
    if (profile?.role === 'super_admin') {
      return supabaseResponse
    }

    const userCompanySlug = (profile.companies as any)?.slug

    // Prevent redirect loop: don't redirect if already on correct company
    if (!userCompanySlug) {
      console.error('User company has no slug:', user.id)
      return supabaseResponse
    }

    // Check if user's company matches the URL company slug
    if (userCompanySlug !== companySlug) {
      // Redirect to user's own company dashboard (prevent loop)
      const redirectUrl = new URL(`/c/${userCompanySlug}/dashboard`, request.url)
      // Only redirect if we're not already redirecting to the same place
      if (request.nextUrl.pathname !== redirectUrl.pathname) {
        return NextResponse.redirect(redirectUrl)
      }
    }
  }

  // Admin routes (/admin, /dashboard, /users, etc.) - only for super admins and company admins
  if (request.nextUrl.pathname.startsWith('/admin') ||
      request.nextUrl.pathname.startsWith('/dashboard') ||
      request.nextUrl.pathname.startsWith('/users') ||
      request.nextUrl.pathname.startsWith('/config') ||
      request.nextUrl.pathname.startsWith('/transcripts')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, companies!inner(slug)')
      .eq('id', user.id)
      .single()

    // Only super_admins can access admin routes
    if (profile?.role !== 'super_admin') {
      // Regular users and company admins go to their company dashboard
      const companySlug = (profile?.companies as any)?.slug
      if (companySlug) {
        const redirectUrl = new URL(`/c/${companySlug}/dashboard`, request.url)
        // Prevent redirect loop
        if (request.nextUrl.pathname !== redirectUrl.pathname) {
          return NextResponse.redirect(redirectUrl)
        }
      } else {
        console.error('Non-super-admin user has no company:', user.id)
        // Let them through but log the error
        return supabaseResponse
      }
    }
  }

  return supabaseResponse
  } catch (error) {
    console.error('Middleware error:', error)
    return supabaseResponse
  }
}

export const config = {
  matcher: [
    '/c/:path*',
    '/admin/:path*',
    '/dashboard/:path*',
    '/users/:path*',
    '/config/:path*',
    '/transcripts/:path*',
    '/((?!_next/static|_next/image|favicon.ico|api/process-audio|api/purchase-inquiry|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)',
  ],
}

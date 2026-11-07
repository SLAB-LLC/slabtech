import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import CompanyLoginForm from './CompanyLoginForm'

export default async function CompanyLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ next?: string }>
}) {
  const { slug } = await params
  // Where to go after signing in (e.g. the Billing page the app links to); only pages inside this company
  const { next: requested } = await searchParams
  const next = requested && requested.startsWith(`/c/${slug}/`) && !requested.includes('//') ? requested : `/c/${slug}/dashboard`
  const supabase = await createClient()

  // Fetch company data
  const { data: company } = await supabase
    .from('companies')
    .select('name, slug, logo_url, primary_color, secondary_color')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Company Not Found</h1>
          <p className="text-gray-400">The company you're looking for doesn't exist or has been deactivated.</p>
        </div>
      </div>
    )
  }

  // Check if already logged in
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(next)
  }

  return <CompanyLoginForm company={company} next={next} />
}

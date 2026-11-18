import { createClient } from '@/utils/supabase/server'

/**
 * For API routes that only SLAB super admins may use. Returns the user, or null
 * (the route should answer 401/403). Reads the session cookie, never trusts the body.
 */
export async function requireSuperAdmin(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') return null
  return { id: user.id, email: user.email ?? null }
}

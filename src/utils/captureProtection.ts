import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Whether this viewer gets the screenshot/recording deterrent (CaptureGuard).
 * On for everyone except SLAB super admins (Duncan, 2026-11-18). A company can be switched
 * off with company_app_config.features.captureProtection = false. Lookup errors keep it on.
 */
export async function isCaptureProtected(
  supabase: SupabaseClient,
  profile: { role?: string | null; company_id?: string | null } | null
): Promise<boolean> {
  if (profile?.role === 'super_admin') return false
  if (!profile?.company_id) return true
  const { data } = await supabase
    .from('company_app_config')
    .select('features')
    .eq('company_id', profile.company_id)
    .maybeSingle()
  return (data?.features as Record<string, unknown> | null)?.captureProtection !== false
}

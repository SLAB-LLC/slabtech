import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Whether this viewer gets the screenshot/recording deterrent (CaptureGuard).
 * On for one person with user_profiles.capture_protected, or for a whole company with
 * company_app_config.features.captureProtection (sql/capture-protection.sql).
 * SLAB super admins never get it. Any lookup error means "off", so pages never break.
 */
export async function isCaptureProtected(
  supabase: SupabaseClient,
  userId: string,
  profile: { role?: string | null; company_id?: string | null } | null
): Promise<boolean> {
  if (!profile || profile.role === 'super_admin') return false
  const [{ data: me }, { data: config }] = await Promise.all([
    supabase.from('user_profiles').select('capture_protected').eq('id', userId).maybeSingle(),
    profile.company_id
      ? supabase.from('company_app_config').select('features').eq('company_id', profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if ((me as { capture_protected?: boolean } | null)?.capture_protected) return true
  return (config?.features as Record<string, unknown> | null)?.captureProtection === true
}

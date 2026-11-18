import type { SupabaseClient } from '@supabase/supabase-js'

export type CaptureProtection = { on: boolean; watermark: boolean }

/**
 * Screenshot/recording deterrent (CaptureGuard): on for everyone except SLAB super admins
 * (a company can opt out with company_app_config.features.captureProtection = false).
 * The email watermark only shows for prospect logins with user_profiles.capture_protected
 * (Duncan, 2026-11-18: watermark is for Devin only). Lookup errors keep the guard on.
 */
export async function getCaptureProtection(
  supabase: SupabaseClient,
  userId: string,
  profile: { role?: string | null; company_id?: string | null } | null
): Promise<CaptureProtection> {
  if (profile?.role === 'super_admin') return { on: false, watermark: false }
  const [{ data: me }, { data: config }] = await Promise.all([
    supabase.from('user_profiles').select('capture_protected').eq('id', userId).maybeSingle(),
    profile?.company_id
      ? supabase.from('company_app_config').select('features').eq('company_id', profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const watermark = !!(me as { capture_protected?: boolean } | null)?.capture_protected
  const companyOff = (config?.features as Record<string, unknown> | null)?.captureProtection === false
  return { on: watermark || !companyOff, watermark }
}

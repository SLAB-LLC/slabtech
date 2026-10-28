import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { assignableRoles, canManageCompany, isLevel, isRole, type UserLevel, type UserRole } from './roles'

/**
 * Creating and changing accounts, the same rules whether a SLAB admin does it from the admin pages or an
 * owner does it from their company portal (and the same rows the app reads).
 */

export interface Actor {
  id: string
  role: string
  company_id: string | null
}

export class AccountError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/** The signed-in account, if it may manage companies */
export async function getManagingActor(supabase: SupabaseClient): Promise<Actor> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new AccountError('Unauthorized', 401)
  const { data: profile } = await supabase.from('user_profiles').select('role, company_id').eq('id', user.id).single()
  if (!profile || !canManageCompany(profile.role)) throw new AccountError('Forbidden', 403)
  return { id: user.id, role: profile.role, company_id: profile.company_id }
}

/** Owners act only inside their own company; SLAB admins anywhere */
export function companyFor(actor: Actor, requested: string | null | undefined): string {
  if (actor.role === 'super_admin') {
    const id = requested || actor.company_id
    if (!id) throw new AccountError('Pick a company')
    return id
  }
  if (requested && requested !== actor.company_id) throw new AccountError('Owners can only manage their own company', 403)
  if (!actor.company_id) throw new AccountError('Your account has no company', 403)
  return actor.company_id
}

function checkRole(actor: Actor, role: unknown): UserRole {
  const r = role ?? 'user'
  if (!isRole(r)) throw new AccountError('Unknown role')
  if (!assignableRoles(actor.role).includes(r)) throw new AccountError('You can’t give that role', 403)
  return r
}

function checkLevel(level: unknown): UserLevel {
  const l = level ?? 'rookie'
  if (!isLevel(l)) throw new AccountError('Level must be rookie or vet')
  return l
}

async function checkSeats(service: SupabaseClient, companyId: string) {
  const { data: company } = await service.from('companies').select('account_limit').eq('id', companyId).single()
  if (!company) throw new AccountError('Company not found', 404)
  if (!company.account_limit) return
  const { count } = await service
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true)
  if ((count ?? 0) >= company.account_limit) {
    throw new AccountError(`Account limit reached (${company.account_limit} users)`)
  }
}

export interface NewAccount {
  email: string
  password: string
  displayName?: string | null
  role?: string
  level?: string
  companyId?: string | null
}

/** Makes the login and its profile; the profile always ends up with the role, level and company asked for */
export async function provisionAccount(input: { email: string; password: string; displayName: string | null; role: UserRole; level: UserLevel; companyId: string; teamId?: string | null }) {
  const service = createServiceRoleClient()
  const { data, error } = await service.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      display_name: input.displayName || input.email,
      role: input.role,
      level: input.level,
      company_id: input.companyId,
    },
  })
  if (error || !data.user) throw new AccountError(error?.message || 'Failed to create user', 500)

  // The sign-up trigger makes the profile; set the fields here too so an older trigger can't leave them off
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert(
      {
        id: data.user.id,
        email: input.email,
        display_name: input.displayName || input.email,
        role: input.role,
        level: input.level,
        company_id: input.companyId,
        ...(input.teamId ? { team_id: input.teamId } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
  if (profileError) {
    await service.auth.admin.deleteUser(data.user.id).catch(() => {})
    throw new AccountError(`Profile could not be saved: ${profileError.message}`, 500)
  }
  return data.user
}

/** An owner or SLAB admin creating an account */
export async function createAccount(actor: Actor, body: NewAccount) {
  const email = String(body.email || '').trim()
  const password = String(body.password || '')
  if (!email || !password) throw new AccountError('Email and password are required')
  if (password.length < 6) throw new AccountError('Password must be at least 6 characters')

  const role = checkRole(actor, body.role)
  const level = checkLevel(body.level)
  const companyId = companyFor(actor, body.companyId)
  const service = createServiceRoleClient()
  await checkSeats(service, companyId)

  return provisionAccount({ email, password, displayName: body.displayName?.trim() || null, role, level, companyId })
}

export interface AccountChanges {
  is_active?: boolean
  role?: string
  level?: string
  display_name?: string
  company_id?: string
}

/** An owner or SLAB admin changing an account */
export async function updateAccount(actor: Actor, targetId: string, body: AccountChanges) {
  const service = createServiceRoleClient()
  const { data: target } = await service.from('user_profiles').select('id, role, company_id').eq('id', targetId).single()
  if (!target) throw new AccountError('User not found', 404)
  if (actor.role !== 'super_admin') {
    if (target.company_id !== actor.company_id) throw new AccountError('Forbidden', 403)
    // Owners can't touch SLAB admins
    if (target.role === 'super_admin') throw new AccountError('Forbidden', 403)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (body.role !== undefined) updates.role = checkRole(actor, body.role)
  if (body.level !== undefined) updates.level = checkLevel(body.level)
  if (typeof body.display_name === 'string' && body.display_name.trim()) updates.display_name = body.display_name.trim()
  if (body.company_id !== undefined) {
    if (actor.role !== 'super_admin') throw new AccountError('Only SLAB admins can move people between companies', 403)
    updates.company_id = body.company_id
  }
  if (targetId === actor.id && updates.role && updates.role !== actor.role) {
    throw new AccountError('You can’t change your own role')
  }
  if (Object.keys(updates).length === 0) throw new AccountError('No valid updates provided')

  updates.updated_at = new Date().toISOString()
  const { error } = await service.from('user_profiles').update(updates).eq('id', targetId)
  if (error) throw new AccountError(error.message, 500)
}

export function accountErrorResponse(err: unknown) {
  const status = err instanceof AccountError ? err.status : 500
  const message = err instanceof Error ? err.message : 'Something went wrong'
  if (status === 500) console.error('Account error:', err)
  return { body: { error: message }, status }
}

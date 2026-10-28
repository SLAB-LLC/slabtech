// One set of roles for the website and the app. See sql/roles-migration.sql.

export type UserRole = 'super_admin' | 'company_admin' | 'manager' | 'user'
export type UserLevel = 'rookie' | 'vet'

/** Roles a company account can hold, lowest first */
export const COMPANY_ROLES: UserRole[] = ['user', 'manager', 'company_admin']
export const ALL_ROLES: UserRole[] = [...COMPANY_ROLES, 'super_admin']
export const LEVELS: UserLevel[] = ['rookie', 'vet']

export const ROLE_LABELS: Record<UserRole, string> = {
  user: 'Rep',
  manager: 'Manager',
  company_admin: 'Owner',
  // SLAB admins own every company
  super_admin: 'Owner · SLAB admin',
}

export const LEVEL_LABELS: Record<UserLevel, string> = {
  rookie: 'Rookie',
  vet: 'Vet',
}

export const roleLabel = (role: string | null | undefined) => ROLE_LABELS[role as UserRole] ?? 'Rep'
export const levelLabel = (level: string | null | undefined) => LEVEL_LABELS[level as UserLevel] ?? 'Rookie'

/** Owners and SLAB admins run a company: create accounts, set roles and levels */
export const canManageCompany = (role: string | null | undefined) => role === 'company_admin' || role === 'super_admin'

/** The roles an account may hand out: owners up to owner, SLAB admins anything */
export function assignableRoles(actorRole: string | null | undefined): UserRole[] {
  if (actorRole === 'super_admin') return ALL_ROLES
  if (actorRole === 'company_admin') return COMPANY_ROLES
  return []
}

export const isRole = (v: unknown): v is UserRole => typeof v === 'string' && (ALL_ROLES as string[]).includes(v)
export const isLevel = (v: unknown): v is UserLevel => typeof v === 'string' && (LEVELS as string[]).includes(v)

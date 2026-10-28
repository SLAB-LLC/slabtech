'use client'

import { useState } from 'react'
import {
  assignableRoles,
  LEVEL_LABELS,
  LEVELS,
  roleLabel,
  ROLE_LABELS,
  type UserLevel,
  type UserRole,
} from '@/utils/users/roles'

/**
 * The account form and role/level pickers, shared by the SLAB admin user page and each company's
 * portal so creating or changing an account looks and works the same in both.
 */

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-success-gold focus:border-transparent'

interface CreateAccountModalProps {
  /** The signed-in account's role, which decides the roles on offer */
  actorRole: string
  /** SLAB admins pick a company; owners always create in their own */
  companies?: { id: string; name: string }[]
  companyId?: string | null
  seatsNote?: string | null
  onClose: () => void
  onCreated: () => void
}

export function CreateAccountModal({ actorRole, companies, companyId, seatsNote, onClose, onCreated }: CreateAccountModalProps) {
  const roles = assignableRoles(actorRole)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [level, setLevel] = useState<UserLevel>('rookie')
  const [company, setCompany] = useState(companyId || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/company/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: displayName, role, level, company_id: company || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create user')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-midnight-blue mb-4">Create New User</h2>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Email *</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="user@example.com" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Name</span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} placeholder="John Doe" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Password *</span>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="Minimum 6 characters" />
          </label>
          {companies && (
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Company *</span>
              <select required value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass}>
                <option value="">Pick a company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputClass}>
                {roles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Level</span>
              <select value={level} onChange={(e) => setLevel(e.target.value as UserLevel)} className={inputClass}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Vets get every lesson, the Vault and chat open from day one. Rookies unlock them as they go.
          </p>
          {seatsNote && <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">{seatsNote}</p>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-success-gold text-white font-semibold rounded-lg hover:bg-amber-500 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface RoleLevelPickerProps {
  actorRole: string
  userId: string
  role: string
  level: string | null
  /** Your own role can't be changed from here */
  isSelf?: boolean
  onChanged: () => void
  onError?: (message: string) => void
}

/** Role and level for one account, changeable in place by owners and SLAB admins */
export function RoleLevelPicker({ actorRole, userId, role, level, isSelf, onChanged, onError }: RoleLevelPickerProps) {
  const roles = assignableRoles(actorRole)
  const [busy, setBusy] = useState(false)
  const canEditRole = !isSelf && roles.includes(role as UserRole)

  const save = async (changes: { role?: string; level?: string }) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/company/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update user')
      onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user'
      if (onError) onError(message)
      else alert(message)
    } finally {
      setBusy(false)
    }
  }

  const pill = 'px-2 py-1 text-xs font-medium rounded-full border border-gray-200 bg-white disabled:opacity-50'
  return (
    <div className="flex items-center gap-2">
      {canEditRole ? (
        <select aria-label="Role" disabled={busy} value={role} onChange={(e) => save({ role: e.target.value })} className={pill}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      ) : (
        <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">{roleLabel(role)}</span>
      )}
      <select aria-label="Level" disabled={busy || roles.length === 0} value={level || 'rookie'} onChange={(e) => save({ level: e.target.value })} className={pill}>
        {LEVELS.map((l) => (
          <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
        ))}
      </select>
    </div>
  )
}

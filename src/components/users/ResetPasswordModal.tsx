'use client'

import { useState } from 'react'

/**
 * Set a new password for a rep who forgot theirs. Comes pre-filled with an easy one to read out loud,
 * then shows the login to copy and text them. Used by the SLAB admin pages and each company's portal.
 */

const WORDS = ['door', 'knock', 'close', 'slab', 'pitch', 'grind', 'route', 'pest', 'deal', 'block', 'gold', 'win']

export function generatePassword() {
  const rand = (n: number) => {
    const a = new Uint32Array(1)
    crypto.getRandomValues(a)
    return a[0] % n
  }
  const word = WORDS[rand(WORDS.length)]
  return `${word[0].toUpperCase()}${word.slice(1)}${1000 + rand(9000)}`
}

interface ResetPasswordModalProps {
  userId: string
  name: string
  email: string
  onClose: () => void
}

export function ResetPasswordModal({ userId, name, email, onClose }: ResetPasswordModalProps) {
  const [password, setPassword] = useState(generatePassword)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/company/users/${userId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not reset the password')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password')
    } finally {
      setSaving(false)
    }
  }

  const loginText = `Your SLAB login\nEmail: ${email}\nPassword: ${password}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(loginText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: the text is on screen to copy by hand
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-gray-900">Reset password</h2>
        <p className="text-sm text-gray-600 mt-1 mb-4">{name}{name !== email && <span className="text-gray-400"> · {email}</span>}</p>

        {done ? (
          <>
            <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 mb-4 text-sm">
              Done. Their old password no longer works. Send them this:
            </div>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-900 whitespace-pre-wrap select-all mb-4">{loginText}</pre>
            <div className="flex gap-3">
              <button onClick={copy} className="flex-1 px-4 py-2 bg-success-gold text-black font-semibold rounded-lg hover:bg-amber-500">
                {copied ? 'Copied ✓' : 'Copy login'}
              </button>
              <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={save}>
            <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
            <div className="flex gap-2 mb-1">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono focus:ring-2 focus:ring-success-gold focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
              >
                New one
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">At least 6 characters. Type your own or use the one we made.</p>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 mb-4 text-sm">{error}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || password.length < 6}
                className="flex-1 px-4 py-2 bg-success-gold text-black font-semibold rounded-lg hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Set password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'

// Reps use SLAB on their phone, so a new account is sent to the app, not the website.
const APP_STORE_URL = 'https://apps.apple.com/app/id6760921958'

interface Invite {
  id: string
  token: string
  email: string
  role: string
  companies: {
    name: string
    slug: string
    logo_url: string | null
    primary_color: string
    secondary_color: string
  }
}

export default function InviteAcceptForm({ invite }: { invite: Invite }) {
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    // Validate password length
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setLoading(false)
      return
    }

    try {
      // Call API to accept invite and create user
      const response = await fetch(`/api/invite/${invite.token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, displayName }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to accept invite')
      }

      // Account is ready: send them to the app instead of the website
      setDone(true)
      setLoading(false)
    } catch (err) {
      console.error('Accept invite error:', err)
      setError(err instanceof Error ? err.message : 'Failed to accept invite')
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f] px-4">
        <div
          className="max-w-md w-full bg-[#001155]/80 rounded-lg p-8 border-2 backdrop-blur-sm text-center"
          style={{ borderColor: invite.companies.primary_color }}
        >
          {invite.companies.logo_url && (
            <div className="flex justify-center mb-4">
              <img src={invite.companies.logo_url} alt={invite.companies.name} className="h-16 object-contain" />
            </div>
          )}
          <h1 className="text-2xl font-bold mb-2" style={{ color: invite.companies.primary_color }}>
            You&apos;re in!
          </h1>
          <p className="text-gray-300 mb-6">
            Your {invite.companies.name} account is ready. Get the SLAB app and sign in with{' '}
            <span className="font-semibold text-white">{invite.email}</span> and the password you just made.
          </p>
          <a
            href={APP_STORE_URL}
            className="block w-full py-3 rounded-md font-semibold hover:opacity-90"
            style={{ backgroundColor: invite.companies.primary_color, color: '#000' }}
          >
            Download SLAB on the App Store
          </a>
          <p className="mt-3 text-sm text-gray-400">Already have the app? Just open it and sign in.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f]">
      <div
        className="max-w-md w-full bg-[#001155]/80 rounded-lg p-8 border-2 backdrop-blur-sm"
        style={{ borderColor: invite.companies.primary_color }}
      >
        {/* Company Logo */}
        {invite.companies.logo_url && (
          <div className="flex justify-center mb-4">
            <img
              src={invite.companies.logo_url}
              alt={invite.companies.name}
              className="h-16 object-contain"
            />
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: invite.companies.primary_color }}
          >
            Join {invite.companies.name}
          </h1>
          <p className="text-sm text-gray-300">
            You&apos;ve been invited to join as a <span className="font-semibold">{invite.role}</span>
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500 rounded-md">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleAccept} className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: invite.companies.primary_color }}
            >
              Email
            </label>
            <input
              type="email"
              value={invite.email}
              disabled
              className="w-full px-4 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: invite.companies.primary_color }}
            >
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-2 rounded-md bg-[#001155] border border-gray-600 text-white focus:outline-none disabled:opacity-50"
              placeholder="Your name"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: invite.companies.primary_color }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
              className="w-full px-4 py-2 rounded-md bg-[#001155] border border-gray-600 text-white focus:outline-none disabled:opacity-50"
              placeholder="At least 6 characters"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: invite.companies.primary_color }}
            >
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
              className="w-full px-4 py-2 rounded-md bg-[#001155] border border-gray-600 text-white focus:outline-none disabled:opacity-50"
              placeholder="Re-enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-md font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            style={{ backgroundColor: invite.companies.primary_color, color: '#000' }}
          >
            {loading ? 'Creating Account...' : 'Accept Invite & Create Account'}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Powered by <span style={{ color: invite.companies.primary_color }}>SLAB</span>
        </p>
      </div>
    </div>
  )
}

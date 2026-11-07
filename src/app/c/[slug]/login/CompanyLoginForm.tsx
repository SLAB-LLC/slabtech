'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

interface Company {
  name: string
  slug: string
  logo_url: string | null
  primary_color: string
  secondary_color: string
}

export default function CompanyLoginForm({ company, next }: { company: Company; next?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        throw authError
      }

      // Log login activity
      await fetch('/api/auth/log-login', { method: 'POST' }).catch((err) =>
        console.error('Failed to log login:', err)
      )

      router.push(next || `/c/${company.slug}/dashboard`)
      router.refresh()
    } catch (err) {
      console.error('Login error:', err)
      setError(err instanceof Error ? err.message : 'Failed to sign in')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f]">
      <div
        className="max-w-md w-full bg-[#001155]/80 rounded-lg p-8 border-2 backdrop-blur-sm"
        style={{ borderColor: company.primary_color }}
      >
        {/* Company Logo */}
        {company.logo_url && (
          <div className="flex justify-center mb-4">
            <img src={company.logo_url} alt={company.name} className="h-16 object-contain" />
          </div>
        )}

        {/* Company Name */}
        <h1
          className="text-2xl font-bold text-center mb-2"
          style={{ color: company.primary_color }}
        >
          {company.name}
        </h1>
        <p className="text-center text-gray-400 mb-6">Sign in to continue</p>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500 rounded-md">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: company.primary_color }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-2 rounded-md bg-[#001155] border border-gray-600 text-white focus:outline-none focus:border-opacity-70 disabled:opacity-50"
              style={{ borderColor: loading ? 'gray' : company.primary_color }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: company.primary_color }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-2 rounded-md bg-[#001155] border border-gray-600 text-white focus:outline-none focus:border-opacity-70 disabled:opacity-50"
              style={{ borderColor: loading ? 'gray' : company.primary_color }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-md font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            style={{ backgroundColor: company.primary_color, color: '#000' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Powered by <span style={{ color: company.primary_color }}>SLAB Voice</span>
        </p>
      </div>
    </div>
  )
}

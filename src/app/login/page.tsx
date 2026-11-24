'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

// Force dynamic rendering to prevent static export issues
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const supabase = createClient()

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      // Log the login for tracking
      await fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      // Check user role and redirect accordingly
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, company_id, companies(slug)')
        .eq('id', data.user.id)
        .single()

      console.log('Login profile:', profile) // Debug log

      if (profile?.role === 'super_admin') {
        router.push('/admin')
      } else if (profile?.role === 'company_admin' || profile?.role === 'user') {
        // Company users go to their company dashboard
        const companySlug = (profile.companies as any)?.slug
        if (companySlug) {
          router.push(`/c/${companySlug}/dashboard`)
        } else {
          // If no company slug found, show error
          setMessage({
            type: 'error',
            text: 'User is not assigned to a company. Please contact support.',
          })
          setLoading(false)
          return
        }
      } else {
        // Fallback for legacy users
        router.push('/user/dashboard')
      }
      router.refresh()
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Invalid email or password',
      })
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f] px-4 py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Grain overlay for texture */}
      <div
        className="fixed inset-0 pointer-events-none opacity-50 z-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
        }}
      />

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <Link href="/">
            <Image
              src="/slab-logo-thermal.png"
              alt="SLAB"
              width={120}
              height={120}
              className="h-[120px] w-auto mx-auto hover:scale-110 transition-transform"
              style={{
                filter: 'drop-shadow(0 0 20px rgba(255, 140, 0, 0.8)) drop-shadow(0 0 40px rgba(255, 120, 0, 0.6))',
              }}
              priority
            />
          </Link>
          <h2 className="mt-6 text-4xl font-bold tracking-wider" style={{
            color: '#f39c12',
            textShadow: '0 0 20px rgba(255, 140, 0, 1), 0 0 40px rgba(255, 140, 0, 0.8), 0 0 60px rgba(255, 120, 0, 0.6)',
          }}>
            Admin Login
          </h2>
          <p className="mt-2 text-sm" style={{ color: '#f39c12', opacity: 0.8 }}>
            Sign in to access the SLAB admin panel
          </p>
        </div>

        <div className="mt-8 bg-[#001155]/80 rounded-lg p-8 border-2 backdrop-blur-sm" style={{
          borderColor: 'rgba(243, 156, 18, 0.3)',
          boxShadow: '0 0 30px rgba(255, 140, 0, 0.2), 0 0 60px rgba(255, 120, 0, 0.1)',
        }}>
          <form className="space-y-6" onSubmit={handleLogin}>
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: '#f39c12' }}>
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-md focus:outline-none focus:ring-2 transition-all"
                style={{
                  backgroundColor: 'rgba(0, 17, 85, 0.6)',
                  border: '1px solid rgba(243, 156, 18, 0.3)',
                  color: '#fff',
                }}
                placeholder="duncan@slabtraining.com"
                disabled={loading}
              />
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2" style={{ color: '#f39c12' }}>
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-md focus:outline-none focus:ring-2 transition-all"
                style={{
                  backgroundColor: 'rgba(0, 17, 85, 0.6)',
                  border: '1px solid rgba(243, 156, 18, 0.3)',
                  color: '#fff',
                }}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 rounded-md font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: '#f39c12',
                  color: '#000',
                  boxShadow: '0 0 20px rgba(255, 140, 0, 0.4), 0 0 40px rgba(255, 120, 0, 0.2)',
                }}
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </div>

            {/* Message Display */}
            {message && (
              <div
                className={`rounded-md p-4 ${
                  message.type === 'success'
                    ? 'bg-success-gold bg-opacity-10 border border-success-gold border-opacity-20'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-red-400"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-red-800">{message.text}</p>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Back to Home Link */}
        <div className="text-center">
          <Link
            href="/"
            className="text-sm transition-colors"
            style={{ color: '#f39c12' }}
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}

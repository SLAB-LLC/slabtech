'use client'

import { useState } from 'react'

const APP_STORE_URL = 'https://apps.apple.com/app/id6760921958'

export default function WelcomeForm(props: { token: string; email: string; company: string; logo: string | null; color: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) return setError('Passwords do not match')
    if (password.length < 8) return setError('Use at least 8 characters')
    setLoading(true)
    try {
      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: props.token, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not set your password')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password')
    } finally {
      setLoading(false)
    }
  }

  const card = 'max-w-md w-full bg-[#001155]/80 rounded-lg p-8 border-2 backdrop-blur-sm'
  const shell = 'min-h-screen flex items-center justify-center bg-gradient-to-br from-[#000033] via-[#001199] to-[#0a1a5f] px-4'
  const logo = props.logo ? (
    <div className="flex justify-center mb-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.logo} alt={props.company} className="h-16 object-contain" />
    </div>
  ) : null

  if (done) {
    return (
      <div className={shell}>
        <div className={`${card} text-center`} style={{ borderColor: props.color }}>
          {logo}
          <h1 className="text-2xl font-bold mb-2" style={{ color: props.color }}>You&apos;re all set</h1>
          <p className="text-gray-300 mb-6">
            Get the SLAB app and sign in with <span className="font-semibold text-white">{props.email}</span> and the password you just made.
          </p>
          <a href={APP_STORE_URL} className="block w-full py-3 rounded-md font-semibold hover:opacity-90" style={{ backgroundColor: props.color, color: '#000' }}>
            Download SLAB on the App Store
          </a>
          <p className="mt-3 text-sm text-gray-400">Already have the app? Just open it and sign in.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={shell}>
      <div className={card} style={{ borderColor: props.color }}>
        {logo}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2" style={{ color: props.color }}>Set your password</h1>
          <p className="text-sm text-gray-300">
            Your {props.company || 'SLAB'} account: <span className="font-semibold text-white">{props.email}</span>
          </p>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500 rounded-md">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <input type="email" value={props.email} autoComplete="username" readOnly hidden />
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: props.color }}>New password</label>
            <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-3 py-2 bg-[#000033] border border-gray-600 rounded-md text-white focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: props.color }}>Confirm password</label>
            <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required
              className="w-full px-3 py-2 bg-[#000033] border border-gray-600 rounded-md text-white focus:outline-none" />
          </div>
          <button type="submit" disabled={loading} className="w-full py-3 rounded-md font-semibold hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: props.color, color: '#000' }}>
            {loading ? 'Saving…' : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  )
}

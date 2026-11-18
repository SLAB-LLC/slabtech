'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heading, Text, Container } from '@/components'

// Login-sharing review (super admins). Flags come from sql/login-sharing-protection.sql.

interface Flag {
  user_id: string
  status: 'flagged' | 'cleared' | 'locked'
  reason: string | null
  overlap_count: number
  network_count: number
  flagged_at: string
  last_event_at: string
  notified_at: string | null
  reviewed_at: string | null
  note: string | null
}

interface Login {
  created_at: string
  ip: string | null
  device: string | null
  overlap: boolean
  signed_out_others: number
}

interface Person {
  email: string | null
  name: string | null
  role: string
  sharedLoginOk: boolean
  company: string | null
  logins: Login[]
}

interface Overlap {
  user_id: string
  created_at: string
  ip: string | null
  device: string | null
  other_ip: string | null
  other_device: string | null
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const STATUS_STYLE: Record<Flag['status'], string> = {
  flagged: 'bg-orange-100 text-orange-800',
  locked: 'bg-red-100 text-red-800',
  cleared: 'bg-gray-100 text-gray-600',
}

export default function SecurityPage() {
  const [flags, setFlags] = useState<Flag[]>([])
  const [overlaps, setOverlaps] = useState<Overlap[]>([])
  const [people, setPeople] = useState<Record<string, Person>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showCleared, setShowCleared] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/security')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load')
      setFlags(data.flags)
      setOverlaps(data.overlaps)
      setPeople(data.people)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = async (userId: string, action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(userId + action)
    try {
      const res = await fetch('/api/admin/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const label = (id: string) => {
    const p = people[id]
    return p ? p.name || p.email || id : id
  }

  const visible = flags.filter((f) => showCleared || f.status !== 'cleared')
  const flaggedIds = new Set(flags.map((f) => f.user_id))
  const otherOverlaps = overlaps.filter((o) => !flaggedIds.has(o.user_id))

  const Button = ({ userId, action, children, tone = 'gray', confirmText }: { userId: string; action: string; children: React.ReactNode; tone?: 'gray' | 'red' | 'gold'; confirmText?: string }) => (
    <button
      onClick={() => act(userId, action, confirmText)}
      disabled={busy !== null}
      className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 ${
        tone === 'red' ? 'bg-red-600 text-white hover:bg-red-700' : tone === 'gold' ? 'bg-success-gold text-white hover:opacity-90' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
      }`}
    >
      {busy === userId + action ? '…' : children}
    </button>
  )

  const LoginTable = ({ logins }: { logins: Login[] }) => (
    <table className="w-full text-sm mt-3">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-4 font-medium">Signed in</th>
          <th className="py-1 pr-4 font-medium">Device</th>
          <th className="py-1 pr-4 font-medium">IP</th>
          <th className="py-1 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {logins.map((l, i) => (
          <tr key={i} className="border-t border-gray-100">
            <td className="py-1 pr-4">{when(l.created_at)}</td>
            <td className="py-1 pr-4">{l.device}</td>
            <td className="py-1 pr-4 font-mono">{l.ip ?? '?'}</td>
            <td className="py-1">
              {l.overlap && <span className="text-orange-700 font-medium">overlap</span>}
              {l.signed_out_others > 0 && <span className="text-gray-500 ml-2">signed out {l.signed_out_others} other</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="min-h-screen bg-gray-100">
      <Container maxWidth="xl" padding="lg">
        <div className="mb-6">
          <Heading level={1} size="xl" className="text-gray-900">
            Security
          </Heading>
          <Text variant="muted" className="mt-2 text-gray-600">
            Each account can be signed in on one device at a time; a new sign-in signs the other device out. An account is flagged
            after 3 sign-ins in a week that overlapped with another device on a different network, or 4+ networks in a day.
            Flags never lock anyone automatically.
          </Text>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <Text className="text-red-800">{error}</Text>
          </div>
        )}

        {loading ? (
          <Text>Loading…</Text>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <Heading level={2} size="lg" className="text-gray-900">
                Flagged accounts ({flags.filter((f) => f.status === 'flagged').length})
              </Heading>
              <label className="text-sm text-gray-600 flex items-center gap-2">
                <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} />
                Show cleared
              </label>
            </div>

            {visible.length === 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
                <Text className="text-gray-600">No flagged accounts.</Text>
              </div>
            )}

            <div className="space-y-4 mb-10">
              {visible.map((f) => {
                const p = people[f.user_id]
                return (
                  <div key={f.user_id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{label(f.user_id)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[f.status]}`}>{f.status}</span>
                          {p?.sharedLoginOk && <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">multi-device allowed</span>}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {p?.email}
                          {p?.company ? ` · ${p.company}` : ''}
                        </div>
                        <div className="text-sm text-gray-800 mt-2">{f.reason}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Flagged {when(f.flagged_at)} · last sign-in {when(f.last_event_at)}
                          {f.notified_at ? ' · emailed' : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {f.status === 'flagged' && <Button userId={f.user_id} action="clear">Clear</Button>}
                        <Button userId={f.user_id} action="signout" confirmText="Sign this account out on every device?">
                          Sign out everywhere
                        </Button>
                        {f.status === 'locked' ? (
                          <Button userId={f.user_id} action="unlock" tone="gold">Unlock</Button>
                        ) : (
                          <Button userId={f.user_id} action="lock" tone="red" confirmText="Lock this account? It is signed out everywhere and can't sign in until you unlock it.">
                            Lock
                          </Button>
                        )}
                        <Button userId={f.user_id} action={p?.sharedLoginOk ? 'unexempt' : 'exempt'}>
                          {p?.sharedLoginOk ? 'One device only' : 'Allow multi-device'}
                        </Button>
                        <button onClick={() => setOpen(open === f.user_id ? null : f.user_id)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">
                          {open === f.user_id ? 'Hide sign-ins' : 'Sign-ins'}
                        </button>
                      </div>
                    </div>
                    {open === f.user_id && p && <LoginTable logins={p.logins} />}
                  </div>
                )
              })}
            </div>

            <Heading level={2} size="lg" className="text-gray-900 mb-1">
              Other overlapping sign-ins (14 days)
            </Heading>
            <Text variant="muted" className="text-gray-600 mb-3">
              Below the flag line. One now and then is normal (a phone on cell data and a laptop on wifi).
            </Text>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              {otherOverlaps.length === 0 ? (
                <Text className="text-gray-600">None.</Text>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {otherOverlaps.map((o, i) => (
                      <tr key={i} className="border-t border-gray-100 first:border-0">
                        <td className="py-1.5 pr-4 font-medium">{label(o.user_id)}</td>
                        <td className="py-1.5 pr-4 text-gray-600">{people[o.user_id]?.company}</td>
                        <td className="py-1.5 pr-4">{when(o.created_at)}</td>
                        <td className="py-1.5 pr-4 font-mono text-gray-700">
                          {o.device} {o.ip} ← {o.other_device} {o.other_ip}
                        </td>
                        <td className="py-1.5 text-right">
                          <Button userId={o.user_id} action="signout" confirmText="Sign this account out on every device?">
                            Sign out
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </Container>
    </div>
  )
}

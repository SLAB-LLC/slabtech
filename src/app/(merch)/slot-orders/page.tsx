'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heading, Text, Container } from '@/components'
import { createClient } from '@/utils/supabase/client'

// SLAB Slots prizes SLAB has to fulfill (super admins): real merch wins and Zach Kornfeld pitch video
// requests. Spins and orders come from sql/slot-machine-migration.sql (slot_admin_orders / slot_admin_update).

interface Claim {
  name?: string
  address?: string
  phone?: string
  size?: string
  note?: string
}

interface Order {
  id: string
  outcome: 'merch' | 'video'
  prize: string
  status: 'requested' | 'shipped' | 'cancelled'
  claim: Claim | null
  note: string | null
  at: string
  fulfilledAt: string | null
  rep: string | null
  email: string | null
  company: string | null
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const STATUS_STYLE: Record<Order['status'], string> = {
  requested: 'bg-orange-100 text-orange-800',
  shipped: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

export default function SlotOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('slot_admin_orders')
    if (error) setError(error.message)
    else {
      setOrders((data as Order[]) ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const update = async (o: Order, status: Order['status']) => {
    let note: string | null = null
    if (status === 'shipped') {
      note = window.prompt(o.outcome === 'video' ? 'Note (optional), e.g. "added to Vault"' : 'Tracking number or note (optional)')
      if (note === null) return
    } else if (status === 'cancelled' && !window.confirm(`Cancel ${o.prize} for ${o.rep ?? 'this rep'}?`)) return
    setBusy(o.id)
    const { error } = await createClient().rpc('slot_admin_update', { p_spin_id: o.id, p_status: status, p_note: note || null })
    if (error) setError(error.message)
    await load()
    setBusy(null)
  }

  const open = orders.filter((o) => o.status === 'requested')
  const visible = showDone ? orders : open
  const merchThisMonth = orders.filter((o) => o.outcome === 'merch' && new Date(o.at).getMonth() === new Date().getMonth() && new Date(o.at).getFullYear() === new Date().getFullYear() && o.status !== 'cancelled').length

  return (
    <div className="min-h-screen bg-gray-100">
      <Container maxWidth="xl" padding="lg">
        <div className="mb-6">
          <Heading level={1} size="xl" className="text-gray-900">
            Slot Orders
          </Heading>
          <Text variant="muted" className="mt-2 text-gray-600">
            Prizes reps won on SLAB Slots that SLAB has to fulfill: real merch (SLAB pays, capped at 1 a month across all companies)
            and Zach Kornfeld full pitch videos. Mark each one done once it ships or lands in their Vault.
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
          <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-800 font-medium">{open.length} open</span>
          <span className="text-gray-600">Merch won this month: {merchThisMonth} of 1</span>
          <label className="flex items-center gap-2 text-gray-700 ml-auto">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show shipped and cancelled
          </label>
        </div>

        {error && <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">{error}</div>}

        {loading ? (
          <Text>Loading…</Text>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No open slot orders.</div>
        ) : (
          <div className="space-y-3">
            {visible.map((o) => {
              const c = o.claim ?? {}
              const needsAddress = o.outcome === 'merch' && !c.address
              return (
                <div key={o.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">{o.prize}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${o.outcome === 'merch' ? 'bg-yellow-100 text-yellow-800' : 'bg-purple-100 text-purple-800'}`}>
                          {o.outcome === 'merch' ? 'Merch' : 'Video'}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[o.status]}`}>{o.status}</span>
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {o.rep ?? 'Unknown rep'}
                        {o.email && o.email !== o.rep ? ` · ${o.email}` : ''}
                        {o.company ? ` · ${o.company}` : ''} · won {when(o.at)}
                      </div>
                    </div>
                    {o.status === 'requested' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => update(o, 'shipped')}
                          disabled={busy !== null || needsAddress}
                          title={needsAddress ? 'Waiting on the rep to add a shipping address' : undefined}
                          className="px-3 py-1.5 rounded-md text-sm font-medium bg-success-gold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {busy === o.id ? '…' : o.outcome === 'video' ? 'Mark delivered' : 'Mark shipped'}
                        </button>
                        <button
                          onClick={() => update(o, 'cancelled')}
                          disabled={busy !== null}
                          className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      o.status === 'shipped' && (
                        <button
                          onClick={() => update(o, 'requested')}
                          disabled={busy !== null}
                          className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      )
                    )}
                  </div>
                  {o.outcome === 'merch' && (
                    <div className="mt-3 text-sm text-gray-800 grid gap-1 sm:grid-cols-2">
                      {needsAddress ? (
                        <div className="text-orange-700">Waiting on the rep to add their shipping address in the app.</div>
                      ) : (
                        <>
                          <div>
                            <span className="text-gray-500">Ship to: </span>
                            {c.name}
                            <div className="whitespace-pre-line">{c.address}</div>
                          </div>
                          <div>
                            {c.size && (
                              <div>
                                <span className="text-gray-500">Size: </span>
                                {c.size}
                              </div>
                            )}
                            {c.phone && (
                              <div>
                                <span className="text-gray-500">Phone: </span>
                                {c.phone}
                              </div>
                            )}
                            {c.note && (
                              <div>
                                <span className="text-gray-500">Note: </span>
                                {c.note}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {o.outcome === 'video' && o.status === 'requested' && (
                    <div className="mt-3 text-sm text-gray-600">Add the Zach Kornfeld full pitch to this rep&apos;s saved Vault, then mark it delivered.</div>
                  )}
                  {o.note && (
                    <div className="mt-2 text-sm text-gray-600">
                      <span className="text-gray-500">Admin note: </span>
                      {o.note}
                      {o.fulfilledAt ? ` (${when(o.fulfilledAt)})` : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Container>
    </div>
  )
}

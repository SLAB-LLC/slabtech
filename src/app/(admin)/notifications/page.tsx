'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'

interface Company {
  id: string
  name: string
}

interface NotificationLog {
  id: string
  title: string
  body: string
  category: string
  target_type: string
  target_id: string | null
  recipient_count: number
  created_at: string
  broadcast_id: string | null
  company_name?: string
}

const CATEGORIES = [
  { value: 'updates', label: 'Platform Updates', icon: '✨', desc: 'App news and new features' },
  { value: 'company_alerts', label: 'Company Alert', icon: '📢', desc: 'Important company announcement' },
  { value: 'big_days', label: 'Big Day 🔥', icon: '🏆', desc: 'A Big Five member had an incredible sales day' },
  { value: 'manual', label: 'Custom', icon: '✏️', desc: 'Write your own message' },
]

const QUICK_EMOJIS = [
  '🔥', '🏆', '✨', '🎉', '🚀', '💰', '📢', '⚡',
  '🎯', '💎', '👏', '🙌', '💪', '😎', '🤩', '🎊',
  '⭐', '🌟', '🔔', '📣', '💬', '❤️', '🎁', '🥇',
]

const ACCEPTED_MIME = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/mp4,audio/wav'
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

type MediaType = 'image' | 'video' | 'audio' | 'gif'

function detectMediaType(file: File): MediaType | null {
  if (file.type === 'image/gif') return 'gif'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

export default function NotificationsPage() {
  const supabase = createClient()
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [companies, setCompanies] = useState<Company[]>([])
  const [logs, setLogs] = useState<NotificationLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)

  const [form, setForm] = useState({
    category: 'updates',
    target_type: 'all' as 'all' | 'company',
    target_id: '',
    title: '',
    body: '',
  })
  const [media, setMedia] = useState<{
    url: string
    type: MediaType
    name: string
  } | null>(null)
  const [emojiTarget, setEmojiTarget] = useState<'title' | 'body' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; message?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  // Auto-fill title/body when category changes
  useEffect(() => {
    if (form.category === 'manual') {
      setForm((f) => ({ ...f, title: '', body: '' }))
    } else if (form.category === 'big_days') {
      setForm((f) => ({
        ...f,
        title: '🔥 Big Day Alert!',
        body: 'A Big Five member just threw down a massive sales day. Check it out in the app!',
      }))
    } else if (form.category === 'updates') {
      setForm((f) => ({ ...f, title: '✨ SLAB Update', body: '' }))
    } else if (form.category === 'company_alerts') {
      setForm((f) => ({ ...f, title: '📢 Company Alert', body: '' }))
    }
  }, [form.category])

  const fetchData = async () => {
    const [{ data: companyData }, { data: logData }] = await Promise.all([
      supabase.from('companies').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('notification_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25),
    ])

    setCompanies(companyData || [])
    const enriched = (logData || []).map((log: any) => ({
      ...log,
      company_name: companyData?.find((c) => c.id === log.target_id)?.name,
    }))
    setLogs(enriched)
    setLoadingLogs(false)
  }

  const handleFile = async (file: File) => {
    setError(null)
    if (file.size > MAX_BYTES) {
      setError('File too large (max 50 MB).')
      return
    }
    const type = detectMediaType(file)
    if (!type) {
      setError('Unsupported file type.')
      return
    }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop() || 'bin'
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('notification-media')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadErr) throw uploadErr

      const { data: pub } = supabase.storage.from('notification-media').getPublicUrl(path)
      setMedia({ url: pub.publicUrl, type, name: file.name })
    } catch (e: any) {
      setError(`Upload failed: ${e.message}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const insertEmoji = (emoji: string) => {
    if (!emojiTarget) return
    const ref = emojiTarget === 'title' ? titleRef.current : bodyRef.current
    if (!ref) return
    const start = ref.selectionStart ?? form[emojiTarget].length
    const end = ref.selectionEnd ?? form[emojiTarget].length
    const before = form[emojiTarget].slice(0, start)
    const after = form[emojiTarget].slice(end)
    const next = before + emoji + after
    setForm((f) => ({ ...f, [emojiTarget]: next }))
    setTimeout(() => {
      ref.focus()
      const pos = start + emoji.length
      ref.setSelectionRange(pos, pos)
    }, 0)
  }

  const handleSend = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      setError('Title and body are required.')
      return
    }
    if (form.target_type !== 'all' && !form.target_id) {
      setError('Please select a target company.')
      return
    }

    setSending(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          category: form.category,
          target_type: form.target_type,
          target_id: form.target_id || undefined,
          media_url: media?.url ?? null,
          media_type: media?.type ?? null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')

      setResult({ sent: data.sent, message: data.message })

      // Reset form-ish state
      setMedia(null)

      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const targetLabel = (log: NotificationLog) => {
    if (log.target_type === 'all') return 'All Users'
    if (log.target_type === 'company') return log.company_name || log.target_id || '—'
    return 'Specific User'
  }

  const categoryBadge = (cat: string) => {
    const colors: Record<string, string> = {
      updates: 'bg-blue-100 text-blue-700',
      company_alerts: 'bg-orange-100 text-orange-700',
      big_days: 'bg-yellow-100 text-yellow-700',
      chats: 'bg-purple-100 text-purple-700',
      manual: 'bg-gray-100 text-gray-700',
    }
    return colors[cat] || 'bg-gray-100 text-gray-700'
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-midnight-blue">Push Notifications</h1>
        <p className="text-steel-gray mt-1">
          Send push notifications to users. Recipients must have notifications enabled on their device.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Compose form ────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-midnight-blue mb-5">Compose Notification</h2>

          {/* Category */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setForm((f) => ({ ...f, category: cat.value }))}
                  className={`flex items-start gap-2 p-3 rounded-lg border-2 text-left transition-all ${
                    form.category === cat.value
                      ? 'border-midnight-blue bg-midnight-blue/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-lg mt-0.5">{cat.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{cat.label}</div>
                    <div className="text-xs text-gray-500">{cat.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Send To</label>
            <div className="flex gap-2 mb-2">
              {(['all', 'company'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, target_type: t, target_id: '' }))}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    form.target_type === t
                      ? 'bg-midnight-blue text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'all' ? 'All Users' : 'Specific Company'}
                </button>
              ))}
            </div>
            {form.target_type === 'company' && (
              <select
                value={form.target_id}
                onChange={(e) => setForm((f) => ({ ...f, target_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-midnight-blue"
              >
                <option value="">— Select Company —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Title with emoji button */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-gray-400 font-normal">(shown bold on device)</span>
            </label>
            <div className="relative">
              <input
                ref={titleRef}
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Notification title..."
                maxLength={100}
                className="w-full border border-gray-300 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-midnight-blue"
              />
              <button
                type="button"
                onClick={() => setEmojiTarget(emojiTarget === 'title' ? null : 'title')}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 text-lg hover:bg-gray-100 rounded"
                title="Insert emoji"
              >
                😊
              </button>
            </div>
          </div>

          {/* Body with emoji button */}
          <div className="mb-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <div className="relative">
              <textarea
                ref={bodyRef}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="What do you want to say..."
                rows={3}
                maxLength={300}
                className="w-full border border-gray-300 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-midnight-blue resize-none"
              />
              <button
                type="button"
                onClick={() => setEmojiTarget(emojiTarget === 'body' ? null : 'body')}
                className="absolute right-2 top-2 px-2 text-lg hover:bg-gray-100 rounded"
                title="Insert emoji"
              >
                😊
              </button>
            </div>
            <div className="text-right text-xs text-gray-400 mt-1">{form.body.length}/300</div>
          </div>

          {/* Emoji picker panel */}
          {emojiTarget && (
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="text-xs text-gray-500 mb-2">
                Tap to insert into <span className="font-semibold">{emojiTarget}</span>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => insertEmoji(e)}
                    className="text-xl p-1.5 hover:bg-white rounded transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Media upload */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Media <span className="text-gray-400 font-normal">(optional — image, video, audio, gif)</span>
            </label>

            {!media ? (
              <label
                className={`flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                  uploading
                    ? 'border-gray-200 bg-gray-50 cursor-wait'
                    : 'border-gray-300 hover:border-midnight-blue hover:bg-midnight-blue/5'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_MIME}
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <span className="text-2xl">{uploading ? '⏳' : '📎'}</span>
                <span className="text-sm text-gray-600">
                  {uploading ? 'Uploading…' : 'Click to upload or drop file here'}
                </span>
                <span className="text-xs text-gray-400">PNG, JPG, GIF, MP4, MP3 — up to 50 MB</span>
              </label>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                {media.type === 'image' || media.type === 'gif' ? (
                  <img
                    src={media.url}
                    alt="preview"
                    className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                  />
                ) : media.type === 'video' ? (
                  <div className="w-16 h-16 bg-black rounded-lg flex items-center justify-center flex-shrink-0 text-white text-2xl">
                    🎬
                  </div>
                ) : (
                  <div className="w-16 h-16 bg-gradient-to-br from-purple-400 to-pink-500 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-2xl">
                    🎧
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{media.name}</div>
                  <div className="text-xs text-gray-500 capitalize">{media.type}</div>
                </div>
                <button
                  onClick={() => setMedia(null)}
                  className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Errors / result */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
          {result && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              {result.sent > 0
                ? `✓ Sent to ${result.sent} device${result.sent !== 1 ? 's' : ''}`
                : result.message || 'No eligible recipients found.'}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={sending || !form.title.trim() || !form.body.trim() || uploading}
            className="w-full py-3 bg-midnight-blue text-white font-semibold rounded-lg hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Send Notification'}
          </button>
        </div>

        {/* ── Live preview + log ────────────────────────────────── */}
        <div className="space-y-6">
          {/* iOS lock-screen preview */}
          <div className="bg-gradient-to-br from-purple-900 via-blue-900 to-black rounded-2xl p-6 shadow-lg">
            <div className="text-white/60 text-xs font-semibold mb-3 tracking-wider">
              LIVE PREVIEW · iOS
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-yellow-500 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  S
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-white text-xs font-semibold uppercase tracking-wide">
                      SLAB
                    </span>
                    <span className="text-white/50 text-xs">now</span>
                  </div>
                  <div className="text-white text-sm font-semibold break-words">
                    {form.title || 'Notification title'}
                  </div>
                  <div className="text-white/85 text-xs mt-0.5 break-words">
                    {form.body || 'Notification message preview…'}
                  </div>
                </div>
                {media && (media.type === 'image' || media.type === 'gif') && (
                  <img
                    src={media.url}
                    alt=""
                    className="w-12 h-12 object-cover rounded-md flex-shrink-0"
                  />
                )}
                {media && media.type === 'video' && (
                  <div className="w-12 h-12 bg-black rounded-md flex items-center justify-center flex-shrink-0 text-white text-lg">
                    🎬
                  </div>
                )}
                {media && media.type === 'audio' && (
                  <div className="w-12 h-12 bg-purple-500 rounded-md flex items-center justify-center flex-shrink-0 text-white text-lg">
                    🎧
                  </div>
                )}
              </div>
            </div>
            {media && (
              <div className="mt-3 text-center text-white/50 text-xs">
                Tapping the notification opens the broadcast view in-app with full media.
              </div>
            )}
          </div>

          {/* Recent broadcasts */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-midnight-blue mb-5">Recent Broadcasts</h2>

            {loadingLogs ? (
              <div className="text-center py-10 text-gray-400">Loading...</div>
            ) : logs.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <div className="text-3xl mb-2">📭</div>
                <div className="text-sm">No notifications sent yet.</div>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 border border-gray-100 rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-800 truncate">{log.title}</div>
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{log.body}</div>
                      </div>
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${categoryBadge(log.category)}`}
                      >
                        {log.category.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span>→ {targetLabel(log)}</span>
                      <span>•</span>
                      <span>{log.recipient_count} sent</span>
                      {log.broadcast_id && (
                        <>
                          <span>•</span>
                          <span className="text-purple-500">📎 with media</span>
                        </>
                      )}
                      <span>•</span>
                      <span>{new Date(log.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

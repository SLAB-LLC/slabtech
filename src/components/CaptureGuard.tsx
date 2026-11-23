'use client'

import { useEffect, useState } from 'react'

/**
 * Screenshot / screen-recording deterrent, on for everyone except SLAB super admins
 * (utils/captureProtection.ts).
 *
 * A browser can't truly block screenshots, so this makes any capture traceable and annoying:
 * - for prospect logins only (watermark), a tiled watermark with the viewer's email and the time
 * - the page blurs when the window loses focus or the tab is hidden (snipping tools, OBS
 *   window pickers and screen-share pickers all take focus first)
 * - the page blacks out while the browser is sharing or recording the screen through
 *   getDisplayMedia
 * - no right-click, text selection, copy, drag, save or print, and PrintScreen clears the clipboard
 */
export function CaptureGuard({ enabled, watermark = false, email, children }: { enabled: boolean; watermark?: boolean; email: string; children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false)
  const [stamp, setStamp] = useState('')

  useEffect(() => {
    if (!enabled) return
    const tick = () => setStamp(new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
    tick()
    const clock = setInterval(tick, 30000)

    const hide = () => setHidden(true)
    // Clicking into an embedded video player (iframe) also blurs the window; that's fine
    const onBlur = () => setTimeout(() => { if (document.activeElement?.tagName !== 'IFRAME') hide() }, 0)
    const inField = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, [contenteditable="true"]')
    const show = () => { if (document.visibilityState === 'visible' && document.hasFocus()) setHidden(false) }
    const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show())
    const block = (e: Event) => { if (!inField(e.target)) e.preventDefault() }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.key === 'PrintScreen') {
        hide()
        navigator.clipboard?.writeText('').catch(() => {})
        setTimeout(show, 1500)
      }
      // Save, print, view source, select all, copy
      if ((e.ctrlKey || e.metaKey) && (['s', 'p', 'u'].includes(k) || (['a', 'c'].includes(k) && !inField(e.target)))) e.preventDefault()
      // macOS screenshot shortcuts (Cmd+Shift+3/4/5) reach the page only sometimes; hide anyway
      if (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(k)) hide()
    }
    const onKeyUp = () => setTimeout(show, 300)

    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', show)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('contextmenu', block)
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('dragstart', block)
    document.addEventListener('selectstart', block)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('beforeprint', hide)
    window.addEventListener('afterprint', show)

    // Black out while this browser shares or records the screen (getDisplayMedia)
    const md = navigator.mediaDevices as (MediaDevices & { getDisplayMedia?: MediaDevices['getDisplayMedia'] }) | undefined
    const original = md?.getDisplayMedia?.bind(md)
    if (md && original) {
      md.getDisplayMedia = async (...args: Parameters<MediaDevices['getDisplayMedia']>) => {
        const stream = await original(...args)
        setHidden(true)
        const done = () => { if (stream.getTracks().every((t) => t.readyState === 'ended')) setHidden(false) }
        stream.getTracks().forEach((t) => t.addEventListener('ended', done))
        return stream
      }
    }

    document.documentElement.classList.add('capture-guard')
    return () => {
      clearInterval(clock)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', show)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('dragstart', block)
      document.removeEventListener('selectstart', block)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('beforeprint', hide)
      window.removeEventListener('afterprint', show)
      if (md && original) md.getDisplayMedia = original
      document.documentElement.classList.remove('capture-guard')
    }
  }, [enabled])

  if (!enabled) return <>{children}</>

  const label = `${email} · ${stamp} · SLAB CONFIDENTIAL`
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'><text x='10' y='120' transform='rotate(-24 210 110)' font-family='Arial, sans-serif' font-size='15' font-weight='700' fill='rgba(120,120,120,0.22)'>${escapeXml(label)}</text></svg>`

  return (
    <>
      <div style={{ filter: hidden ? 'blur(24px)' : undefined, transition: 'filter 80ms' }}>{children}</div>
      {watermark && <div
        aria-hidden
        className="capture-guard-mark"
        style={{
          position: 'fixed', inset: 0, zIndex: 2147483646, pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
          backgroundRepeat: 'repeat',
        }}
      />}
      {hidden && (
        <div
          aria-hidden
          style={{
            position: 'fixed', inset: 0, zIndex: 2147483647, background: '#000', color: '#d4af37',
            display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
            fontFamily: 'Arial, sans-serif', fontWeight: 700, letterSpacing: 1, padding: 24,
          }}
        >
          SLAB content is protected. Click back into this window to keep going.
        </div>
      )}
    </>
  )
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))
}

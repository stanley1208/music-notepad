// The "send this to a student" panel: a link, a QR code to point a phone at,
// and nothing else to configure. No server is involved — the exercise itself
// travels inside the address.

import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'

/** Whether a QR code can hold this text at all. */
export function qrFits(text: string): boolean {
  try {
    const qr = qrcode(0, 'L')
    qr.addData(text)
    qr.make()
    return true
  } catch {
    return false
  }
}

/** The QR code as an SVG path, drawn from the module matrix. */
export function QrSvg({ text, size = 190 }: { text: string; size?: number }) {
  const drawn = useMemo(() => {
    try {
      // type 0 = pick the smallest version that fits; L = most data capacity
      const qr = qrcode(0, 'L')
      qr.addData(text)
      qr.make()
      const count = qr.getModuleCount()
      let path = ''
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`
        }
      }
      // The 4-module quiet zone lives inside the viewBox, so it survives
      // whatever padding the surrounding layout does or does not apply.
      return { path, count, box: count + 8 }
    } catch {
      // too much data for any QR version
      return null
    }
  }, [text])

  if (!drawn) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded border border-stone-200 bg-stone-50 p-3 text-center text-xs text-stone-500"
      >
        This piece is too long for a QR code. The link still works.
      </div>
    )
  }
  // A denser code needs more physical room, or the modules fall below what a
  // phone camera can resolve. `size` acts as the floor.
  const drawnSize = Math.max(size, drawn.box * 3)
  return (
    <svg
      width={drawnSize}
      height={drawnSize}
      viewBox={`0 0 ${drawn.box} ${drawn.box}`}
      role="img"
      aria-label="QR code linking to this exercise"
      className="rounded border border-stone-200 bg-white p-2"
      shapeRendering="crispEdges"
    >
      <rect width={drawn.box} height={drawn.box} fill="#ffffff" />
      <path d={drawn.path} fill="#1c1917" />
    </svg>
  )
}

export default function ShareDialog({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // clipboard blocked: the box below is selectable, so nothing is lost
      setCopied(false)
    }
  }

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send to a student"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">Send to a student</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-stone-600">
          The exercise travels inside the link, so it works with no account and nothing to
          install. Opening it shows a practice page with play, a speed slider and hands
          separately.
        </p>

        <div className="mb-4 flex justify-center">
          <QrSvg text={link} />
        </div>

        <label className="mb-1 block text-xs font-medium tracking-wide text-stone-500 uppercase">
          Link
        </label>
        <div className="flex gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-2 font-mono text-xs text-stone-700"
          />
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}

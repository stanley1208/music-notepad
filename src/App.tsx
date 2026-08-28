import { useCallback, useEffect, useRef, useState } from 'react'
import abcjs from 'abcjs'
import type { CursorControl, SynthObjectController, TuneObject } from 'abcjs'
import CheatSheet from './CheatSheet'
import { TEMPLATE_ABC } from './examples'
import {
  loadCurrentId,
  loadDocs,
  newDoc,
  saveCurrentId,
  saveDocs,
  type Doc,
} from './storage'

const RENDER_DEBOUNCE_MS = 200
const SAVE_DEBOUNCE_MS = 500

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

function safeFilename(title: string): string {
  return (title.trim() || 'untitled').replace(/[\\/:*?"<>|]+/g, '-')
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  // ---- initial load (once) ----
  const initialRef = useRef<{ docs: Doc[]; id: string } | null>(null)
  if (initialRef.current === null) {
    const docs = loadDocs()
    initialRef.current = { docs, id: loadCurrentId(docs) }
  }

  const [docs, setDocs] = useState<Doc[]>(initialRef.current.docs)
  const [currentId, setCurrentId] = useState(initialRef.current.id)
  const [abc, setAbc] = useState(
    () => initialRef.current!.docs.find((d) => d.id === initialRef.current!.id)?.abc ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  // First-ever visit: open the cheat sheet so newcomers see the reference exists.
  const [cheatOpen, setCheatOpen] = useState(() => {
    try {
      return localStorage.getItem('music-notepad.visited') === null
    } catch {
      return false
    }
  })
  const [exportOpen, setExportOpen] = useState(false)
  const [bpm, setBpm] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [editorFocused, setEditorFocused] = useState(false)
  // Bumped on document switch so the render effect re-runs even when the new
  // doc's text is identical to the old one (otherwise the synth never re-arms).
  const [renderNonce, setRenderNonce] = useState(0)

  const paperRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLDivElement>(null)
  const keyBarRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const synthRef = useRef<SynthObjectController | null>(null)
  const visualRef = useRef<TuneObject | null>(null)
  const abcRef = useRef(abc)
  abcRef.current = abc

  const currentDoc = docs.find((d) => d.id === currentId)

  // abcjs 6.7: SynthController.setTune(visual, false) never clears the internal
  // isLoaded flag, so once any tune has been primed, Play keeps replaying the old
  // audio buffer (and a dead cursor) no matter what setTune was given since.
  // Force a re-prime: drop the old buffer/timer and clear the flag ourselves.
  const setTuneFresh = useCallback((visual: TuneObject) => {
    const ctrl = synthRef.current
    if (!ctrl) return
    const internals = ctrl as unknown as { destroy(): void; isLoaded: boolean }
    try {
      internals.destroy()
    } catch {
      // nothing primed yet
    }
    internals.isLoaded = false
    ctrl.setTune(visual, false).catch(() => {})
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('music-notepad.visited', '1')
    } catch {
      // ignore
    }
  }, [])

  // ---- playback cursor ----
  const clearHighlights = useCallback(() => {
    paperRef.current
      ?.querySelectorAll('.abcjs-note-playing')
      .forEach((el) => el.classList.remove('abcjs-note-playing'))
  }, [])

  // ---- synth controller (once) ----
  useEffect(() => {
    if (!audioRef.current) return
    if (!abcjs.synth.supportsAudio()) {
      audioRef.current.textContent = 'Audio is not supported in this browser.'
      return
    }
    // iOS Safari 16.4+: declare the audio as media playback so the physical
    // ring/silent switch does not mute the Web Audio synth.
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
    } catch {
      // older browsers: no audioSession — nothing to do
    }
    const cursorControl: CursorControl = {
      onStart: () => clearHighlights(),
      onEvent: (ev) => {
        clearHighlights()
        ev?.elements?.flat().forEach((el) => el.classList.add('abcjs-note-playing'))
      },
      onFinished: () => clearHighlights(),
    }
    try {
      const controller = new abcjs.synth.SynthController()
      controller.load(audioRef.current, cursorControl, {
        displayPlay: true,
        displayProgress: true,
        displayWarp: true,
        displayLoop: true,
      })
      synthRef.current = controller
      if (visualRef.current) {
        setTuneFresh(visualRef.current)
      }
    } catch {
      audioRef.current.textContent = 'Audio could not be initialized.'
    }
  }, [clearHighlights, setTuneFresh])

  // ---- live rendering (debounced) ----
  useEffect(() => {
    const timer = setTimeout(() => {
      const paper = paperRef.current
      if (!paper) return

      if (abc.trim() === '') {
        paper.innerHTML = ''
        visualRef.current = null
        setBpm(null)
        setError(null)
        return
      }

      try {
        // Test-parse into a detached element so a bad edit never clobbers
        // the last good score.
        const probe = abcjs.renderAbc(document.createElement('div'), abc, {
          add_classes: true,
        })
        const tune = probe[0]
        const warnings = tune?.warnings
        if (!tune) {
          setError('No tune found — start with an X:1 header line.')
          return
        }
        if (warnings && warnings.length > 0) {
          setError(warnings.map(stripHtml).join('\n'))
          return
        }

        const rendered = abcjs.renderAbc(paper, abc, {
          responsive: 'resize',
          add_classes: true,
        })
        visualRef.current = rendered[0]
        setBpm(Math.round(rendered[0].getBpm()))
        setError(null)
        setTuneFresh(rendered[0])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, RENDER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [abc, renderNonce, setTuneFresh])

  // ---- autosave (debounced) ----
  useEffect(() => {
    const timer = setTimeout(() => {
      setDocs((prev) =>
        prev.map((d) => (d.id === currentId && d.abc !== abc ? { ...d, abc, updatedAt: Date.now() } : d)),
      )
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [abc, currentId])

  useEffect(() => {
    saveDocs(docs)
  }, [docs])

  useEffect(() => {
    saveCurrentId(currentId)
  }, [currentId])

  // ---- document operations ----
  const flushCurrent = useCallback(() => {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === currentId && d.abc !== abcRef.current
          ? { ...d, abc: abcRef.current, updatedAt: Date.now() }
          : d,
      ),
    )
  }, [currentId])

  const stopPlayback = useCallback(() => {
    // pause first and in its own try: if restart() ever throws, the old audio
    // must still get silenced
    try {
      synthRef.current?.pause()
    } catch {
      // synth not started yet
    }
    try {
      synthRef.current?.restart()
    } catch {
      // ignore
    }
    clearHighlights()
  }, [clearHighlights])

  const switchDoc = useCallback(
    (id: string) => {
      if (id === currentId) return
      flushCurrent()
      stopPlayback()
      setDocs((prev) => {
        const doc = prev.find((d) => d.id === id)
        if (doc) setAbc(doc.abc)
        return prev
      })
      setCurrentId(id)
      setRenderNonce((n) => n + 1)
    },
    [currentId, flushCurrent, stopPlayback],
  )

  const createDoc = useCallback(() => {
    flushCurrent()
    stopPlayback()
    const doc = newDoc(TEMPLATE_ABC)
    setDocs((prev) => [...prev, doc])
    setAbc(doc.abc)
    setCurrentId(doc.id)
    setRenderNonce((n) => n + 1)
  }, [flushCurrent, stopPlayback])

  const deleteDoc = useCallback(() => {
    if (!currentDoc) return
    if (!window.confirm(`Delete "${currentDoc.title}"? This cannot be undone.`)) return
    stopPlayback()
    setDocs((prev) => {
      let next = prev.filter((d) => d.id !== currentId)
      if (next.length === 0) next = [newDoc(TEMPLATE_ABC)]
      setCurrentId(next[0].id)
      setAbc(next[0].abc)
      return next
    })
    setRenderNonce((n) => n + 1)
  }, [currentDoc, currentId, stopPlayback])

  const renameDoc = useCallback(
    (title: string) => {
      setDocs((prev) =>
        prev.map((d) => (d.id === currentId ? { ...d, title, updatedAt: Date.now() } : d)),
      )
    },
    [currentId],
  )

  // ---- snippet insertion (cheat sheet + mobile key bar) ----
  // The caret is applied in an effect AFTER React commits the new value;
  // setting it earlier races the controlled-textarea update, which resets the
  // caret to the end.
  const pendingCaretRef = useRef<number | null>(null)
  const insertSnippet = useCallback((snippet: string, caretOffset?: number) => {
    const ta = textareaRef.current
    const text = abcRef.current
    const start = ta?.selectionStart ?? text.length
    const end = ta?.selectionEnd ?? start
    pendingCaretRef.current = start + (caretOffset ?? snippet.length)
    setAbc(text.slice(0, start) + snippet + text.slice(end))
  }, [])

  useEffect(() => {
    if (pendingCaretRef.current === null) return
    const caret = pendingCaretRef.current
    pendingCaretRef.current = null
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = caret
    }
  }, [abc])

  // ---- playback ----
  const togglePlay = useCallback(() => {
    if (!visualRef.current || !synthRef.current) return
    try {
      synthRef.current.play()
    } catch {
      // ignore — audio context may still be warming up
    }
  }, [])

  // ---- export ----
  const exportAbc = useCallback(() => {
    downloadBlob(
      `${safeFilename(currentDoc?.title ?? 'untitled')}.abc`,
      new Blob([abcRef.current], { type: 'text/plain;charset=utf-8' }),
    )
    setExportOpen(false)
  }, [currentDoc])

  const exportMidi = useCallback(() => {
    if (!visualRef.current) return
    try {
      const midi = abcjs.synth.getMidiFile(visualRef.current, {
        midiOutputType: 'binary',
      }) as Uint8Array
      downloadBlob(
        `${safeFilename(currentDoc?.title ?? 'untitled')}.mid`,
        new Blob([midi.slice().buffer as ArrayBuffer], { type: 'audio/midi' }),
      )
    } catch (e) {
      setError(`MIDI export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setExportOpen(false)
  }, [currentDoc])

  const printScore = useCallback(() => {
    setExportOpen(false)
    window.print()
  }, [])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'Enter') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 's') {
        e.preventDefault()
        flushCurrent()
        setSavedAt(Date.now())
      } else if (e.key === '/') {
        e.preventDefault()
        setCheatOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [togglePlay, flushCurrent])

  useEffect(() => {
    if (savedAt === null) return
    const t = setTimeout(() => setSavedAt(null), 1500)
    return () => clearTimeout(t)
  }, [savedAt])

  // ---- mobile key bar: pin above the on-screen keyboard ----
  // Android (with interactive-widget=resizes-content) shrinks the layout
  // viewport, so bottom:0 is already right; iOS keeps the layout viewport and
  // only shrinks the visual viewport, so we lift the bar by the difference.
  useEffect(() => {
    if (!editorFocused) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const lift = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      keyBarRef.current?.style.setProperty('bottom', `${lift}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [editorFocused])

  const errorLines = error ? error.split('\n') : []

  return (
    <div className="print-block flex h-screen flex-col bg-stone-100 text-stone-800">
      {/* ---- toolbar ---- */}
      <header className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200 bg-white px-3 py-2">
        <span className="text-lg" aria-hidden>
          🎼
        </span>
        <input
          value={currentDoc?.title ?? ''}
          onChange={(e) => renameDoc(e.target.value)}
          placeholder="Untitled"
          aria-label="Document title"
          className="w-44 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-stone-200 focus:border-amber-400 focus:outline-none"
        />
        <select
          value={currentId}
          onChange={(e) => switchDoc(e.target.value)}
          aria-label="Switch document"
          className="max-w-48 rounded border border-stone-200 bg-white px-2 py-2 text-sm min-[900px]:py-1"
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || 'Untitled'}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={createDoc}
          className="rounded border border-stone-200 px-2 py-2 text-sm hover:bg-stone-50 min-[900px]:py-1"
        >
          New
        </button>
        <button
          type="button"
          onClick={deleteDoc}
          className="rounded border border-stone-200 px-2 py-2 text-sm text-red-700 hover:bg-red-50 min-[900px]:py-1"
        >
          Delete
        </button>

        <div className="mx-1 h-5 w-px bg-stone-200" aria-hidden />

        <button
          type="button"
          onClick={togglePlay}
          title="Play / pause (Ctrl+Enter)"
          className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 min-[900px]:py-1"
        >
          ▶ Play / Pause
        </button>
        {bpm !== null && <span className="text-sm text-stone-500">♩ = {bpm}</span>}
        {savedAt !== null && <span className="text-xs text-stone-400">Saved</span>}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              className="rounded border border-stone-200 px-2 py-2 text-sm hover:bg-stone-50 min-[900px]:py-1"
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-10 mt-1 w-44 rounded border border-stone-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={exportAbc}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50"
                >
                  Download .abc
                </button>
                <button
                  type="button"
                  onClick={exportMidi}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50"
                >
                  Download MIDI
                </button>
                <button
                  type="button"
                  onClick={printScore}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-50"
                >
                  Print / PDF…
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCheatOpen((v) => !v)}
            title="Toggle cheat sheet (Ctrl+/)"
            className={`rounded border px-2 py-2 text-sm min-[900px]:py-1 ${
              cheatOpen
                ? 'border-amber-400 bg-amber-50 text-amber-800'
                : 'border-stone-200 hover:bg-stone-50'
            }`}
          >
            ? Help
          </button>
        </div>
      </header>

      {/* ---- main split ---- */}
      <main className="print-block flex min-h-0 flex-1 flex-col min-[900px]:flex-row">
        {/* editor pane — below the score on phones so the music stays visible
            while the on-screen keyboard is open */}
        <section
          className={`no-print order-2 flex min-h-0 basis-2/5 flex-col border-t border-stone-200 min-[900px]:order-1 min-[900px]:border-t-0 min-[900px]:border-r ${
            editorFocused ? 'max-[899px]:pb-12' : ''
          }`}
        >
          <textarea
            ref={textareaRef}
            value={abc}
            onChange={(e) => setAbc(e.target.value)}
            onFocus={() => setEditorFocused(true)}
            onBlur={() => setEditorFocused(false)}
            spellCheck={false}
            aria-label="ABC notation editor"
            placeholder={'Type ABC notation here…\n\nTry:  C D E F | G2 [ceg]2 | c4 |]\nOpen the cheat sheet with Ctrl+/'}
            className="min-h-0 flex-1 resize-none bg-white p-4 font-mono text-base leading-relaxed focus:outline-none min-[900px]:text-sm"
          />
          {error && (
            <div
              role="alert"
              className="max-h-28 shrink-0 overflow-y-auto border-t border-amber-300 bg-amber-100 px-3 py-1.5 font-mono text-xs text-amber-900"
            >
              {errorLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </section>

        {/* one-tap ABC symbols while typing on a phone */}
        {editorFocused && (
          <div
            ref={keyBarRef}
            className="no-print fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-stone-300 bg-stone-200 px-2 py-1.5 min-[900px]:hidden"
          >
            {[
              { label: '|', insert: '|' },
              { label: '[ ]', insert: '[]', caret: 1 },
              { label: '♯ ^', insert: '^' },
              { label: '♭ _', insert: '_' },
              { label: '♮ =', insert: '=' },
              { label: ',', insert: ',' },
              { label: "'", insert: "'" },
              { label: 'z', insert: 'z' },
              { label: '2', insert: '2' },
              { label: '/2', insert: '/2' },
              { label: '|]', insert: '|]' },
            ].map((k) => (
              <button
                key={k.label}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insertSnippet(k.insert, k.caret)}
                className="min-h-10 min-w-10 shrink-0 rounded bg-white px-2 font-mono text-base text-stone-800 shadow-sm active:bg-amber-100"
              >
                {k.label}
              </button>
            ))}
          </div>
        )}

        {/* score pane */}
        <section className="print-block order-1 flex min-h-0 flex-1 flex-col min-[900px]:order-2">
          <div className="print-block min-h-0 flex-1 overflow-y-auto p-4 min-[900px]:p-6">
            <div className="print-block relative mx-auto max-w-3xl rounded bg-white p-4 shadow-sm min-[900px]:p-6">
              <div ref={paperRef} className="score-paper" />
              {abc.trim() === '' && (
                <p className="py-16 text-center text-sm text-stone-400">
                  Your score will appear here as you type.
                </p>
              )}
            </div>
          </div>
          <div className="no-print shrink-0 px-4 pb-3 min-[900px]:px-6">
            <div ref={audioRef} />
          </div>
        </section>

        {/* cheat sheet */}
        {cheatOpen && (
          <CheatSheet onInsert={insertSnippet} onClose={() => setCheatOpen(false)} />
        )}
      </main>
    </div>
  )
}

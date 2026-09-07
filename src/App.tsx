import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import abcjs from 'abcjs'
import type { CursorControl, SynthObjectController, TuneObject } from 'abcjs'
import CheatSheet from './CheatSheet'
import { analyzeAbc, describeRedInk, type Problem } from './problems'
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  emptyHistory,
  record,
  redo as redoText,
  undo as undoText,
  type EditSource,
  type History,
} from './history'
import { cleanPastedAbc, looksPasted } from './paste'
import ShareDialog, { QrSvg, qrFits } from './ShareDialog'
import { shareLink } from './share'
import SimpleEditor from './SimpleEditor'
import PianoKit from './PianoKit'
import AssignmentBar, { AssignmentNotePrint, AssignmentPrint } from './AssignmentBar'
import { buildSimple, parseSimple, type SimpleFields } from './simple'
import { TEMPLATE_ABC } from './examples'
import {
  EMPTY_ASSIGNMENT,
  loadCurrentId,
  loadDocs,
  newDoc,
  saveCurrentId,
  saveDocs,
  type Assignment,
  type Doc,
} from './storage'

const RENDER_DEBOUNCE_MS = 200
const SAVE_DEBOUNCE_MS = 500

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
  const [problems, setProblems] = useState<Problem[]>([])
  const [cleanupNote, setCleanupNote] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  // Hearing one hand at a time while writing, the same way the practice page does
  const [editorHands, setEditorHands] = useState<'both' | 'right' | 'left'>('both')
  // Undo history for the document text. Held in a ref because it is written on
  // every keystroke; the tick only exists to re-render the two toolbar buttons.
  const historyRef = useRef<History>(emptyHistory())
  const [historyTick, setHistoryTick] = useState(0)
  // A QR printed in the corner of the handout, so paper is playable too
  const [printQr, setPrintQr] = useState<string | null>(null)
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
  // Simple mode: friendly two-hand view; Advanced: the raw text editor
  const [editorMode, setEditorMode] = useState<'simple' | 'advanced'>(() => {
    try {
      return localStorage.getItem('music-notepad.editorMode') === 'advanced'
        ? 'advanced'
        : 'simple'
    } catch {
      return 'simple'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('music-notepad.editorMode', editorMode)
    } catch {
      // ignore
    }
  }, [editorMode])

  // PWA: service-worker registration + "update ready" prompt
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  // iPhone/iPad Safari has no automatic install prompt — show a one-time hint
  const [showIosHint, setShowIosHint] = useState(() => {
    try {
      if (localStorage.getItem('music-notepad.iosHintDismissed')) return false
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const standalone =
        (navigator as unknown as { standalone?: boolean }).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches
      return isIos && !standalone
    } catch {
      return false
    }
  })
  const dismissIosHint = useCallback(() => {
    setShowIosHint(false)
    try {
      localStorage.setItem('music-notepad.iosHintDismissed', '1')
    } catch {
      // ignore
    }
  }, [])
  // Bumped on document switch so the render effect re-runs even when the new
  // doc's text is identical to the old one (otherwise the synth never re-arms).
  const [renderNonce, setRenderNonce] = useState(0)

  const paperRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLDivElement>(null)
  const keyBarRef = useRef<HTMLDivElement>(null)
  const rhRef = useRef<HTMLTextAreaElement>(null)
  const lhRef = useRef<HTMLTextAreaElement>(null)
  const activeHandRef = useRef<'rh' | 'lh'>('rh')
  // Until a hand box has been focused, its reported caret position (0) is
  // meaningless — inserts then go to the END of the melody, not before it.
  const handTouchedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const synthRef = useRef<SynthObjectController | null>(null)
  const visualRef = useRef<TuneObject | null>(null)
  const abcRef = useRef(abc)
  abcRef.current = abc

  const currentDoc = docs.find((d) => d.id === currentId)

  // Simple-mode view over the current ABC (cheap; abc is small)
  const simple = parseSimple(abc)
  // Latch: once a doc is shown as text, stay there even if an edit makes it
  // canonical again — otherwise the editor would flip out from under a typing
  // user. Cleared on doc switches and by clicking the Simple button.
  const [advancedLatch, setAdvancedLatch] = useState(false)
  const effectiveMode: 'simple' | 'advanced' =
    editorMode === 'simple' && simple.compatible && !advancedLatch ? 'simple' : 'advanced'
  useEffect(() => {
    if (editorMode === 'simple' && !simple.compatible) setAdvancedLatch(true)
  }, [editorMode, simple.compatible])

  /**
   * Every change to the document text goes through here, so there is exactly
   * one place that knows how to take it back. `kind` decides whether it joins
   * the keystroke that came before it or becomes an undo step of its own.
   */
  const commitAbc = useCallback((next: string, source: EditSource = 'action') => {
    const previous = abcRef.current
    if (next === previous) return
    record(historyRef.current, previous, next, source, Date.now())
    // The ref is normally refreshed during render, which has not happened yet:
    // two buttons pressed in the same tick would otherwise both read the text
    // from before either of them, and the first change would vanish.
    abcRef.current = next
    setAbc(next)
    setHistoryTick((n) => n + 1)
  }, [])

  /**
   * Where to put the caret after stepping through history: at the first
   * character where the two versions differ, which is where the change being
   * taken back actually was. Assigning a controlled textarea's value otherwise
   * drops the caret to the very end, and the next thing typed lands at the
   * bottom of the score.
   */
  const caretForJump = useCallback(
    (from: string, to: string): { target: 'main' | 'rh' | 'lh'; pos: number } | null => {
      // Leave focus alone unless they were already working in the music. On a
      // phone, focusing a box nobody asked for throws the keyboard open.
      const el = document.activeElement
      const inMusic = el === textareaRef.current || el === rhRef.current || el === lhRef.current
      if (!inMusic) return null

      const shared = (a: string, b: string) => {
        const n = Math.min(a.length, b.length)
        let i = 0
        while (i < n && a[i] === b[i]) i++
        return i
      }
      if (modeRef.current === 'advanced') return { target: 'main', pos: shared(from, to) }
      const before = parseSimple(from)
      const after = parseSimple(to)
      if (!before.compatible || !after.compatible) return null
      for (const hand of ['rh', 'lh'] as const) {
        if (before.fields[hand] !== after.fields[hand]) {
          return { target: hand, pos: shared(before.fields[hand], after.fields[hand]) }
        }
      }
      // only a header moved: nothing in either hand to point at
      return null
    },
    [],
  )

  const jumpTo = useCallback(
    (text: string) => {
      pendingCaretRef.current = caretForJump(abcRef.current, text)
      abcRef.current = text
      setAbc(text)
      // the clean-up receipt describes an edit no longer in the document
      setCleanupNote(null)
      setHistoryTick((n) => n + 1)
    },
    [caretForJump],
  )

  const undoEdit = useCallback(() => {
    const previous = undoText(historyRef.current, abcRef.current)
    if (previous === null) return
    jumpTo(previous)
  }, [jumpTo])

  const redoEdit = useCallback(() => {
    const next = redoText(historyRef.current, abcRef.current)
    if (next === null) return
    jumpTo(next)
  }, [jumpTo])

  // read during render so the toolbar buttons enable and disable with the stack
  void historyTick
  const canUndo = historyCanUndo(historyRef.current, abc)
  const canRedo = historyCanRedo(historyRef.current, abc)

  const changeSimple = useCallback(
    (patch: Partial<SimpleFields>, source: EditSource = 'action') => {
      const parsed = parseSimple(abcRef.current)
      if (!parsed.compatible) return
      commitAbc(buildSimple({ ...parsed.fields, ...patch }), source)
    },
    [commitAbc],
  )

  // abcjs 6.7: SynthController.setTune(visual, false) never clears the internal
  // isLoaded flag, so once any tune has been primed, Play keeps replaying the old
  // audio buffer (and a dead cursor) no matter what setTune was given since.
  // Force a re-prime: drop the old buffer/timer and clear the flag ourselves.
  const setTuneFresh = useCallback(
    (visual: TuneObject) => {
      const ctrl = synthRef.current
      if (!ctrl) return
      const internals = ctrl as unknown as {
        destroy(): void
        isLoaded: boolean
        isLoading: boolean
      }
      try {
        internals.destroy()
      } catch {
        // nothing primed yet
      }
      internals.isLoaded = false
      internals.isLoading = false
      // voicesOff silences a staff without removing its notes, so the score
      // still shows both hands and the cursor still runs through everything
      const voicesOff = editorHands === 'right' ? [1] : editorHands === 'left' ? [0] : undefined
      ctrl.setTune(visual, false, voicesOff ? { voicesOff } : {}).catch(() => {})
    },
    [editorHands],
  )

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
    return () => {
      try {
        ;(synthRef.current as unknown as { destroy?: () => void } | null)?.destroy?.()
      } catch {
        // nothing primed
      }
      synthRef.current = null
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
        setProblems([])
        return
      }

      try {
        // Everything wrong with the document, in plain English. Runs its own
        // parse, so the tune handed to the player is never touched by it.
        const found = analyzeAbc(abc)

        // Engrave into a detached element first, so a bad edit never clobbers
        // the last good score. The probe also carries the red text the
        // engraver paints for things it cannot draw, which never reaches
        // tune.warnings — read it here, or a blocking problem would return
        // before it was ever looked at.
        const probeEl = document.createElement('div')
        const probe = abcjs.renderAbc(probeEl, abc, { add_classes: true })
        const tune = probe[0]
        if (!tune) {
          setProblems([
            {
              severity: 'error',
              blocking: true,
              message: 'No music found in this document.',
              fix: 'Every tune starts with an X:1 line, and the notes go on a line beginning [V:1].',
            },
          ])
          return
        }
        const redProblem = describeRedInk(
          [...probeEl.querySelectorAll('.abcjs-debug-msg')].map((t) => t.textContent ?? ''),
        )
        const all = redProblem ? [redProblem, ...found] : found

        // Blocking problems mean the score would not match the text, so the
        // last good score stays on screen. Advisory ones (bar lengths, hands
        // out of sync) came from a tune that parsed fine, so it still shows.
        // With no good score to fall back on, showing an approximate one beats
        // showing a permanently blank page.
        if (all.some((p) => p.blocking) && visualRef.current) {
          setProblems(all)
          return
        }

        // wrap re-breaks the music into systems that fit the paper, so a piece
        // typed as one long text line doesn't engrave as one microscopic row
        const rendered = abcjs.renderAbc(paper, abc, {
          responsive: 'resize',
          add_classes: true,
          staffwidth: Math.max(320, paper.clientWidth - 20),
          wrap: { preferredMeasuresPerLine: 4, minSpacing: 1.8, maxSpacing: 2.7 },
        })
        visualRef.current = rendered[0]
        setBpm(Math.round(rendered[0].getBpm()))
        setProblems(all)
        setTuneFresh(rendered[0])
      } catch (e) {
        setProblems([
          {
            severity: 'error',
            blocking: true,
            message: 'The music could not be drawn.',
            fix: e instanceof Error ? e.message : String(e),
          },
        ])
      }
    }, RENDER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [abc, renderNonce, editorHands, setTuneFresh])

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

  // The editor can unmount mid-edit (following a share link, for instance),
  // and the debounced autosave would never fire. Write the pending text out.
  const pendingRef = useRef({ docs, currentId, abc })
  pendingRef.current = { docs, currentId, abc }
  useEffect(() => {
    return () => {
      const { docs: d, currentId: id, abc: text } = pendingRef.current
      const target = d.find((x) => x.id === id)
      if (target && target.abc !== text) {
        saveDocs(d.map((x) => (x.id === id ? { ...x, abc: text, updatedAt: Date.now() } : x)))
      }
    }
  }, [])

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

  const resetPerDocEditingState = useCallback(() => {
    pendingCaretRef.current = null
    handTouchedRef.current = false
    setAdvancedLatch(false)
    // problems and the cleanup note belong to the document being left
    setProblems([])
    setCleanupNote(null)
    // so does the undo history: undoing into another document's text would
    // silently overwrite this one
    historyRef.current = emptyHistory()
    setHistoryTick((n) => n + 1)
  }, [])

  const switchDoc = useCallback(
    (id: string) => {
      if (id === currentId) return
      flushCurrent()
      stopPlayback()
      resetPerDocEditingState()
      const doc = docs.find((d) => d.id === id)
      if (doc) setAbc(doc.abc)
      setCurrentId(id)
      setRenderNonce((n) => n + 1)
    },
    [currentId, docs, flushCurrent, stopPlayback, resetPerDocEditingState],
  )

  const createDoc = useCallback(() => {
    flushCurrent()
    stopPlayback()
    resetPerDocEditingState()
    const doc = newDoc(TEMPLATE_ABC)
    setDocs((prev) => [...prev, doc])
    setAbc(doc.abc)
    setCurrentId(doc.id)
    setRenderNonce((n) => n + 1)
  }, [flushCurrent, stopPlayback, resetPerDocEditingState])

  const deleteDoc = useCallback(() => {
    if (!currentDoc) return
    if (!window.confirm(`Delete "${currentDoc.title}"? This cannot be undone.`)) return
    stopPlayback()
    resetPerDocEditingState()
    // computed outside the setDocs updater: updaters must stay pure (React
    // double-invokes them in StrictMode, and newDoc creates fresh random ids)
    const remaining = docs.filter((d) => d.id !== currentId)
    const next = remaining.length > 0 ? remaining : [newDoc(TEMPLATE_ABC)]
    setDocs(next)
    setCurrentId(next[0].id)
    setAbc(next[0].abc)
    setRenderNonce((n) => n + 1)
  }, [currentDoc, currentId, docs, stopPlayback, resetPerDocEditingState])

  const renameDoc = useCallback(
    (title: string) => {
      setDocs((prev) =>
        prev.map((d) => (d.id === currentId ? { ...d, title, updatedAt: Date.now() } : d)),
      )
    },
    [currentId],
  )

  const setAssignment = useCallback(
    (patch: Partial<Assignment>) => {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === currentId
            ? {
                ...d,
                assignment: { ...EMPTY_ASSIGNMENT, ...d.assignment, ...patch },
                updatedAt: Date.now(),
              }
            : d,
        ),
      )
    },
    [currentId],
  )

  // ---- snippet insertion (cheat sheet + mobile key bar) ----
  // The caret is applied in an effect AFTER React commits the new value;
  // setting it earlier races the controlled-textarea update, which resets the
  // caret to the end.
  const pendingCaretRef = useRef<{ target: 'main' | 'rh' | 'lh'; pos: number } | null>(null)
  const modeRef = useRef(effectiveMode)
  modeRef.current = effectiveMode

  // Settings lines (X: T: K: V: … and % directives/comments) must never
  // receive note snippets — a stray click there silently corrupts the doc.
  const isSettingsLine = (line: string) => /^\s*(?:[A-Za-z]:|%)/.test(line)

  // End of the first music line, just before a trailing |] if there is one.
  const musicInsertPos = (text: string): number => {
    let offset = 0
    for (const line of text.split('\n')) {
      if (/^\s*\[V:/.test(line)) {
        const tail = line.match(/\s*\|\]\s*$/)
        return offset + (tail ? line.length - tail[0].length : line.length)
      }
      offset += line.length + 1
    }
    return text.length
  }

  const insertSnippet = useCallback(
    (snippet: string, opts?: { caretOffset?: number; kind?: 'music' | 'header' }) => {
      if (modeRef.current === 'simple') {
        // headers are toolbar controls in Simple mode — nothing to insert
        if (opts?.kind === 'header') return
        const parsed = parseSimple(abcRef.current)
        if (!parsed.compatible) return
        const hand = activeHandRef.current
        const ta = (hand === 'rh' ? rhRef : lhRef).current
        const handText = parsed.fields[hand]
        const start = handTouchedRef.current
          ? (ta?.selectionStart ?? handText.length)
          : handText.length
        const end = handTouchedRef.current ? (ta?.selectionEnd ?? start) : handText.length
        pendingCaretRef.current = { target: hand, pos: start + (opts?.caretOffset ?? snippet.length) }
        commitAbc(
          buildSimple({
            ...parsed.fields,
            [hand]: handText.slice(0, start) + snippet + handText.slice(end),
          }),
        )
        return
      }

      const ta = textareaRef.current
      const text = abcRef.current
      let start = ta?.selectionStart ?? text.length
      let end = ta?.selectionEnd ?? start
      let insertText = snippet
      let caretInInsert = opts?.caretOffset ?? snippet.length

      const lineStart = text.lastIndexOf('\n', start - 1) + 1
      const lineEndRaw = text.indexOf('\n', start)
      const currentLine = text.slice(lineStart, lineEndRaw === -1 ? text.length : lineEndRaw)

      if (opts?.kind === 'header') {
        // a header belongs on its own line: insert above the current line
        start = end = lineStart
        insertText = snippet + '\n'
        caretInInsert = snippet.length
      } else if (isSettingsLine(currentLine)) {
        // note snippet clicked while the caret sits in a settings line:
        // redirect it to the end of the melody line instead
        start = end = musicInsertPos(text)
        insertText = ' ' + snippet
        caretInInsert = 1 + (opts?.caretOffset ?? snippet.length)
      }

      pendingCaretRef.current = { target: 'main', pos: start + caretInInsert }
      commitAbc(text.slice(0, start) + insertText + text.slice(end))
    },
    [],
  )

  useEffect(() => {
    if (pendingCaretRef.current === null) return
    const { target, pos } = pendingCaretRef.current
    pendingCaretRef.current = null
    const ta =
      target === 'main' ? textareaRef.current : target === 'rh' ? rhRef.current : lhRef.current
    if (ta) {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = pos
      // A kit button appends several bars to a box that may already be
      // scrolled away, and an insertion nobody can see is how a document
      // quietly turns into a mess. Anywhere else the caret was already in
      // view, because the person was typing there.
      if (pos >= ta.value.length) ta.scrollTop = ta.scrollHeight
    }
  }, [abc])

  /** Put text into one specific hand, wherever the caret is in it. */
  const insertIntoHand = useCallback((hand: 'rh' | 'lh', text: string) => {
    const parsed = parseSimple(abcRef.current)
    if (!parsed.compatible) return
    const handText = parsed.fields[hand]
    const ta = (hand === 'rh' ? rhRef : lhRef).current
    // Only trust the caret when this hand is the one being typed in; a
    // never-focused box reports position 0, which would prepend.
    const useCaret = handTouchedRef.current && activeHandRef.current === hand
    const start = useCaret ? (ta?.selectionStart ?? handText.length) : handText.length
    const end = useCaret ? (ta?.selectionEnd ?? start) : handText.length
    // keep the music readable: one space between what is there and what arrives
    const before = handText.slice(0, start)
    const needsSpace = before !== '' && !/\s$/.test(before)
    const insert = (needsSpace ? ' ' : '') + text
    activeHandRef.current = hand
    pendingCaretRef.current = { target: hand, pos: start + insert.length }
    commitAbc(
      buildSimple({
        ...parsed.fields,
        [hand]: before + insert + handText.slice(end),
      }),
    )
  }, [commitAbc])

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
      setProblems([
        {
          severity: 'error',
          message: 'The MIDI file could not be created.',
          fix: e instanceof Error ? e.message : String(e),
        },
      ])
    }
    setExportOpen(false)
  }, [currentDoc])

  const sendToStudent = useCallback(async () => {
    setExportOpen(false)
    try {
      setShareUrl(await shareLink(abcRef.current, currentDoc?.title ?? 'Exercise'))
    } catch {
      setProblems([
        {
          severity: 'error',
          message: 'The share link could not be made.',
          fix: 'Try again, or use Download .abc to send the file instead.',
        },
      ])
    }
  }, [currentDoc])

  const printScore = useCallback(async () => {
    setExportOpen(false)
    try {
      const link = await shareLink(abcRef.current, currentDoc?.title ?? 'Exercise')
      // A piece too long for a QR still prints, just without one
      if (qrFits(link)) setPrintQr(link)
      else window.print()
    } catch {
      setPrintQr(null)
      window.print()
    }
  }, [currentDoc])

  // Printing waits for the QR to be laid out, then clears it again so it never
  // shows on screen.
  useEffect(() => {
    if (!printQr) return
    const id = requestAnimationFrame(() => {
      window.print()
      setPrintQr(null)
    })
    return () => cancelAnimationFrame(id)
  }, [printQr])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const undoKey = e.key === 'z' || e.key === 'Z'
      if (undoKey || e.key === 'y' || e.key === 'Y') {
        // The music boxes are rewritten from state by every button, which
        // destroys the browser's own undo inside them — those we take over.
        // Every other field (the title, a student's name, a practice note) is
        // only ever edited by hand, so its native undo still works and stealing
        // Ctrl+Z there would change the music instead of the word being typed.
        // A dialog is a decision in progress. The share dialog in particular
        // holds a link and a QR frozen from the text as it was when it opened;
        // changing the document underneath them would hand a student music the
        // teacher no longer has.
        if (document.querySelector('[aria-modal="true"]')) return
        const el = document.activeElement
        const isMusicBox =
          el === textareaRef.current || el === rhRef.current || el === lhRef.current
        const isOwnField =
          el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        if (isOwnField && !isMusicBox) return
        e.preventDefault()
        if (undoKey && !e.shiftKey) undoEdit()
        else redoEdit()
      } else if (e.key === 'Enter') {
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
  }, [togglePlay, flushCurrent, undoEdit, redoEdit])

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

  // A pasted chat answer: offer to clean it up rather than drowning the
  // person in warnings about words being read as notes.
  const pasteDetected = looksPasted(abc)

  const cleanUpPaste = useCallback(() => {
    const { abc: cleaned, changes } = cleanPastedAbc(abcRef.current)
    commitAbc(cleaned)
    setCleanupNote(`Cleaned up: ${changes.join('; ')}.`)
  }, [])

  useEffect(() => {
    if (cleanupNote === null) return
    const t = setTimeout(() => setCleanupNote(null), 8000)
    return () => clearTimeout(t)
  }, [cleanupNote])

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

        {/* Buttons, not just Ctrl+Z: on a phone there is no keyboard to press */}
        <div className="flex items-center gap-1" role="group" aria-label="Undo and redo">
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={undoEdit}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="rounded px-2 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:text-stone-300 disabled:hover:bg-transparent min-[900px]:py-1"
          >
            ↶
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={redoEdit}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            className="rounded px-2 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:text-stone-300 disabled:hover:bg-transparent min-[900px]:py-1"
          >
            ↷
          </button>
        </div>

        <div className="mx-1 h-5 w-px bg-stone-200" aria-hidden />

        <button
          type="button"
          onClick={togglePlay}
          title="Play / pause (Ctrl+Enter)"
          className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 min-[900px]:py-1"
        >
          ▶ Play / Pause
        </button>
        <div className="flex items-center gap-1" role="group" aria-label="Which hands to play">
          {(['both', 'right', 'left'] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setEditorHands(h)}
              aria-pressed={editorHands === h}
              title={
                h === 'both'
                  ? 'Play both hands'
                  : `Play only the ${h} hand — the other one stays silent`
              }
              className={`rounded px-2 py-2 text-xs font-medium min-[900px]:py-1 ${
                editorHands === h
                  ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                  : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              {h === 'both' ? 'Both' : h === 'right' ? 'R' : 'L'}
            </button>
          ))}
        </div>
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
                  onClick={sendToStudent}
                  className="block w-full px-3 py-1.5 text-left text-sm font-medium hover:bg-stone-50"
                >
                  Send to a student…
                </button>
                <div className="my-1 border-t border-stone-200" />
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
          <div className="flex items-center gap-1 border-b border-stone-200 bg-stone-50 px-2 py-1.5">
            <button
              type="button"
              onClick={() => {
                setEditorMode('simple')
                setAdvancedLatch(false)
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium min-[900px]:py-1 ${
                effectiveMode === 'simple'
                  ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                  : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setEditorMode('advanced')}
              className={`rounded px-3 py-1.5 text-xs font-medium min-[900px]:py-1 ${
                effectiveMode === 'advanced'
                  ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                  : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              Advanced
            </button>
            {editorMode === 'simple' && effectiveMode === 'advanced' && (
              <span className="ml-2 text-xs text-stone-400">
                {simple.compatible
                  ? 'Shown as text — click Simple to switch back'
                  : 'This document uses advanced features — shown as text'}
              </span>
            )}
          </div>
          {effectiveMode === 'simple' ? (
            <>
              <PianoKit
                musicKey={simple.fields.key}
                meter={simple.fields.meter}
                unit={simple.fields.unit}
                onInsert={(text: string) => insertSnippet(text)}
                onInsertHand={insertIntoHand}
              />
              <SimpleEditor
              fields={simple.fields}
              onChange={changeSimple}
              rhRef={rhRef}
              lhRef={lhRef}
              onHandFocus={(hand) => {
                activeHandRef.current = hand
                handTouchedRef.current = true
                setEditorFocused(true)
              }}
                onHandBlur={() => setEditorFocused(false)}
              />
            </>
          ) : (
            <textarea
              ref={textareaRef}
              value={abc}
              onChange={(e) => commitAbc(e.target.value, 'type:main')}
              onFocus={() => setEditorFocused(true)}
              onBlur={() => setEditorFocused(false)}
              spellCheck={false}
              aria-label="ABC notation editor"
              placeholder={'Type ABC notation here…\n\nTry:  C D E F | G2 [ceg]2 | c4 |]\nOpen the cheat sheet with Ctrl+/'}
              className="min-h-0 flex-1 resize-none bg-white p-4 font-mono text-base leading-relaxed focus:outline-none min-[900px]:text-sm"
            />
          )}
          {(problems.length > 0 || pasteDetected || cleanupNote) && (
            <div
              role="region"
              aria-label="Problems with this music"
              tabIndex={0}
              className="max-h-44 shrink-0 overflow-y-auto border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs text-stone-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-500"
            >
              {pasteDetected && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-100 px-2 py-1.5">
                  <span className="min-w-40 flex-1">
                    This looks like it was pasted from a chat, so the words around the music are
                    being read as notes.
                  </span>
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={cleanUpPaste}
                    className="rounded bg-amber-600 px-2.5 py-1.5 font-medium text-white hover:bg-amber-700"
                  >
                    Clean it up
                  </button>
                </div>
              )}
              {cleanupNote && (
                <div className="mb-2 rounded border border-green-300 bg-green-50 px-2 py-1.5 text-green-900">
                  {cleanupNote}
                </div>
              )}
              <ul className="space-y-1.5">
                {problems.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      aria-hidden
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        p.severity === 'error'
                          ? 'bg-red-500'
                          : p.severity === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-stone-400'
                      }`}
                    />
                    <span>
                      <span className="font-medium">{p.message}</span>
                      {p.fix && <span className="text-stone-600"> {p.fix}</span>}
                      {p.line !== undefined && (
                        <span className="text-stone-500"> (line {p.line})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AssignmentBar
            assignment={{ ...EMPTY_ASSIGNMENT, ...currentDoc?.assignment }}
            onChange={setAssignment}
          />
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
                onClick={() => insertSnippet(k.insert, { caretOffset: k.caret })}
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
            <div className="print-block relative mx-auto max-w-5xl rounded bg-white p-4 shadow-sm min-[900px]:p-6">
              <AssignmentPrint assignment={{ ...EMPTY_ASSIGNMENT, ...currentDoc?.assignment }} />
              <div ref={paperRef} className="score-paper" />
              <AssignmentNotePrint assignment={{ ...EMPTY_ASSIGNMENT, ...currentDoc?.assignment }} />
              {printQr && (
                <div className="print-only mt-6 text-center">
                  <QrSvg text={printQr} size={104} />
                  <div className="mt-1 text-[9px] text-stone-500">Scan to hear it</div>
                </div>
              )}
              {(abc.trim() === '' ||
                (effectiveMode === 'simple' &&
                  simple.fields.rh.trim() === '' &&
                  simple.fields.lh.trim() === '')) && (
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
          <CheatSheet
            onInsert={insertSnippet}
            onClose={() => setCheatOpen(false)}
            simpleMode={effectiveMode === 'simple'}
          />
        )}
      </main>

      {/* PWA: a new version has been downloaded */}
      {needRefresh && (
        <div className="no-print fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg bg-stone-800 px-4 py-3 text-sm text-white shadow-lg">
          <span>Update ready</span>
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="rounded bg-amber-500 px-3 py-1.5 font-medium text-stone-900 hover:bg-amber-400"
          >
            Refresh
          </button>
        </div>
      )}

      {shareUrl && <ShareDialog link={shareUrl} onClose={() => setShareUrl(null)} />}

      {/* iOS install hint */}
      {showIosHint && (
        <div className="no-print fixed inset-x-3 bottom-3 z-50 flex items-center gap-2 rounded-lg bg-stone-800 px-3 py-2.5 text-xs text-white shadow-lg min-[900px]:hidden">
          <span className="flex-1">
            Install this app: tap <span className="font-semibold">Share</span> then{' '}
            <span className="font-semibold">Add to Home Screen</span>
          </span>
          <button
            type="button"
            onClick={dismissIosHint}
            aria-label="Dismiss install hint"
            className="rounded px-2 py-1.5 text-stone-300 hover:bg-stone-700"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// What a student sees when they open a shared link: the score, big, with a
// play button, a speed slider, and the ability to hear one hand at a time.
// Read-only on purpose — nothing here can damage the teacher's exercise.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import abcjs from 'abcjs'
import type { CursorControl, SynthObjectController } from 'abcjs'
import { readableNoteName, withNoteNames } from './share'

type Hands = 'both' | 'right' | 'left'

interface Props {
  title: string
  abc: string
  onSaveCopy: () => void
  onOpenEditor: () => void
  saved: boolean
}

const WARP_DEBOUNCE_MS = 250

export default function PracticeView({ title, abc, onSaveCopy, onOpenEditor, saved }: Props) {
  const paperRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLDivElement>(null)
  const synthRef = useRef<SynthObjectController | null>(null)
  const appliedWarpRef = useRef(100)

  const [hands, setHands] = useState<Hands>('both')
  const [speed, setSpeed] = useState(100)
  const [showNames, setShowNames] = useState(false)
  const [failed, setFailed] = useState(false)

  // The practice page is often the first thing a student opens, and it should
  // keep working on the bus. The editor registers this too, and Root
  // guarantees only one of them is ever mounted.
  useRegisterSW()

  const clearHighlights = useCallback(() => {
    paperRef.current
      ?.querySelectorAll('.abcjs-note-playing')
      .forEach((el) => el.classList.remove('abcjs-note-playing'))
  }, [])

  // ---- one-time synth ----
  useEffect(() => {
    if (!audioRef.current) return
    if (!abcjs.synth.supportsAudio()) {
      audioRef.current.textContent = 'This browser cannot play audio.'
      return
    }
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
    } catch {
      // older browsers have no audioSession
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
        displayLoop: true,
      })
      // Speed comes from our own slider, so abcjs was never asked for its
      // tempo box (displayWarp). Its internal setWarp still tries to write to
      // that missing element, and the throw lands mid-promise — which silently
      // skipped the "resume playing" step, stopping the music whenever a
      // student moved the slider. Nothing here needs that display update.
      const control = (controller as unknown as { control?: { setWarp?: unknown } }).control
      if (control) control.setWarp = () => {}
      synthRef.current = controller
    } catch {
      if (audioRef.current) audioRef.current.textContent = 'Audio could not be started.'
    }
    return () => {
      try {
        ;(synthRef.current as unknown as { destroy?: () => void } | null)?.destroy?.()
      } catch {
        // nothing primed
      }
      synthRef.current = null
    }
  }, [clearHighlights])

  // ---- render + re-arm the player whenever the view changes ----
  useEffect(() => {
    const paper = paperRef.current
    if (!paper) return
    try {
      // Note names are drawn by labelling each note in the music itself, at the
      // exact character positions the parser reports. The accidental comes from
      // the pitch the synth will play, so a piece in D major says F#, not F.
      let source = abc
      if (showNames) {
        const probe = abcjs.parseOnly(abc)[0]
        const sounding = new Map<number, number>()
        try {
          const audio = (
            probe as unknown as {
              setUpAudio?: (o: object) => { tracks?: Array<Array<Record<string, unknown>>> }
            }
          ).setUpAudio?.({})
          for (const track of audio?.tracks ?? []) {
            for (const ev of track) {
              if (ev.cmd === 'note' && typeof ev.startChar === 'number' && !sounding.has(ev.startChar)) {
                sounding.set(ev.startChar, ev.pitch as number)
              }
            }
          }
        } catch {
          // no sounding pitches: labels fall back to the written spelling
        }
        const labels: Array<{ startChar: number; label: string }> = []
        for (const line of (probe?.lines ?? []) as Array<{
          staff?: Array<{ voices: unknown[][] }>
        }>) {
          for (const staff of line.staff ?? []) {
            // every voice, so the left hand is labelled too
            for (const voice of staff.voices ?? []) {
              for (const el of voice as Array<{
                el_type?: string
                startChar?: number
                pitches?: Array<{ name?: string; endTie?: boolean }>
              }>) {
                if (el.el_type !== 'note' || !el.pitches?.length) continue
                // the tail of a tie is not a new key to press
                if (el.pitches[0].endTie) continue
                const label = readableNoteName(
                  el.pitches[0].name ?? '',
                  sounding.get(el.startChar ?? -1),
                )
                if (label && typeof el.startChar === 'number') {
                  labels.push({ startChar: el.startChar, label })
                }
              }
            }
          }
        }
        source = withNoteNames(abc, labels)
      }

      const rendered = abcjs.renderAbc(paper, source, {
        responsive: 'resize',
        add_classes: true,
        staffwidth: Math.max(320, paper.clientWidth - 20),
        wrap: { preferredMeasuresPerLine: 4, minSpacing: 1.8, maxSpacing: 2.7 },
      })
      if (!rendered[0]) {
        setFailed(true)
        return
      }
      setFailed(false)

      const ctrl = synthRef.current
      if (ctrl) {
        // abcjs keeps internal "loaded"/"loading" flags that setTune never
        // clears, so the old audio would keep playing. Force a re-prime.
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
        appliedWarpRef.current = 100 // a fresh prime starts at normal speed
        const voicesOff = hands === 'right' ? [1] : hands === 'left' ? [0] : undefined
        ctrl.setTune(rendered[0], false, voicesOff ? { voicesOff } : {}).catch(() => {})
      }
    } catch {
      // a broken shared document must never blank the page
      setFailed(true)
    }
  }, [abc, hands, showNames])

  // Committing the speed re-primes the audio, so it waits for the slider to
  // settle instead of doing it on every pixel of a drag.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (speed === appliedWarpRef.current) return
      const ctrl = synthRef.current
      if (!ctrl) return
      appliedWarpRef.current = speed
      try {
        ctrl.setWarp(speed)?.catch?.(() => {})
      } catch {
        // the slider must never take the page down
      }
    }, WARP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [speed])

  const handButton = (value: Hands, label: string) => (
    <button
      type="button"
      onClick={() => setHands(value)}
      aria-pressed={hands === value}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        hands === value
          ? 'bg-amber-600 text-white shadow-sm'
          : 'bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="print-block flex h-screen flex-col bg-stone-100 text-stone-800">
      <header className="no-print flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <span className="text-lg" aria-hidden>
          🎼
        </span>
        <h1 className="min-w-48 flex-1 truncate text-base font-semibold">{title}</h1>
        <button
          type="button"
          onClick={onSaveCopy}
          disabled={saved}
          className="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-60 min-[900px]:py-1.5"
        >
          {saved ? 'Saved to your notepad' : 'Save to my notepad'}
        </button>
        <button
          type="button"
          onClick={onOpenEditor}
          className="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 min-[900px]:py-1.5"
        >
          Open the editor
        </button>
      </header>

      <main className="print-block flex min-h-0 flex-1 flex-col">
        <div className="print-block min-h-0 flex-1 overflow-y-auto p-4 min-[900px]:p-8">
          <div className="print-block mx-auto max-w-5xl rounded bg-white p-4 shadow-sm min-[900px]:p-8">
            {failed ? (
              <p className="py-16 text-center text-sm text-stone-500">
                This link does not contain music that can be shown. Ask whoever sent it for a new
                link.
              </p>
            ) : (
              <div ref={paperRef} className="score-paper" />
            )}
          </div>
        </div>

        <div className="no-print border-t border-stone-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-5xl flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium tracking-wide text-stone-500 uppercase">
                Play
              </span>
              {handButton('both', 'Both hands')}
              {handButton('right', 'Right hand')}
              {handButton('left', 'Left hand')}
              <label className="ml-auto flex items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={showNames}
                  onChange={(e) => setShowNames(e.target.checked)}
                  className="h-4 w-4 accent-amber-600"
                />
                Note names
              </label>
            </div>

            <label className="flex items-center gap-3 text-sm text-stone-600">
              <span className="w-14 shrink-0">Speed</span>
              <input
                type="range"
                min={30}
                max={150}
                step={5}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="h-2 flex-1 accent-amber-600"
              />
              <span className="w-12 shrink-0 text-right font-medium tabular-nums">{speed}%</span>
            </label>

            <div ref={audioRef} />
          </div>
        </div>
      </main>
    </div>
  )
}

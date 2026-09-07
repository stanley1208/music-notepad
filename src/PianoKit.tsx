// The kit panel in Simple mode: the things a piano teacher reaches for when
// writing a week's exercise, as buttons rather than syntax to remember.

import { useState } from 'react'
import {
  FINGERS,
  HAND_POSITIONS,
  fiveFingerExercise,
  leftHandPatterns,
  rhythmSnippets,
  type Snippet,
} from './kit'

type Tab = 'position' | 'left' | 'rhythm' | 'fingering'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'position', label: 'Hand position' },
  { id: 'left', label: 'Left-hand patterns' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'fingering', label: 'Fingering' },
]

interface Props {
  musicKey: string
  meter: string
  unit: string
  /** insert into whichever hand box was last used */
  onInsert: (text: string) => void
  /** insert specifically into one hand, for the position buttons */
  onInsertHand: (hand: 'rh' | 'lh', text: string) => void
}

function SnippetButton({ snippet, onClick }: { snippet: Snippet; onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={snippet.hint}
      className="min-h-9 rounded border border-stone-200 bg-white px-2.5 py-1.5 text-left text-xs hover:border-amber-300 hover:bg-amber-50"
    >
      <span className="font-medium">{snippet.label}</span>
      <span className="ml-1.5 font-mono text-stone-400">{snippet.text.replace(/\s*\|$/, '')}</span>
    </button>
  )
}

export default function PianoKit({ musicKey, meter, unit, onInsert, onInsertHand }: Props) {
  const [tab, setTab] = useState<Tab>('position')

  return (
    <div className="no-print border-b border-stone-200 bg-stone-50">
      <div className="flex flex-wrap gap-1 px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`rounded px-2.5 py-1.5 text-xs font-medium min-[900px]:py-1 ${
              tab === t.id
                ? 'bg-white text-amber-900 ring-1 ring-amber-300'
                : 'text-stone-500 hover:bg-stone-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-2 py-2">
        {tab === 'position' && (
          <div className="grid gap-1.5">
            <p className="text-xs text-stone-500">
              A five-finger position is the set of keys a hand sits on without moving. Click to put
              it in a hand.
            </p>
            {HAND_POSITIONS.map((p) => (
              <div key={p.name} className="flex flex-wrap items-center gap-2">
                <span className="min-w-36 text-xs font-medium">{p.name}</span>
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => onInsertHand('rh', fiveFingerExercise(p.right, meter, unit))}
                  title={p.hint}
                  className="min-h-9 rounded border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs hover:border-amber-300 hover:bg-amber-50"
                >
                  ↑ right: {p.right}
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => onInsertHand('lh', fiveFingerExercise(p.left, meter, unit))}
                  title={p.hint}
                  className="min-h-9 rounded border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs hover:border-amber-300 hover:bg-amber-50"
                >
                  ↓ left: {p.left}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'left' && (
          <div className="grid gap-1.5">
            <p className="text-xs text-stone-500">
              One bar of accompaniment in {musicKey}, sized for {meter}. Click to add it to the left
              hand.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {leftHandPatterns(musicKey, meter, unit).map((s) => (
                <SnippetButton
                  key={s.label}
                  snippet={s}
                  onClick={() => onInsertHand('lh', s.text)}
                />
              ))}
            </div>
          </div>
        )}

        {tab === 'rhythm' && (
          <div className="grid gap-1.5">
            <p className="text-xs text-stone-500">Hover any button to see what it does.</p>
            <div className="flex flex-wrap gap-1.5">
              {rhythmSnippets(meter, unit).map((s) => (
                <SnippetButton key={s.label} snippet={s} onClick={() => onInsert(s.text)} />
              ))}
            </div>
          </div>
        )}

        {tab === 'fingering' && (
          <div className="grid gap-1.5">
            <p className="text-xs text-stone-500">
              Click a finger number, then type the note it belongs to — 1 is the thumb.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FINGERS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => onInsert(s.text)}
                  title={s.hint}
                  className="min-h-10 min-w-10 rounded border border-stone-200 bg-white text-sm font-medium hover:border-amber-300 hover:bg-amber-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

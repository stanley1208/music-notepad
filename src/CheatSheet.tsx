interface Row {
  snippet: string
  label: string
  kind?: 'header'
}

interface Section {
  heading: string
  rows: Row[]
}

// Reference-only rows: explain the one-time setup block. Deliberately not
// clickable — inserting these mid-document would corrupt it.
const SETUP_LINES: Row[] = [
  { snippet: 'X:1', label: 'song number — always the first line, never changes' },
  { snippet: 'T:Warm-up', label: 'title printed on the sheet music' },
  { snippet: '%%score { 1 | 2 }', label: 'brace both hands into one piano system' },
  { snippet: '[V:1]', label: 'starts the right-hand music line' },
  { snippet: '[V:2]', label: 'starts the left-hand music line' },
]

const SECTIONS: Section[] = [
  {
    heading: 'Notes & octaves',
    rows: [
      { snippet: 'C D E F G A B', label: 'octave starting at middle C' },
      { snippet: 'c', label: 'lowercase = octave up' },
      { snippet: 'C,', label: 'comma = octave down' },
      { snippet: "c'", label: 'apostrophe = higher still' },
    ],
  },
  {
    heading: 'Durations (with L:1/4)',
    rows: [
      { snippet: 'C', label: 'quarter note' },
      { snippet: 'C2', label: 'half note' },
      { snippet: 'C4', label: 'whole note' },
      { snippet: 'C/2', label: 'eighth note' },
      { snippet: 'C3/2', label: 'dotted quarter' },
    ],
  },
  {
    heading: 'Chords, rests, bars',
    rows: [
      { snippet: '[CEG]', label: 'chord (notes sound together)' },
      { snippet: 'z', label: 'rest' },
      { snippet: '|', label: 'barline' },
      { snippet: '|]', label: 'final barline' },
    ],
  },
  {
    heading: 'Headers',
    rows: [
      { snippet: 'M:4/4', label: 'meter', kind: 'header' },
      { snippet: 'L:1/4', label: 'unit note length', kind: 'header' },
      { snippet: 'Q:1/4=100', label: 'tempo', kind: 'header' },
      { snippet: 'K:G', label: 'key (K:G = one sharp)', kind: 'header' },
      { snippet: 'V:1 clef=treble', label: 'voice: right hand', kind: 'header' },
      { snippet: 'V:2 clef=bass', label: 'voice: left hand', kind: 'header' },
    ],
  },
]

export default function CheatSheet({
  onInsert,
  onClose,
  simpleMode = false,
}: {
  onInsert: (snippet: string, opts?: { kind?: 'music' | 'header' }) => void
  onClose: () => void
  simpleMode?: boolean
}) {
  // In Simple mode headers are toolbar controls and setup lines are hidden,
  // so those reference sections would only confuse
  const sections = simpleMode ? SECTIONS.filter((s) => s.heading !== 'Headers') : SECTIONS
  return (
    <aside className="no-print fixed inset-x-0 bottom-0 z-30 max-h-[65vh] overflow-y-auto rounded-t-2xl border-t border-stone-300 bg-stone-50 p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.15)] min-[900px]:static min-[900px]:z-auto min-[900px]:max-h-none min-[900px]:w-72 min-[900px]:shrink-0 min-[900px]:rounded-none min-[900px]:border-t-0 min-[900px]:border-l min-[900px]:border-stone-200 min-[900px]:shadow-none">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">ABC cheat sheet</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cheat sheet"
          className="rounded px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-200 min-[900px]:hidden"
        >
          ✕ Close
        </button>
      </div>
      <p className="mb-3 text-xs text-stone-500">Click any snippet to insert it at the cursor.</p>
      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        <span className="font-semibold">New here?</span> Notes are just letters — typing{' '}
        <code className="font-mono">C D E F</code> in a music line draws those notes on the
        staff. For a 5-minute lesson, open the <span className="font-semibold">Start Here</span>{' '}
        document in the switcher at the top.
      </div>
      {!simpleMode && (
      <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Setup lines (top of every doc)
        </h3>
        <p className="mb-2 text-xs text-stone-500">
          Copied in automatically — you rarely edit these, and clicking them here does nothing.
        </p>
        <ul className="space-y-1.5 min-[900px]:space-y-1">
          {SETUP_LINES.map((row) => (
            <li key={row.snippet} className="flex items-baseline gap-2">
              <code className="shrink-0 rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-700 ring-1 ring-stone-200">
                {row.snippet}
              </code>
              <span className="text-xs text-stone-600">{row.label}</span>
            </li>
          ))}
        </ul>
      </section>
      )}
      {sections.map((section) => (
        <section key={section.heading} className="mb-5">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            {section.heading}
          </h3>
          <ul className="space-y-1.5 min-[900px]:space-y-1">
            {section.rows.map((row) => (
              <li key={row.snippet} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onInsert(row.snippet, { kind: row.kind ?? 'music' })}
                  className="min-h-10 shrink-0 rounded bg-white px-2.5 py-2 font-mono text-sm text-stone-800 ring-1 ring-stone-200 hover:bg-amber-50 hover:ring-amber-300 min-[900px]:min-h-0 min-[900px]:px-1.5 min-[900px]:py-0.5 min-[900px]:text-xs"
                  title="Insert at cursor"
                >
                  {row.snippet}
                </button>
                <span className="text-xs text-stone-600">{row.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}

interface Row {
  snippet: string
  label: string
}

interface Section {
  heading: string
  rows: Row[]
}

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
      { snippet: 'M:4/4', label: 'meter' },
      { snippet: 'L:1/4', label: 'unit note length' },
      { snippet: 'Q:1/4=100', label: 'tempo' },
      { snippet: 'K:G', label: 'key (K:G = one sharp)' },
      { snippet: 'V:1 clef=treble', label: 'voice: right hand' },
      { snippet: 'V:2 clef=bass', label: 'voice: left hand' },
    ],
  },
]

export default function CheatSheet({ onInsert }: { onInsert: (snippet: string) => void }) {
  return (
    <aside className="no-print w-72 shrink-0 overflow-y-auto border-l border-stone-200 bg-stone-50 p-4">
      <h2 className="mb-1 text-sm font-semibold text-stone-700">ABC cheat sheet</h2>
      <p className="mb-3 text-xs text-stone-500">Click any snippet to insert it at the cursor.</p>
      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        <span className="font-semibold">New here?</span> Notes are just letters — typing{' '}
        <code className="font-mono">C D E F</code> in a music line draws those notes on the
        staff. For a 5-minute lesson, open the <span className="font-semibold">Start Here</span>{' '}
        document in the switcher at the top.
      </div>
      {SECTIONS.map((section) => (
        <section key={section.heading} className="mb-5">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            {section.heading}
          </h3>
          <ul className="space-y-1">
            {section.rows.map((row) => (
              <li key={row.snippet} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onInsert(row.snippet)}
                  className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-xs text-stone-800 ring-1 ring-stone-200 hover:bg-amber-50 hover:ring-amber-300"
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

// Turning a score into this week's homework: who it is for, when it is due,
// and what to actually work on. None of it is required — a document with an
// empty assignment prints exactly as it did before this existed.

import { useState } from 'react'
import { EMPTY_ASSIGNMENT, type Assignment } from './storage'

interface Props {
  assignment: Assignment
  onChange: (patch: Partial<Assignment>) => void
}

/** Today as the value an <input type="date"> wants, in local time. */
function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function AssignmentBar({ assignment, onChange }: Props) {
  const a = { ...EMPTY_ASSIGNMENT, ...assignment }
  const filled = a.student.trim() !== '' || a.due !== '' || a.note.trim() !== ''
  const [open, setOpen] = useState(filled)

  return (
    <div className="no-print shrink-0 border-t border-stone-200 bg-stone-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-600 hover:bg-stone-100"
      >
        <span className="text-stone-400">{open ? '▾' : '▸'}</span>
        This week&apos;s assignment
        {!open && filled && (
          <span className="truncate font-normal text-stone-400">
            {[a.student, a.due].filter(Boolean).join(' · ')}
          </span>
        )}
        <span className="ml-auto font-normal text-stone-400">appears when printed</span>
      </button>

      {open && (
        <div className="grid gap-2 px-3 pb-3">
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-40 flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-stone-500">For</span>
              <input
                value={a.student}
                onChange={(e) => onChange({ student: e.target.value })}
                placeholder="Student's name"
                className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-stone-500">Date</span>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={a.due}
                  onChange={(e) => onChange({ due: e.target.value })}
                  className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => onChange({ due: todayLocal() })}
                  className="rounded border border-stone-300 bg-white px-2 text-xs text-stone-600 hover:bg-stone-100"
                >
                  Today
                </button>
              </div>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-stone-500">Practice note</span>
            <textarea
              value={a.note}
              onChange={(e) => onChange({ note: e.target.value })}
              rows={2}
              placeholder="Hands separately first. Slow and even — count out loud."
              className="resize-none rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  )
}

/** The same assignment as it appears on paper, above and below the score. */
export function AssignmentPrint({ assignment }: { assignment: Assignment }) {
  const a = { ...EMPTY_ASSIGNMENT, ...assignment }
  const who = a.student.trim()
  // Rendered from the parts rather than parsed as a date, so a value the
  // browser stored as YYYY-MM-DD never shifts a day across time zones.
  const when = /^\d{4}-\d{2}-\d{2}$/.test(a.due)
    ? new Date(
        Number(a.due.slice(0, 4)),
        Number(a.due.slice(5, 7)) - 1,
        Number(a.due.slice(8, 10)),
      ).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : ''
  if (!who && !when) return null
  return (
    <div className="print-only print-flex mb-2 justify-between border-b border-stone-300 pb-1 text-[11px] text-stone-600">
      <span>{who ? `For ${who}` : ''}</span>
      <span>{when}</span>
    </div>
  )
}

export function AssignmentNotePrint({ assignment }: { assignment: Assignment }) {
  const note = (assignment?.note ?? '').trim()
  if (!note) return null
  return (
    <div className="print-only mt-5 border-t border-stone-300 pt-2 text-[11px] leading-relaxed text-stone-700">
      <span className="font-semibold">This week: </span>
      {note}
    </div>
  )
}

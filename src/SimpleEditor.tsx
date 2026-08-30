import type { RefObject } from 'react'
import { KEY_CHOICES, METER_CHOICES, type SimpleFields } from './simple'

interface Props {
  fields: SimpleFields
  onChange: (patch: Partial<SimpleFields>) => void
  rhRef: RefObject<HTMLTextAreaElement | null>
  lhRef: RefObject<HTMLTextAreaElement | null>
  onHandFocus: (hand: 'rh' | 'lh') => void
  onHandBlur: () => void
}

export default function SimpleEditor({
  fields,
  onChange,
  rhRef,
  lhRef,
  onHandFocus,
  onHandBlur,
}: Props) {
  const keyIsListed = KEY_CHOICES.some((k) => k.value === fields.key)
  const meterIsListed = METER_CHOICES.includes(fields.meter)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          Key
          <select
            value={fields.key}
            onChange={(e) => onChange({ key: e.target.value })}
            className="rounded border border-stone-200 bg-white px-2 py-2 text-sm font-normal text-stone-800 min-[900px]:py-1"
          >
            {!keyIsListed && <option value={fields.key}>{fields.key}</option>}
            {KEY_CHOICES.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          Time
          <select
            value={fields.meter}
            onChange={(e) => onChange({ meter: e.target.value })}
            className="rounded border border-stone-200 bg-white px-2 py-2 text-sm font-normal text-stone-800 min-[900px]:py-1"
          >
            {!meterIsListed && <option value={fields.meter}>{fields.meter}</option>}
            {METER_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          Tempo (beats/min)
          <input
            type="number"
            min={20}
            max={400}
            value={fields.bpm}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              if (Number.isFinite(n)) onChange({ bpm: Math.min(400, Math.max(20, n)) })
            }}
            className="w-24 rounded border border-stone-200 bg-white px-2 py-2 text-sm font-normal text-stone-800 min-[900px]:py-1"
          />
        </label>
      </div>

      <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
        Right hand (treble) — notes: C D E F G A B, chords: [CEG], barline: |
        <textarea
          ref={rhRef}
          value={fields.rh}
          onChange={(e) => onChange({ rh: e.target.value })}
          onFocus={() => onHandFocus('rh')}
          onBlur={onHandBlur}
          spellCheck={false}
          placeholder="C D E F | G2 [ceg]2 | c4 |]"
          className="min-h-20 flex-1 resize-none rounded border border-stone-200 p-3 font-mono text-base leading-relaxed font-normal text-stone-800 focus:border-amber-400 focus:outline-none min-[900px]:text-sm"
        />
      </label>
      <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
        Left hand (bass) — a comma lowers the octave: C, G,
        <textarea
          ref={lhRef}
          value={fields.lh}
          onChange={(e) => onChange({ lh: e.target.value })}
          onFocus={() => onHandFocus('lh')}
          onBlur={onHandBlur}
          spellCheck={false}
          placeholder="C,2 G,2 | C,2 G,2 | C,4 |]"
          className="min-h-20 flex-1 resize-none rounded border border-stone-200 p-3 font-mono text-base leading-relaxed font-normal text-stone-800 focus:border-amber-400 focus:outline-none min-[900px]:text-sm"
        />
      </label>
    </div>
  )
}

// Turns everything that can be wrong with a document into plain-English,
// structured problems: engine warnings translated out of parser-speak, plus
// the checks abcjs never raises at all (wrong beats per bar, hands that don't
// line up, a stray bracket that silently splits a bar).
//
// Structured on purpose: later features (an explain-this tutor, an AI drill
// maker that retries until its draft is clean) consume these objects, not
// strings.
//
// Guiding rule: A FALSE POSITIVE IS WORSE THAN A MISS. This is for a beginner
// who will believe the app, so every check below stays quiet in any situation
// it cannot reason about confidently.

import abcjs from 'abcjs'
import type { TuneObject } from 'abcjs'

export interface Problem {
  severity: 'error' | 'warning' | 'hint'
  message: string
  fix?: string
  bar?: number
  hand?: 'right' | 'left'
  /** 1-based line in the document, when known */
  line?: number
  /**
   * True when the parser could not represent what was typed, so the score on
   * screen would not match the text. The app keeps the last good score in that
   * case. Advisory problems (bar lengths, hands out of sync) come from a tune
   * that parsed fine and must not hide it.
   */
  blocking?: boolean
}

type Hand = 'right' | 'left'

const EPS = 1e-6

// ---------------------------------------------------------------- warnings

// abcjs builds every warning in one place as
//   "Music Line:<line>:<col>: <message>:  <html snippet>"
// Both halves can themselves contain ":  " (abcjs's own "Duration not
// representable:  C/5" does, and so can a music line), so the split point is
// found by trying each one rather than guessed.
const WARNING_HEAD = /^Music Line:(\d+):(\d+|NaN): ([\s\S]*)$/
const SPLIT = ':  '

// Only the underline span abcjs injects is stripped: a blanket tag strip would
// eat the user's own text in a message like `Unknown decoration: <x>`.
const decode = (s: string) =>
  s
    .replace(/<\/?span\b[^>]*>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

interface Rule {
  match: RegExp
  message: string | ((m: RegExpMatchArray) => string)
  fix?: string
  /**
   * abcjs skipped one token and engraved everything else, so the score still
   * matches the text closely enough to show. These never freeze the score.
   */
  cosmetic?: boolean
}

// Ordered: the first match wins, so specific rules precede general ones.
const RULES: Rule[] = [
  {
    match: /^Expected '\]' to end the chords$/,
    message: 'A chord was opened with [ but never closed with ].',
    fix: 'Add the missing ] — notes played together look like [CEG].',
  },
  {
    match: /^Spaces are not allowed in chords$/,
    message: 'There is a space inside a chord.',
    fix: 'Squeeze the notes together: [CEG], not [C E G].',
  },
  {
    match: /^Duration not representable:\s*(.*)$/,
    message: (m) => `“${m[1].trim()}” is a note length that cannot be drawn as one note.`,
    fix: 'With L:1/4 use C (one beat), C2 (two), C4 (four), C/2 (half a beat) or C3/2 (a dotted beat).',
  },
  {
    match: /^Unknown bar (symbol|type)$/,
    message: 'That combination of | and : is not a barline.',
    fix: 'Use | between bars, |] at the end, or |: and :| around a repeated section.',
  },
  {
    match: /^Missing the closing quote while parsing the chord symbol$/,
    message: 'A chord name was opened with a quote mark but never closed.',
    fix: 'Add the closing " — chord names look like "C" or "G7" before the note they sit above.',
  },
  {
    match: /^Missing the closing '\}' while parsing grace note$/,
    message: 'A grace note was opened with { but never closed with }.',
    fix: 'Add the missing } — grace notes look like {g}A.',
  },
  {
    match: /^Rests not allowed as grace notes/,
    message: 'A grace note cannot be a rest.',
    fix: 'Put a real note inside the braces, like {g}C, or delete the { }.',
  },
  {
    match: /^Unknown character '(.)' while parsing grace note$/,
    message: (m) => `“${m[1]}” is not allowed inside a grace note.`,
    fix: 'Grace notes hold only note letters and ^ _ = , ’ — like {^fg}A.',
  },
  {
    match: /^Unknown decoration:\s*(.*)$/,
    message: (m) => `“${m[1].trim()}” is not a symbol this app knows, so nothing was drawn.`,
    fix: 'Common ones are !p! !f! !mf! for loudness and !fermata! !trill! !staccato!.',
    cosmetic: true,
  },
  {
    match: /^Can't nest triplets$/,
    message: 'One triplet was started inside another.',
    fix: 'Delete the extra (3 — a single (3 covers the next three notes, like (3CDE.',
  },
  {
    match: /^expected number after the triplet/,
    message: 'A number was expected after (3: and none was found.',
    fix: 'Write a plain (3CDE, or the long form (3:2:3CDE.',
  },
  {
    match: /^Unknown parameter:\s*(.*)$/,
    message: (m) => `“${m[1].trim()}” cannot go on the key line, so it was ignored.`,
    fix: 'A key line looks like K:C, K:G, K:F or K:Am.',
    cosmetic: true,
  },
  {
    match: /^Expected clef name\.\s*Found\s*(.*)$/,
    message: (m) => `“${m[1].trim()}” is not a clef name.`,
    fix: 'The right hand uses clef=treble and the left hand uses clef=bass.',
  },
  {
    match: /^Unsupported key signature:\s*(.*)$/,
    message: (m) => `“${m[1].trim()}” is not a key that can be written down.`,
    fix: 'Try C, G, D, A, F, Bb or Eb — add m for a minor key, like Am.',
  },
  {
    match: /^(Expected top number of meter|Expected bottom number of meter|Expected slash in meter|Expected meter definition in M: line|Unexpected paren in meter)$/,
    message: 'The time signature is not a pair of numbers.',
    fix: 'Write it as top/bottom — M:4/4 for four beats a bar, M:3/4 for three.',
  },
  {
    match: /Q: field$/,
    message: 'The tempo line is not in a form this app understands.',
    fix: 'Write a note length, an equals sign and a number: Q:1/4=100.',
    cosmetic: true,
  },
  {
    match: /^Can't have an unknown V: id when the %score directive is present$/,
    message: 'This line is for a hand that does not exist.',
    fix: 'Music lines start with [V:1] for the right hand or [V:2] for the left hand.',
  },
  {
    match: /^Expected a voice id$/,
    message: 'A voice line does not say which hand it is for.',
    fix: 'Name it: V:1 clef=treble for the right hand, V:2 clef=bass for the left.',
  },
  {
    match: /^Unknown directive:\s*(.*)$/,
    message: (m) => `“${m[1].trim()}” is not a setting this app knows, so that line did nothing.`,
    fix: 'The one this app needs is %%score { 1 | 2 }, which braces the two hands together.',
    cosmetic: true,
  },
  {
    match: /^(Can't add words before the first line of music|Can't add symbols before the first line of music)$/,
    message: 'A lyrics or symbol line appears before any music.',
    fix: 'Move it so it sits directly under the notes it belongs to.',
    cosmetic: true,
  },
  {
    match: /^Ignored header$/,
    message: 'That header line is not supported, so it was skipped.',
    fix: 'The music looks the same without it.',
    cosmetic: true,
  },
  {
    match: /^Unknown character ignored$/,
    message: 'There is a character here that is not music, so it was skipped.',
    fix: 'Sharps are ^C, flats are _B and naturals are =C. If you pasted this from a chat, use Clean it up.',
  },
  {
    match: /^TypeError/,
    message: 'A header line stops halfway through.',
    fix: 'Finish it — M:4/4 needs both numbers, and Q:1/4=100 needs the number after the equals sign.',
  },
]

interface Translated extends Problem {
  col?: number
}

function translateWarning(raw: string, lineOffset: number): Translated {
  const head = raw.match(WARNING_HEAD)
  const line = head ? Number(head[1]) + lineOffset : undefined
  const col = head && head[2] !== 'NaN' ? Number(head[2]) : undefined
  const rest = head ? head[3] : raw

  // Try every possible message/snippet boundary, shortest first, and take the
  // first one a rule recognises.
  const candidates: string[] = []
  for (let at = rest.indexOf(SPLIT); at !== -1; at = rest.indexOf(SPLIT, at + 1)) {
    candidates.push(rest.slice(0, at))
  }
  candidates.push(rest) // no separator at all

  for (const candidate of candidates) {
    const body = decode(candidate).trim()
    for (const rule of RULES) {
      const hit = body.match(rule.match)
      if (hit) {
        return {
          severity: rule.cosmetic ? 'warning' : 'error',
          blocking: !rule.cosmetic,
          message: typeof rule.message === 'function' ? rule.message(hit) : rule.message,
          fix: rule.fix,
          line,
          col,
        }
      }
    }
  }
  // Unrecognised warning: show the fullest message available, never raw markup.
  const fallback = decode(candidates[Math.max(0, candidates.length - 2)]).trim()
  return {
    severity: 'error',
    blocking: true,
    message: `The music could not be read here: ${fallback}`,
    line,
    col,
  }
}

// ------------------------------------------------------------- bar lengths

interface Measure {
  /** duration in whole notes */
  beats: number
  items: number
  /** how many printed bars this measure stands for (Z4 = 4) */
  span: number
  meter: { num: number; den: number }
  closer: string | null
}

/** Barlines that legitimately end a section, where a short bar is expected. */
const SECTION_ENDS = new Set(['bar_right_repeat', 'bar_dbl_repeat', 'bar_thin_thick'])

function meterOf(m: unknown): { num: number; den: number } | null {
  const meter = m as { type?: string; value?: Array<{ num: unknown; den: unknown }> }
  if (!meter) return null
  if (meter.type === 'cut_time') return { num: 2, den: 2 }
  if (meter.type === 'common_time') return { num: 4, den: 4 }
  const v = meter.value?.[0]
  if (!v) return null
  // num/den come back as strings, and "3+2+2" is legal
  const rawNum = String(v.num)
  const num = rawNum.includes('+')
    ? rawNum.split('+').reduce((a, p) => a + parseInt(p, 10), 0)
    : parseInt(rawNum, 10)
  const den = parseInt(String(v.den), 10)
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null
  return { num, den }
}

/** Split one voice into measures, in whole-note units. */
function splitVoice(voice: unknown[], startMeter: { num: number; den: number }): Measure[] {
  const out: Measure[] = []
  let meter = startMeter
  let cur: Measure = { beats: 0, items: 0, span: 1, meter, closer: null }
  let triplet = 1
  let tripletLeft = 0

  for (const raw of voice) {
    const el = raw as {
      el_type?: string
      duration?: number
      type?: string
      rest?: { type?: string; text?: number }
      startTriplet?: number
      tripletR?: number
      tripletMultiplier?: number
      endTriplet?: boolean
    }
    if (el.el_type === 'meter') {
      const m = meterOf(el)
      if (m) meter = m
      cur.meter = meter
      continue
    }
    if (el.el_type === 'bar') {
      cur.closer = el.type ?? null
      out.push(cur)
      cur = { beats: 0, items: 0, span: 1, meter, closer: null }
      triplet = 1
      tripletLeft = 0
      continue
    }
    if (el.el_type !== 'note') continue

    // `y` is a layout spacer with a duration but no musical time. Counting it
    // is the easiest false positive to ship.
    if (el.rest?.type === 'spacer') continue

    if (el.rest?.type === 'multimeasure' || el.rest?.type === 'invisible-multimeasure') {
      cur.span = el.rest.text ?? 1
      cur.beats = el.duration ?? 0 // already bars * barLength
      cur.items += 1
      continue
    }

    // Tuplet ratios are NOT baked into duration; carry the multiplier. The
    // number of notes covered is tripletR (the "r" of (p:q:r) — startTriplet
    // is only the printed number, so (3:2:6 covers six notes, not three.
    if (el.startTriplet) {
      triplet = el.tripletMultiplier ?? 1
      tripletLeft = el.tripletR ?? el.startTriplet
    }
    cur.beats += (el.duration ?? 0) * (tripletLeft > 0 ? triplet : 1)
    cur.items += 1
    if (tripletLeft > 0) {
      tripletLeft -= 1
      if (el.endTriplet || tripletLeft === 0) {
        triplet = 1
        tripletLeft = 0
      }
    }
  }
  if (cur.items > 0) out.push(cur)
  return out
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * A gap expressed as a legal ABC rest. ABC has no decimals: a length is a
 * whole number, a fraction, or both — never "z1.5".
 */
function restToken(gapWholeNotes: number, unit: number): string {
  const units = gapWholeNotes / unit
  if (!Number.isFinite(units) || units <= 0) return 'z'
  const whole = Math.round(units)
  if (Math.abs(units - whole) < 1e-6) return whole === 1 ? 'z' : `z${whole}`
  for (const den of [2, 4, 8, 16]) {
    const num = units * den
    if (Math.abs(num - Math.round(num)) < 1e-6) {
      const n = Math.round(num)
      return n === 1 ? `z/${den}` : `z${n}/${den}`
    }
  }
  return `z${Math.max(1, whole)}`
}

/** The unit note length (L:) as a fraction of a whole note. */
function unitLengthOf(abc: string, meter: { num: number; den: number }): number {
  const m = abc.match(/^L:\s*(\d+)\s*\/\s*(\d+)\s*$/m)
  if (m) {
    const n = parseInt(m[1], 10)
    const d = parseInt(m[2], 10)
    if (n > 0 && d > 0) return n / d
  }
  // ABC's own default: 1/8 when the meter is at least 0.75, else 1/16
  return meter.num / meter.den >= 0.75 ? 1 / 8 : 1 / 16
}

function checkStructure(tune: TuneObject, abc: string): Problem[] {
  const problems: Problem[] = []

  // getMeterFraction() returns a plain { num, den } with real numbers — NOT a
  // Meter object like the inline meter items in the voice stream, which carry
  // .type/.value with string numerals.
  const mf = (
    tune as unknown as { getMeterFraction?: () => { num?: number; den?: number } }
  ).getMeterFraction?.()
  const startMeter =
    mf && Number(mf.num) > 0 && Number(mf.den) > 0
      ? { num: Number(mf.num), den: Number(mf.den) }
      : { num: 4, den: 4 }

  // Voices continue across line groups, so join them by staff index. A meter
  // change written at a line boundary lands on staff.meter instead of in the
  // voice stream, so replay it as a synthetic item — otherwise every bar after
  // a mid-tune M: change is reported as the wrong length.
  const staves: Array<{ clef?: string; voices: unknown[][] }> = []
  for (const line of tune.lines as Array<{
    staff?: Array<{ clef?: { type?: string }; meter?: unknown; voices: unknown[][] }>
  }>) {
    if (!line.staff) continue
    line.staff.forEach((staff, si) => {
      if (!staves[si]) staves[si] = { clef: staff.clef?.type, voices: [] }
      const meterItem = staff.meter ? [{ el_type: 'meter', ...(staff.meter as object) }] : []
      staff.voices.forEach((voice, vi) => {
        staves[si].voices[vi] = (staves[si].voices[vi] ?? []).concat(meterItem, voice)
      })
    })
  }
  if (staves.length === 0) return problems

  // On a grand staff the hand is the STAFF, not the clef: abcjs defaults a
  // clef-less staff to treble, which would name both staves "right hand".
  const clefs = staves.map((s) => s.clef ?? '')
  const swapped =
    staves.length === 2 && clefs[0].startsWith('bass') && clefs[1].startsWith('treble')
  const handOf = (si: number): Hand | undefined => {
    if (staves.length === 2) {
      if (swapped) return si === 0 ? 'left' : 'right'
      return si === 0 ? 'right' : 'left'
    }
    if (clefs[si].startsWith('bass')) return 'left'
    if (clefs[si].startsWith('treble')) return 'right'
    return undefined
  }
  const handName = (h: Hand | undefined) =>
    h === 'right' ? 'right hand' : h === 'left' ? 'left hand' : 'this staff'

  // Only the notated voice of each staff; `&` overlays are a layer, not a hand.
  const perStaff = staves.map((s) => splitVoice(s.voices[0] ?? [], startMeter))
  const unit = unitLengthOf(abc, startMeter)
  const expectedOf = (m: Measure) => (m.meter.num / m.meter.den) * m.span

  // A pickup (short opening bar) is only a pickup when every hand agrees. Use
  // the first measure that actually holds music: a leading `|:` produces an
  // empty segment that is not a bar.
  const withMusic = perStaff.filter((ms) => ms.some((m) => m.items > 0))
  const firsts = withMusic
    .map((ms) => ms.find((m) => m.items > 0))
    .filter((m): m is Measure => !!m)
  const allShortEqual =
    firsts.length > 0 &&
    firsts.length === withMusic.length &&
    firsts.every((f) => f.beats < expectedOf(f) - EPS) &&
    firsts.every((f) => Math.abs(f.beats - firsts[0].beats) < EPS)
  const pickup = allShortEqual ? firsts[0].beats : 0

  perStaff.forEach((measures, si) => {
    const hand = handOf(si)
    const real = measures.filter((m) => m.items > 0)
    let barNo = pickup > 0 ? 0 : 1
    real.forEach((m, idx) => {
      const isLast = idx === real.length - 1
      const expected = expectedOf(m)
      const beatUnit = 1 / m.meter.den
      const actualBeats = round(m.beats / beatUnit)
      const expectedBeats = round(expected / beatUnit)
      const diff = m.beats - expected
      // A bar that closes a section (repeat, double bar, the end) may be short
      // by exactly the pickup, because the pickup completes it.
      const closesSection = SECTION_ENDS.has(m.closer ?? '') || isLast
      const completesPickup = pickup > 0 && Math.abs(m.beats + pickup - expected) < EPS

      if (barNo === 0) {
        // the pickup itself is meant to be short
      } else if (diff > EPS) {
        problems.push({
          severity: 'error',
          hand,
          bar: barNo,
          message: `Bar ${barNo} in the ${handName(hand)} has ${plural(actualBeats, 'beat')}, but ${m.meter.num}/${m.meter.den} allows ${expectedBeats}.`,
          fix: `Remove ${plural(round(actualBeats - expectedBeats), 'beat')} from that bar, or put a barline | earlier.`,
        })
      } else if (diff < -EPS && !(closesSection && completesPickup)) {
        problems.push({
          severity: isLast ? 'warning' : 'error',
          hand,
          bar: barNo,
          message: `Bar ${barNo} in the ${handName(hand)} has only ${plural(actualBeats, 'beat')}, but ${m.meter.num}/${m.meter.den} needs ${expectedBeats}.`,
          fix: `Add ${plural(round(expectedBeats - actualBeats), 'beat')} — a rest is z, so ${restToken(expected - m.beats, unit)} fills the gap.`,
        })
      }
      barNo += m.span
    })
  })

  if (staves.length === 2) {
    // Hands with different bar counts drift apart, and the engraved score hides
    // it because both staves are stretched to the same width.
    const counts = perStaff.map((ms) =>
      ms.filter((m) => m.items > 0).reduce((a, m) => a + m.span, 0),
    )
    if (counts[0] > 0 && counts[1] > 0 && counts[0] !== counts[1]) {
      problems.push({
        severity: 'error',
        message: `The hands have different numbers of bars: ${counts[0]} in the right hand, ${counts[1]} in the left. From the shorter one on, they play different music at the same time.`,
        fix: 'Add or remove bars so both hands have the same number. A silent bar is z4.',
      })
    }

    // A hand left empty prints as a blank staff. Never complain when both are
    // empty — that is a fresh document.
    const noteCounts = perStaff.map((ms) => ms.reduce((a, m) => a + m.items, 0))
    if (noteCounts[0] > 0 && noteCounts[1] === 0) {
      problems.push({
        severity: 'warning',
        hand: 'left',
        message: 'The left hand is empty, so it prints as a blank staff.',
        fix: 'Add left-hand notes, or fill the bars with rests — z4 is one silent bar of 4/4.',
      })
    } else if (noteCounts[1] > 0 && noteCounts[0] === 0) {
      problems.push({
        severity: 'warning',
        hand: 'right',
        message: 'The right hand is empty, so it prints as a blank staff.',
        fix: 'Add right-hand notes, or fill the bars with rests — z4 is one silent bar of 4/4.',
      })
    }
  }

  return problems
}

// ------------------------------------------------------------- text checks

/** Remove the spans where brackets and parentheses are not structural. */
function stripSpans(music: string): string {
  return music
    .replace(/%.*$/, '')
    .replace(/"[^"]*"/g, '')
    .replace(/![^!]*!/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\[[A-Za-z]:[^\]]*\]/g, '') // inline fields like [K:G]
}

// Barline tokens, LONGEST FIRST. JS alternation is leftmost-first, so a shorter
// alternative matching at the same spot (":|" inside ":|]") would strand the
// bracket and report a stray "]" on every piece that ends on a repeat.
const BARLINES = /:\|\]|\[\|\]|\[\|:|\]\||\[\||\|\]|\|\||\|:|:\||::/g

function checkText(abc: string): Problem[] {
  const problems: Problem[] = []
  const lines = abc.split('\n')

  // A slur may open on one line of a hand and close on a later one, because a
  // hand can be split over several [V:n] lines. Balance per hand, not per line.
  const slurs = new Map<string, { open: number; line: number }>()

  lines.forEach((raw, i) => {
    const voiceMatch = raw.match(/^\[V:(\d)\]/)
    if (!voiceMatch && /^[A-Za-z]:/.test(raw)) return // header line
    if (raw.trim() === '' || raw.trim().startsWith('%')) return
    const hand: Hand | undefined =
      voiceMatch?.[1] === '1' ? 'right' : voiceMatch?.[1] === '2' ? 'left' : undefined
    const key = voiceMatch?.[1] ?? 'single'
    const where = hand ? ` in the ${hand} hand` : ''

    const music = stripSpans(raw.replace(/^\[V:\d\]/, '')).replace(BARLINES, ' ')

    let depth = 0
    let strayClose = false
    for (const ch of music) {
      if (ch === '[') depth++
      else if (ch === ']') {
        if (depth === 0) strayClose = true
        else depth--
      }
    }
    if (strayClose) {
      problems.push({
        severity: 'error',
        hand,
        line: i + 1,
        message: `There is a ] with no [ in front of it${where}. A lone ] is read as an invisible barline, which quietly splits the bar in two.`,
        fix: 'Delete the ], or put the [ back in front of the notes that belong in the chord: [CEG].',
      })
    }

    // `(` followed by a digit is a tuplet marker, not a slur.
    const opens = (music.match(/\((?!\d)/g) ?? []).length
    const closes = (music.match(/\)/g) ?? []).length
    const acc = slurs.get(key) ?? { open: 0, line: i + 1 }
    if (acc.open === 0 && opens > closes) acc.line = i + 1
    acc.open += opens - closes
    slurs.set(key, acc)
  })

  for (const [key, acc] of slurs) {
    if (acc.open <= 0) continue
    const hand = key === '1' ? 'right' : key === '2' ? 'left' : undefined
    problems.push({
      severity: 'warning',
      hand,
      line: acc.line,
      message: `A phrase mark was opened with ( ${
        hand ? `in the ${hand} hand` : 'here'
      } but never closed, so no phrase mark is drawn at all.`,
      fix: 'Add a ) after the last note of the phrase — (C D E F) slurs those four notes — or delete the (.',
    })
  }

  return problems
}

// ----------------------------------------------------------------- red ink

/**
 * Text the engraver paints red on the score. It never reaches tune.warnings,
 * and some of it is engine wording ("no symbol:") rather than the user's text.
 */
export function describeRedInk(texts: string[]): Problem | null {
  const cleaned = [
    ...new Set(texts.map((t) => t.replace(/^no symbol:\s*/, '').trim()).filter(Boolean)),
  ]
  if (cleaned.length === 0) return null

  const clef = cleaned.find((t) => t.startsWith('clef='))
  if (clef) {
    return {
      severity: 'error',
      blocking: true,
      message: `“${clef}” is not a clef name, so that staff has no clef and its notes are drawn in the wrong place.`,
      fix: 'The right hand uses V:1 clef=treble and the left hand uses V:2 clef=bass.',
    }
  }
  if (cleaned.some((t) => /pitch is undefined/i.test(t))) {
    return {
      severity: 'error',
      blocking: true,
      message:
        'A note is too long to be drawn as a single note, so the score shows an error where it should be.',
      fix: 'Shorten the number after the note. With L:1/4, C4 fills a whole bar; to hold longer, tie two notes with a dash: C4-|C4.',
    }
  }
  return {
    severity: 'error',
    blocking: true,
    message: `The score could not understand ${cleaned.map((t) => `“${t}”`).join(', ')}, so it is printed in red on the music.`,
    fix: 'Check that spot for a typo.',
  }
}

// ------------------------------------------------------------------ public

/**
 * Everything wrong with a document, in plain English. Runs its own parse:
 * the tune handed to the player must never be touched by these checks.
 */
export function analyzeAbc(abc: string): Problem[] {
  if (abc.trim() === '') return []
  const problems: Problem[] = []

  // Warning line numbers count from the start of the tune abcjs parsed, which
  // is the first X: line — but abcjs hoists any %% directives found before it
  // onto the front of that tune, so those lines are counted too.
  const lines = abc.split('\n')
  const xIndex = lines.findIndex((l) => /^\s*X:/.test(l))
  const hoisted = xIndex > 0 ? lines.slice(0, xIndex).filter((l) => /^\s*%%/.test(l)).length : 0
  const lineOffset = xIndex > 0 ? xIndex - hoisted : 0

  let tune: TuneObject | undefined
  try {
    tune = abcjs.parseOnly(abc)[0]
  } catch {
    return [
      {
        severity: 'error',
        blocking: true,
        message: 'The music could not be read at all.',
        fix: 'Check the last thing you typed, or press Ctrl+Z to undo it.',
      },
    ]
  }
  if (!tune) return problems

  const warnings = (tune as unknown as { warnings?: string[] }).warnings ?? []
  const seen = new Set<string>()
  for (const w of warnings) {
    const translated = translateWarning(w, lineOffset)
    // abcjs raises some problems twice at the SAME spot; show one, not two.
    // The column is part of the key so two different mistakes on one line are
    // not collapsed into one.
    const key = `${translated.message}|${translated.line ?? ''}|${translated.col ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const { col, ...problem } = translated
    void col
    problems.push(problem)
  }

  problems.push(...checkText(abc))

  // Structural checks only make sense once the text itself parses cleanly — a
  // stray ] shifts every downstream bar number in one hand only, and a blocking
  // warning means the parse does not reflect what was typed.
  const hasStructuralNoise = problems.some((p) => p.blocking || p.severity === 'error')
  if (!hasStructuralNoise) {
    try {
      problems.push(...checkStructure(tune, abc))
    } catch {
      // a check must never take the app down with it
    }
  }

  return problems
}

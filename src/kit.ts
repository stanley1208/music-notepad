// The vocabulary a piano teacher actually writes with: five-finger hand
// positions, left-hand accompaniment patterns that follow the key, fingering
// numbers, and the rhythm marks that come up in a beginner's first year.
//
// Everything here produces ordinary ABC, so a document built entirely from
// these buttons is still a plain text file anyone else's software can open.

export interface Snippet {
  label: string
  /** what gets inserted */
  text: string
  hint: string
}

// ------------------------------------------------------------ bar sizing
//
// Every duration in ABC is a multiple of the unit note length (the L: header),
// NOT of the meter's beat. Those two agree in 4/4 with L:1/4 and stop agreeing
// the moment either changes: 6/8 with L:1/4 holds three unit notes per bar,
// not six. So a bar's capacity is measured here in unit notes, exactly:
//
//     capacity = (meter numerator / meter denominator) / unit
//
// and kept as a fraction, because 5/8 with L:1/4 really is two and a half of
// them, and rounding that off would write a wrong-length bar.

interface Frac {
  n: number
  d: number
}

function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

function frac(n: number, d: number): Frac {
  const g = gcd(Math.abs(n), Math.abs(d)) || 1
  return { n: n / g, d: d / g }
}

function parseFraction(s: string, fallback: Frac): Frac {
  const m = s.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!m) return fallback
  const n = parseInt(m[1], 10)
  const d = parseInt(m[2], 10)
  if (!(n > 0) || !(d > 0)) return fallback
  return frac(n, d)
}

/** The L: header as a fraction of a whole note. */
function unitFrac(unit: string): Frac {
  return parseFraction(unit, { n: 1, d: 4 })
}

/** How many unit notes fit in one bar, as an exact fraction. */
function barCapacity(meter: string, unit: string): Frac {
  const m = parseFraction(meter, { n: 4, d: 4 })
  const u = unitFrac(unit)
  return frac(m.n * u.d, m.d * u.n)
}

/** The ABC length suffix for a duration of `f` unit notes: "" for 1, "2", "3/2". */
function lengthSuffix(f: Frac): string {
  if (f.d === 1) return f.n === 1 ? '' : String(f.n)
  return f.n + '/' + f.d
}

function isPowerOfTwo(x: number): boolean {
  return x >= 1 && (x & (x - 1)) === 0
}

/**
 * Whether `f` unit notes can be drawn as a single notehead. Only plain,
 * dotted and double-dotted values can — a bar of 5/8 is two and a half
 * quarter notes, and no such notehead exists.
 */
function drawable(f: Frac, unit: Frac): boolean {
  const n = f.n * unit.n
  const d = f.d * unit.d
  for (const dots of [1, 3, 7]) {
    const g = gcd(n, d * dots) || 1
    if (isPowerOfTwo(n / g) && isPowerOfTwo((d * dots) / g)) return true
  }
  return false
}

/**
 * A duration split into pieces that can each be drawn, largest first. A
 * whole 5/8 bar comes back as a half note plus an eighth, which the callers
 * join with ties — how a musician would write it by hand.
 */
function holdPieces(cap: Frac, unit: Frac): Frac[] {
  if (drawable(cap, unit)) return [cap]
  const out: Frac[] = []
  let rem = cap
  for (let guard = 0; rem.n > 0 && guard < 8; guard++) {
    let best: Frac | null = null
    for (let k = 6; k >= -6; k--) {
      const cand = k >= 0 ? frac(2 ** k, 1) : frac(1, 2 ** -k)
      // cand <= rem, compared without floating point
      if (cand.n * rem.d <= rem.n * cand.d && drawable(cand, unit)) {
        best = cand
        break
      }
    }
    if (!best) break
    out.push(best)
    rem = frac(rem.n * best.d - best.n * rem.d, rem.d * best.d)
  }
  return out.length > 0 ? out : [cap]
}

/** The same split as `held`, written without ties - for rests, which never tie. */
function holdPiecesText(head: string, cap: Frac, unit: Frac): string {
  return holdPieces(cap, unit)
    .map((p) => head + lengthSuffix(p))
    .join(' ')
}

/** One sustained note or chord of the given length, tied if it needs to be. */
function held(head: string, cap: Frac, unit: Frac): string {
  return holdPieces(cap, unit)
    .map((p) => head + lengthSuffix(p))
    .join('-')
}

// ------------------------------------------------------- hand positions

export interface HandPosition {
  name: string
  /** the five notes under the right hand, thumb first */
  right: string
  /** the same position an octave down for the left hand */
  left: string
  hint: string
}

export const HAND_POSITIONS: HandPosition[] = [
  {
    name: 'C position',
    right: 'C D E F G',
    left: 'C, D, E, F, G,',
    hint: 'Right thumb on middle C, five white keys upward.',
  },
  {
    name: 'G position',
    right: 'G A B c d',
    left: 'G, A, B, C D',
    hint: 'Right thumb on the G above middle C.',
  },
  {
    name: 'F position',
    right: 'F G A B c',
    left: 'F, G, A, B, C',
    hint: 'Right thumb on the F below the G position.',
  },
  {
    name: 'Middle C position',
    right: 'C D E F G',
    left: 'F, G, A, B, C',
    hint: 'Both thumbs on middle C, hands moving outward.',
  },
]

/**
 * The classic five-finger warm-up: up the five notes, back down, and hold the
 * last one out. Laid into bars the meter actually allows, so clicking the
 * button can never leave a wrong-length bar behind.
 */
export function fiveFingerExercise(position: string, meter: string, unit: string): string {
  const notes = position.trim().split(/\s+/).filter(Boolean)
  if (notes.length < 2) return position
  const updown = [...notes, ...notes.slice(0, -1).reverse()]

  // Counted in 1/d of a unit note, so a bar holding two and a half of them is
  // still whole-number arithmetic.
  const cap = barCapacity(meter, unit)
  const whole = cap.d
  const total = cap.n
  const bars: Array<Array<{ note: string; size: number }>> = []
  let bar: Array<{ note: string; size: number }> = []
  let left = total

  for (const note of updown) {
    const size = Math.min(whole, left)
    bar.push({ note, size })
    left -= size
    if (left <= 0) {
      bars.push(bar)
      bar = []
      left = total
    }
  }
  if (bar.length > 0) {
    // whatever is still open belongs to the note that ends the exercise
    const used = bar.reduce((s, x) => s + x.size, 0)
    bar[bar.length - 1].size += total - used
    bars.push(bar)
  }

  const u = unitFrac(unit)
  const render = (b: Array<{ note: string; size: number }>) =>
    b.map((x) => held(x.note, frac(x.size, cap.d), u)).join(' ')
  return bars.map(render).join(' | ') + ' |'
}

// -------------------------------------------------- left-hand patterns

/**
 * The tonic triad in the left hand for each key the app offers. Spelled out
 * rather than derived, because the right spelling depends on the key
 * signature, and a wrong accidental is worse than a missing feature.
 */
const KEY_TRIADS: Record<string, [string, string, string]> = {
  C: ['C,', 'E,', 'G,'],
  G: ['G,', 'B,', 'D'],
  D: ['D,', '^F,', 'A,'],
  A: ['A,', '^C', 'E'],
  F: ['F,', 'A,', 'C'],
  Bb: ['_B,', 'D', 'F'],
  Eb: ['_E,', 'G,', '_B,'],
  Am: ['A,', 'C', 'E'],
  Em: ['E,', 'G,', 'B,'],
  Dm: ['D,', 'F,', 'A,'],
}

function triadFor(key: string): [string, string, string] {
  return KEY_TRIADS[key] ?? KEY_TRIADS.C
}

/** The length of one note when a bar splits into `count` equal ones, or null. */
function evenSplit(cap: Frac, count: number): string | null {
  if (cap.d !== 1 || cap.n % count !== 0) return null
  return lengthSuffix(frac(cap.n / count, 1))
}

/**
 * One bar of left-hand accompaniment in the given key, sized to the meter so
 * it never lands the person in a wrong-length bar.
 */
export function leftHandPatterns(key: string, meter: string, unit: string): Snippet[] {
  const [root, third, fifth] = triadFor(key)
  const cap = barCapacity(meter, unit)
  const u = unitFrac(unit)

  const patterns: Snippet[] = [
    {
      label: 'Held root',
      text: held(root, cap, u) + ' |',
      hint: 'One long bass note under the whole bar - the simplest left hand there is.',
    },
    {
      label: 'Blocked chord',
      text: held('[' + root + third + fifth + ']', cap, u) + ' |',
      hint: 'All three notes of the chord struck together and held.',
    },
  ]

  // A repeating figure is only offered where the bar actually divides into it:
  // three notes in 3/4 and 6/8, four in 4/4. Anywhere else the held forms above
  // are still there, and no button ever writes a bar of the wrong length.
  const in3 = evenSplit(cap, 3)
  const in4 = evenSplit(cap, 4)
  if (in3) {
    patterns.push({
      label: 'Broken chord',
      text: [root + in3, third + in3, fifth + in3].join(' ') + ' |',
      hint: 'The chord one note at a time, going up.',
    })
  } else if (in4) {
    patterns.push({
      label: 'Broken chord',
      text: [root + in4, third + in4, fifth + in4, third + in4].join(' ') + ' |',
      hint: 'The chord one note at a time, up and back down.',
    })
  }
  if (in4) {
    patterns.push({
      label: 'Alberti bass',
      text: [root + in4, fifth + in4, third + in4, fifth + in4].join(' ') + ' |',
      hint: 'Low-high-middle-high: the rocking pattern in a lot of classical piano.',
    })
  }
  return patterns
}

// --------------------------------------------------------- rhythm marks

export function rhythmSnippets(meter: string, unit: string): Snippet[] {
  const cap = barCapacity(meter, unit)
  const u = unitFrac(unit)
  const full = held('C', cap, u)
  const in3 = evenSplit(cap, 3)
  const in4 = evenSplit(cap, 4)

  // exactly one bar's worth of notes to sit between the repeat marks
  const inner = in4
    ? ['C' + in4, 'D' + in4, 'E' + in4, 'F' + in4].join(' ')
    : in3
      ? ['C' + in3, 'D' + in3, 'E' + in3].join(' ')
      : full

  // rests are never tied: an odd-length bar simply gets two of them
  const rest = holdPiecesText('z', cap, u)

  return [
    { label: 'Whole-bar rest', text: rest + ' |', hint: 'A silent bar.' },
    {
      label: 'Dotted note',
      text: 'C3/2 D/2',
      hint: 'A long note and a short one - the "long-short" swing.',
    },
    {
      label: 'Tie',
      text: full + '-|' + full,
      hint: 'Holds one note across the barline instead of playing it again.',
    },
    {
      label: 'Repeat section',
      text: '|: ' + inner + ' :|',
      hint: 'Play everything between the marks twice.',
    },
    { label: 'Pickup bar', text: 'G |', hint: 'One or two notes before the first full bar.' },
  ]
}

// ------------------------------------------------------------ fingering

export const FINGERS: Snippet[] = [1, 2, 3, 4, 5].map((n) => ({
  label: String(n),
  text: '!' + n + '!',
  hint:
    n === 1
      ? 'Thumb. Put it immediately before the note it belongs to.'
      : 'Finger ' + n + '. Put it immediately before the note it belongs to.',
}))

// Simple mode: a friendly view over a canonical two-hand ABC document.
// The ABC text stays the single source of truth; this module converts
// between it and { settings + right hand + left hand } fields.

export interface SimpleFields {
  xNum: number
  title: string
  meter: string
  unit: string
  qPrefix: string // left side of Q: (e.g. "1/4"), preserved verbatim
  bpm: number
  key: string
  rh: string
  lh: string
}

export interface SimpleParse {
  compatible: boolean
  fields: SimpleFields
}

const DEFAULTS: SimpleFields = {
  xNum: 1,
  title: 'Untitled',
  meter: '4/4',
  unit: '1/4',
  qPrefix: '1/4',
  bpm: 100,
  key: 'C',
  rh: '',
  lh: '',
}

// A document qualifies for Simple mode ONLY when it is exactly the canonical
// shape this app writes: every canonical header present exactly once, in the
// header block (before the music), plus one [V:1] and one [V:2] music line.
// Anything else — missing or duplicate headers, mid-tune field changes,
// comments, lyrics, extra voices — opens in Advanced, so a Simple-mode edit
// can never silently rewrite or lose content. (Both matter: a duplicate T:
// is a legal subtitle, a K: between the music lines is a legal mid-tune key
// change, and a missing L: changes what note lengths mean — rebuilding any
// of those from single-slot fields would alter the piece.)
export function parseSimple(abc: string): SimpleParse {
  const fields: SimpleFields = { ...DEFAULTS }
  let compatible = true
  const seen = new Set<string>()
  let inMusic = false
  const mark = (k: string) => {
    if (seen.has(k) || inMusic) compatible = false
    seen.add(k)
  }

  for (const rawLine0 of abc.split('\n')) {
    const rawLine = rawLine0.replace(/\r$/, '')
    const line = rawLine.trim()
    if (line === '') continue

    let m: RegExpMatchArray | null
    if ((m = line.match(/^X:\s*(\d+)$/))) {
      mark('X')
      fields.xNum = parseInt(m[1], 10)
    } else if (/^%%score\s*\{\s*1\s*\|\s*2\s*\}$/.test(line)) {
      mark('score')
    } else if (/^V:1\s+clef=treble$/.test(line)) {
      mark('V1')
    } else if (/^V:2\s+clef=bass$/.test(line)) {
      mark('V2')
    } else if (/^V:[^\]]/.test(line)) {
      // any other voice declaration (wrong clef, third voice…)
      compatible = false
    } else if ((m = line.match(/^T:\s*(.*)$/))) {
      mark('T')
      fields.title = m[1]
    } else if ((m = line.match(/^M:\s*(\S+)$/))) {
      mark('M')
      fields.meter = m[1]
    } else if ((m = line.match(/^L:\s*(\S+)$/))) {
      mark('L')
      fields.unit = m[1]
    } else if ((m = line.match(/^Q:\s*([0-9/]+)\s*=\s*(\d+)$/))) {
      mark('Q')
      fields.qPrefix = m[1]
      fields.bpm = parseInt(m[2], 10)
    } else if ((m = line.match(/^K:\s*(\S+)$/))) {
      mark('K')
      fields.key = m[1]
    } else if ((m = rawLine.match(/^\[V:1\]\s?(.*)$/))) {
      // matched on the UNtrimmed line: trailing spaces the user is typing
      // must survive the round trip or the space key appears dead
      if (seen.has('rh')) compatible = false
      seen.add('rh')
      inMusic = true
      fields.rh = m[1]
    } else if ((m = rawLine.match(/^\[V:2\]\s?(.*)$/))) {
      if (seen.has('lh')) compatible = false
      seen.add('lh')
      inMusic = true
      fields.lh = m[1]
    } else {
      // comments, lyrics, unknown headers, plain music lines…
      compatible = false
    }
  }

  for (const req of ['X', 'T', 'M', 'L', 'Q', 'K', 'score', 'V1', 'V2', 'rh', 'lh']) {
    if (!seen.has(req)) compatible = false
  }
  return { compatible, fields }
}

// A hand value must stay a single line or the rebuilt doc stops being
// canonical (and the UI would bounce to Advanced mid-edit).
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ')

export function buildSimple(fields: SimpleFields): string {
  return [
    `X:${fields.xNum}`,
    `T:${oneLine(fields.title)}`,
    `M:${fields.meter}`,
    `L:${fields.unit}`,
    `Q:${fields.qPrefix}=${fields.bpm}`,
    '%%score { 1 | 2 }',
    `K:${fields.key}`,
    'V:1 clef=treble',
    'V:2 clef=bass',
    `[V:1] ${oneLine(fields.rh)}`,
    `[V:2] ${oneLine(fields.lh)}`,
    '',
  ].join('\n')
}

export const KEY_CHOICES = [
  { value: 'C', label: 'C major' },
  { value: 'G', label: 'G major (1 ♯)' },
  { value: 'D', label: 'D major (2 ♯)' },
  { value: 'A', label: 'A major (3 ♯)' },
  { value: 'F', label: 'F major (1 ♭)' },
  { value: 'Bb', label: 'B♭ major (2 ♭)' },
  { value: 'Eb', label: 'E♭ major (3 ♭)' },
  { value: 'Am', label: 'A minor' },
  { value: 'Em', label: 'E minor (1 ♯)' },
  { value: 'Dm', label: 'D minor (1 ♭)' },
]

export const METER_CHOICES = ['4/4', '3/4', '2/4', '6/8']

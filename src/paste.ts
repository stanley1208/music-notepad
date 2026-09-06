// Cleaning up ABC copied out of a chat window.
//
// What arrives is rarely just music: markdown fences, a sentence of lead-in,
// a numbered explanation underneath, curly quotes, and — the dangerous one — a
// blank line between the headers and the music, which makes abcjs silently
// truncate the tune to nothing with no warning at all.
//
// The rule here is the opposite of the checker's: never destroy music. When a
// line is ambiguous, keep it.

import abcjs from 'abcjs'
import { TEMPLATE_ABC } from './examples'

export interface CleanResult {
  abc: string
  changes: string[]
}

const NL = String.fromCharCode(10)
const NOTE_CHARS = /[A-Ga-gz]/
const PROSE_WORDS =
  /\b(here|here's|this|that|is|are|the|a|an|you|your|it|its|melody|tune|song|piece|hand|hands|left|right|play|plays|played|note|notes|bar|bars|measure|measures|feel|free|let|know|hope|helps|simple|above|below|would|like|can|will|use|uses|using|make|makes|sure|and|with|for|of|in|to)\b/i

// Header fields that carry human text, plus % comments. Their content may
// legitimately contain curly quotes and dashes, so the typographic checks must
// leave them alone: our own examples have titles with dashes in them.
const TEXT_LINE = /^([TCNWwRSOABDFGHZ]:|%)/

function isTextLine(line: string): boolean {
  return TEXT_LINE.test(line.trim())
}

function looksLikeHeader(line: string): boolean {
  return /^[A-Za-z]:/.test(line) || /^%%/.test(line)
}

function looksLikeProse(line: string): boolean {
  const t = line.trim()
  if (t === '') return false
  if (looksLikeHeader(t)) return false
  if (/^%/.test(t)) return false
  // An inline-voice line is the app's own canonical music line, and anything
  // carrying a barline is music. Deleting either would destroy the piece —
  // "|:" at a line end is a repeat opener, not a colon ending a sentence.
  if (/^\[V:/.test(t)) return false
  if (/\|/.test(t)) return false
  // markdown furniture
  if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s)/.test(t)) return true
  if (/\*\*|__/.test(t)) return true
  // a sentence: ends in . ! ? or : and contains ordinary words
  if (/[.!?:]$/.test(t) && PROSE_WORDS.test(t)) return true
  // lots of letters that are not part of the ABC alphabet
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 6) {
    const outside = letters.replace(/[A-Ga-gz]/g, '').length
    if (outside / letters.length > 0.45 && PROSE_WORDS.test(t)) return true
  }
  return false
}

function looksLikeMusic(line: string): boolean {
  const t = line.trim()
  if (t === '' || looksLikeHeader(t) || looksLikeProse(t)) return false
  return NOTE_CHARS.test(t) || t.includes('|')
}

/** Does this text need cleaning before it can be used? */
export function looksPasted(text: string): boolean {
  const lines = text.split(/\r?\n/)
  if (lines.some((l) => /^\s*(`{3,}|~{3,})/.test(l))) return true
  if (
    lines.some(
      (l) => !isTextLine(l) && /[\u2018\u2019\u201C\u201D\u2013\u2014\u00A0]/.test(l),
    )
  )
    return true
  if (lines.some((l) => looksLikeProse(l))) return true
  // more than one tune in the paste
  if (lines.filter((l) => /^\s*X:/.test(l)).length > 1) return true
  // a blank line between headers and music silently truncates the tune
  const xAt = lines.findIndex((l) => /^\s*X:/.test(l))
  if (xAt >= 0) {
    const rest = lines.slice(xAt)
    const lastContent = rest.reduce((acc, l, i) => (l.trim() !== '' ? i : acc), 0)
    if (rest.slice(0, lastContent).some((l) => l.trim() === '')) return true
  }
  return false
}

/** The unit note length (L:) as a fraction of a whole note. */
function unitLengthOf(header: string[], meterNum: number, meterDen: number): number {
  const m = header.find((l) => /^L:/.test(l))?.match(/^L:\s*(\d+)\s*\/\s*(\d+)/)
  if (m) {
    const n = parseInt(m[1], 10)
    const d = parseInt(m[2], 10)
    if (n > 0 && d > 0) return n / d
  }
  return meterNum / meterDen >= 0.75 ? 1 / 8 : 1 / 16
}

/** A rest of the given length, written in legal ABC (never a decimal). */
function restToken(wholeNotes: number, unit: number): string {
  const units = wholeNotes / unit
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

/**
 * A silent left hand that mirrors the melody bar for bar, so a pickup bar
 * stays a pickup instead of putting the two hands out of step.
 */
function matchingRests(header: string[], melody: string): string {
  try {
    const probe = abcjs.parseOnly([...header, `[V:1] ${melody}`].join(NL))[0]
    if (!probe) return 'z |]'
    const mf = (
      probe as unknown as { getMeterFraction?: () => { num?: number; den?: number } }
    ).getMeterFraction?.()
    const num = Number(mf?.num) > 0 ? Number(mf?.num) : 4
    const den = Number(mf?.den) > 0 ? Number(mf?.den) : 4
    const unit = unitLengthOf(header, num, den)

    const bars: Array<{ whole: number; span: number }> = []
    let acc = 0
    let items = 0
    let span = 1
    let trip = 1
    let tripLeft = 0
    const flush = () => {
      if (items > 0) bars.push({ whole: acc, span })
      acc = 0
      items = 0
      span = 1
      trip = 1
      tripLeft = 0
    }
    for (const line of (probe.lines ?? []) as Array<{ staff?: Array<{ voices: unknown[][] }> }>) {
      for (const staff of line.staff ?? []) {
        for (const raw of (staff.voices[0] ?? []) as unknown[]) {
          const el = raw as {
            el_type?: string
            duration?: number
            rest?: { type?: string; text?: number }
            startTriplet?: number
            tripletR?: number
            tripletMultiplier?: number
            endTriplet?: boolean
          }
          if (el.el_type === 'bar') {
            flush()
          } else if (el.el_type === 'note' && el.rest?.type !== 'spacer') {
            if (el.rest?.type === 'multimeasure' || el.rest?.type === 'invisible-multimeasure') {
              span = el.rest.text ?? 1
              acc = el.duration ?? 0
              items += 1
              continue
            }
            if (el.startTriplet) {
              trip = el.tripletMultiplier ?? 1
              tripLeft = el.tripletR ?? el.startTriplet
            }
            acc += (el.duration ?? 0) * (tripLeft > 0 ? trip : 1)
            items += 1
            if (tripLeft > 0) {
              tripLeft -= 1
              if (el.endTriplet || tripLeft === 0) {
                trip = 1
                tripLeft = 0
              }
            }
          }
        }
      }
    }
    flush()
    if (bars.length === 0) return 'z |]'
    return (
      bars
        .map((b) => (b.span > 1 ? `Z${b.span}` : restToken(b.whole, unit)))
        .join(' | ') + ' |]'
    )
  } catch {
    return 'z |]'
  }
}

/**
 * Turn pasted chat output into a document this app can use. Every change is
 * reported so nothing happens silently.
 */
export function cleanPastedAbc(input: string): CleanResult {
  const changes: string[] = []
  let text = input.replace(/\r\n?/g, NL)

  // 1. Keep what is inside markdown fences, when there are any. Every fenced
  //    block is kept, not just the first: a two-hand answer is often split.
  const lines0 = text.split(NL)
  const fenceIdx = lines0.map((l, i) => (/^\s*(`{3,}|~{3,})/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (fenceIdx.length >= 2) {
    const kept: string[] = []
    for (let i = 0; i + 1 < fenceIdx.length; i += 2) {
      kept.push(...lines0.slice(fenceIdx[i] + 1, fenceIdx[i + 1]))
    }
    // an unpaired trailing fence: keep what follows it too
    if (fenceIdx.length % 2 === 1) kept.push(...lines0.slice(fenceIdx[fenceIdx.length - 1] + 1))
    text = kept.join(NL)
    changes.push('removed the ``` code fences and the text outside them')
  } else if (fenceIdx.length === 1) {
    // One fence is ambiguous: it may open the block (music below) or close it
    // (music above). Keep whichever side actually holds music.
    const above = lines0.slice(0, fenceIdx[0])
    const below = lines0.slice(fenceIdx[0] + 1)
    const score = (ls: string[]) => ls.filter((l) => looksLikeHeader(l) || looksLikeMusic(l)).length
    text = (score(below) >= score(above) ? below : above).join(NL)
    changes.push('removed a ``` code fence')
  }

  // 2. Dedent — a field is only a field when the letter is at the line start.
  //    Tabs are expanded first, or one tab would count as a single space.
  const detabbed = text.split(NL).map((l) => l.replace(/^[ \t]+/, (run) => run.replace(/\t/g, '    ')))
  const indents = detabbed.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)?.[0].length ?? 0)
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0
  if (minIndent > 0) {
    text = detabbed.map((l) => l.slice(minIndent)).join(NL)
    changes.push('removed the indentation in front of every line')
  } else {
    text = detabbed.join(NL)
  }

  // 3. Straighten typographic characters in music lines only — a curly quote
  //    becomes an "unknown character", and a curly apostrophe silently loses an
  //    octave. Titles keep their real punctuation.
  const before = text
  text = text
    .split(NL)
    .map((l) =>
      isTextLine(l)
        ? l
        : l
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u00A0/g, ' '),
    )
    .join(NL)
  if (text !== before) changes.push('replaced curly quotes and dashes with plain ones')

  // 4. Drop prose lines anywhere outside the music.
  let lines = text.split(NL)
  const proseCount = lines.filter((l) => looksLikeProse(l)).length
  if (proseCount > 0) {
    lines = lines.filter((l) => !looksLikeProse(l))
    changes.push(
      `removed ${proseCount} line${proseCount === 1 ? '' : 's'} of explanation around the music`,
    )
  }

  // 5. One tune per document. Two tunes pasted together must not be welded
  //    into one by the blank-line removal below.
  const xLines = lines.map((l, i) => (/^\s*X:/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (xLines.length > 1) {
    lines = lines.slice(0, xLines[1])
    changes.push(`kept the first of ${xLines.length} tunes in the paste`)
  }

  // 6. Drop blank lines inside the tune. abcjs cuts a tune at the first blank
  //    line and reports nothing, so this is the difference between a score and
  //    a mysteriously empty page.
  const firstContent = lines.findIndex((l) => l.trim() !== '')
  const lastContent = lines.reduce((acc, l, i) => (l.trim() !== '' ? i : acc), -1)
  if (firstContent >= 0) {
    const inner = lines.slice(firstContent, lastContent + 1)
    const blanks = inner.filter((l) => l.trim() === '').length
    lines = inner.filter((l) => l.trim() !== '')
    if (blanks > 0) {
      changes.push(
        `removed ${blanks} blank line${blanks === 1 ? '' : 's'} inside the music, which would have cut the tune short`,
      )
    }
  }

  // Nothing survived: the paste was prose, an empty fence, or nothing at all.
  // Hand back the starter document rather than a header-only husk.
  if (!lines.some((l) => looksLikeMusic(l))) {
    return { abc: TEMPLATE_ABC, changes: ['found no music in that text, so this is a fresh start'] }
  }

  // 7. Headers. Anything missing is filled in.
  const has = (re: RegExp) => lines.some((l) => re.test(l))
  if (!has(/^X:/)) {
    lines.unshift('X:1')
    changes.push('added the missing X:1 line every tune needs')
  }
  if (!has(/^T:/)) {
    const at = lines.findIndex((l) => /^X:/.test(l))
    lines.splice(at + 1, 0, 'T:Pasted tune')
    changes.push('added a title')
  }
  if (!has(/^M:/)) {
    const at = lines.findIndex((l) => /^T:/.test(l))
    lines.splice(at + 1, 0, 'M:4/4')
    changes.push('added the missing time signature M:4/4')
  }
  if (!has(/^L:/)) {
    const at = lines.findIndex((l) => /^M:/.test(l))
    lines.splice(at + 1, 0, 'L:1/4')
    changes.push('added the missing note length L:1/4')
  }
  if (!has(/^Q:/)) {
    const at = lines.findIndex((l) => /^L:/.test(l))
    lines.splice(at + 1, 0, 'Q:1/4=100')
    changes.push('added a tempo')
  }
  if (!has(/^K:/)) {
    // K: closes the header block, just before the music
    const lastHeader = lines.reduce((acc, l, i) => (looksLikeHeader(l) ? i : acc), 0)
    lines.splice(lastHeader + 1, 0, 'K:C')
    changes.push('added the missing key K:C')
  }

  // 8. Voices. Music written on bare lines under "V:1" (what chatbots write)
  //    becomes the inline "[V:1] ..." form this app uses.
  const voiceDecls = lines.filter((l) => /^V:\s*\S/.test(l))
  const inlineVoices = lines.filter((l) => /^\[V:\d\]/.test(l))

  if (inlineVoices.length === 0 && voiceDecls.length >= 2) {
    const out: string[] = []
    let currentVoice: string | null = null
    for (const l of lines) {
      const decl = l.match(/^V:\s*(\S+)(.*)$/)
      if (decl) {
        currentVoice = decl[1]
        // a bare "V:1" is a switch, not a declaration: inlining its music makes
        // it redundant, and leaving it behind breaks the canonical shape
        if (decl[2].trim() !== '') out.push(l)
        continue
      }
      if (!looksLikeHeader(l) && looksLikeMusic(l) && currentVoice) {
        out.push(`[V:${currentVoice}] ${l.trim()}`)
      } else {
        out.push(l)
      }
    }
    lines = out
    changes.push('moved each hand’s music onto a line starting with [V:1] or [V:2]')
  } else if (inlineVoices.length === 0 && voiceDecls.length === 0) {
    // A single melody with no voices: make it the right hand and give the left
    // hand matching silent bars, so it opens as a two-hand piano document.
    const kAt = lines.reduce((acc, l, i) => (/^K:/.test(l) ? i : acc), 0)
    const header = lines.slice(0, kAt + 1).filter((l) => looksLikeHeader(l))
    // headers written after the music still belong in the header block
    const trailingHeaders = lines.slice(kAt + 1).filter((l) => looksLikeHeader(l))
    const melody = lines
      .slice(kAt + 1)
      .filter((l) => !looksLikeHeader(l) && l.trim() !== '')
      .map((l) => l.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
    if (melody !== '') {
      const fullHeader = [...header, ...trailingHeaders]
      lines = [...fullHeader, `[V:1] ${melody}`, `[V:2] ${matchingRests(fullHeader, melody)}`]
      changes.push('put the melody in the right hand and added a left hand of silent bars')
    }
  }

  // 9. Name the two hands, if the music references voices but nothing declares
  //    them — and only for a genuine two-hand document.
  const voiceIds = new Set<string>()
  for (const l of lines) {
    const m = l.match(/^\[V:\s*([^\]\s]+)\s*\]/) ?? l.match(/^V:\s*(\S+)/)
    if (m) voiceIds.add(m[1])
  }
  const isTwoHand = voiceIds.size > 0 && [...voiceIds].every((v) => v === '1' || v === '2')

  if (isTwoHand && lines.some((l) => /^\[V:\d\]/.test(l))) {
    const kAt = lines.findIndex((l) => /^K:/.test(l))
    const insertAt = kAt >= 0 ? kAt + 1 : lines.length
    const add: string[] = []
    if (!lines.some((l) => /^V:\s*1\s+/.test(l))) add.push('V:1 clef=treble')
    if (!lines.some((l) => /^V:\s*2\s+/.test(l))) add.push('V:2 clef=bass')
    if (add.length > 0) {
      lines.splice(insertAt, 0, ...add)
      changes.push('named the two hands: right hand on the treble staff, left hand on the bass')
    }
    if (!lines.some((l) => /^%%score/.test(l))) {
      const kIdx = lines.findIndex((l) => /^K:/.test(l))
      lines.splice(Math.max(0, kIdx), 0, '%%score { 1 | 2 }')
      changes.push('braced the two hands together into one piano system')
    }
  }

  const abc = lines.join(NL).trim() + NL
  if (changes.length === 0) changes.push('nothing needed changing')
  return { abc, changes }
}

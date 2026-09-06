// Sending an exercise to a student, with no server and no accounts: the whole
// document travels inside the link.
//
// The payload is deflated and base64url-encoded into the URL fragment. The
// fragment never reaches a server even if one existed, and deflate matters for
// more than politeness — an uncompressed virtuoso piece is too long to fit in a
// QR code, and a compressed one fits.
//
// Everything decoded here is UNTRUSTED: anyone can hand a teacher or a student
// a link. So the decoder is bounded and the music is sanitised before any
// parser sees it.

const MARKER_RAW = 'r'
const MARKER_DEFLATE = 'd'

// Real exercises are 100-300 characters; the largest bundled document is ~1 KB.
// These caps exist only to stop a hostile link, so they are far above any
// legitimate piece.
const MAX_FRAGMENT_CHARS = 32 * 1024
const MAX_DECODED_BYTES = 512 * 1024

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('decoded payload too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * abcjs reads some %%begin directives by consuming lines until a matching
 * %%end, and an unmatched one spins forever — a link that hangs the browser.
 * None of them mean anything for a piano exercise, so untrusted music loses
 * the whole block.
 */
function sanitizeAbc(abc: string): string {
  const lines = abc.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*%%begin/i.test(lines[i])) {
      out.push(lines[i])
      continue
    }
    // A properly closed block is genuinely not music, so drop the whole thing.
    // An unclosed one is what hangs the parser: drop only the opening line, so
    // whatever follows — which is usually the music — survives.
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*%%end/i.test(lines[j])) {
        end = j
        break
      }
    }
    if (end !== -1) i = end
  }
  return out.join('\n')
}

/** The document packed into a URL fragment. */
export async function encodeShare(abc: string, title: string): Promise<string> {
  const payload = JSON.stringify({ t: title, a: abc })
  const bytes = new TextEncoder().encode(payload)
  try {
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate-raw')
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs)
      const packed = await collect(stream as ReadableStream<Uint8Array>)
      if (packed.length < bytes.length) return MARKER_DEFLATE + toBase64Url(packed)
    }
  } catch {
    // fall through to the uncompressed form
  }
  return MARKER_RAW + toBase64Url(bytes)
}

export interface SharedDoc {
  title: string
  abc: string
}

/** Unpack a fragment produced by encodeShare. Returns null if it is not one. */
export async function decodeShare(fragment: string): Promise<SharedDoc | null> {
  if (!fragment || fragment.length < 2) return null
  if (fragment.length > MAX_FRAGMENT_CHARS) return null
  const marker = fragment[0]
  const body = fragment.slice(1)
  if (marker !== MARKER_RAW && marker !== MARKER_DEFLATE) return null
  try {
    let bytes = fromBase64Url(body)
    if (bytes.length > MAX_DECODED_BYTES) return null
    if (marker === MARKER_DEFLATE) {
      if (typeof DecompressionStream === 'undefined') return null
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds)
      bytes = await collect(stream as ReadableStream<Uint8Array>, MAX_DECODED_BYTES)
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { t?: unknown; a?: unknown }
    if (typeof parsed.a !== 'string' || parsed.a.trim() === '') return null
    return {
      title: typeof parsed.t === 'string' && parsed.t.trim() !== '' ? parsed.t : 'Shared exercise',
      // Carriage returns are stripped here, once, because abcjs strips them
      // before it assigns character positions — annotating the un-stripped
      // text would drift every label.
      abc: sanitizeAbc(parsed.a),
    }
  } catch {
    return null
  }
}

/** The full link for a document, based on where the app is being served from. */
export async function shareLink(abc: string, title: string): Promise<string> {
  const base = window.location.origin + window.location.pathname
  return `${base}#play=${await encodeShare(abc, title)}`
}

/** The share payload in the current address, if there is one. */
export function currentShareFragment(): string | null {
  const m = window.location.hash.match(/^#play=(.+)$/)
  return m ? m[1] : null
}

// ------------------------------------------------------------ note helpers

/**
 * The same music with each note labelled underneath. Annotations are inserted
 * by character position, which the parser reports exactly, so nothing has to be
 * guessed from the text.
 */
export function withNoteNames(
  abc: string,
  parsedNotes: Array<{ startChar: number; label: string }>,
): string {
  const sorted = [...parsedNotes].sort((a, b) => b.startChar - a.startChar)
  // abcjs normalises line endings before assigning character positions, so the
  // offsets index the CR-less text. Insert into that same text.
  let out = abc.replace(/\r\n?/g, '\n')
  for (const n of sorted) {
    if (n.startChar < 0 || n.startChar > out.length) continue
    out = out.slice(0, n.startChar) + `"_${n.label}"` + out.slice(n.startChar)
  }
  return out
}

const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * A readable name for a note. The written spelling gives the letter; the
 * sounding pitch, when known, gives the accidental — so a piece in D major
 * labels its F as "F#" the way it actually sounds, rather than the way it
 * happens to be spelled.
 */
export function readableNoteName(abcName: string, midiPitch?: number): string {
  const m = abcName.match(/^([_^=]*)([A-Ga-g])/)
  if (!m) return ''
  const letter = m[2].toUpperCase()
  if (typeof midiPitch === 'number' && Number.isFinite(midiPitch)) {
    let offset = (((midiPitch - LETTER_SEMITONE[letter]) % 12) + 12) % 12
    if (offset > 6) offset -= 12
    if (offset >= -2 && offset <= 2) {
      return letter + (offset > 0 ? '#'.repeat(offset) : 'b'.repeat(-offset))
    }
  }
  const sharps = (m[1].match(/\^/g) ?? []).length
  const flats = (m[1].match(/_/g) ?? []).length
  return letter + '#'.repeat(sharps) + 'b'.repeat(flats)
}

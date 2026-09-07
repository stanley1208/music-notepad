// Undo and redo for the document text.
//
// This exists because the app rewrites the editor boxes from React state.
// Every kit button, every settings control and every snippet replaces the
// whole document, which destroys the browser's own undo stack — so a person
// who clicks a button ten times has no way back. One history for the whole
// document covers typing and buttons alike, which is also the only model that
// works on a phone, where there is no Ctrl+Z at all.

/** Far more steps than anyone undoes, and still a bounded amount of memory. */
const LIMIT = 200

/** Consecutive keystrokes closer together than this collapse into one step. */
export const TYPING_RUN_MS = 700

/**
 * …but only up to a point. Without this, a run never closes while someone
 * keeps typing, and one Ctrl+Z wipes out a whole phrase typed without a pause.
 */
export const MAX_RUN_CHARS = 40

/**
 * Where a change came from. Typing runs together only when the SOURCE matches:
 * moving from the right-hand box to the left is a new step, or one Ctrl+Z
 * would take back notes in a hand the person had already finished with.
 */
export type EditSource = 'action' | 'type:main' | 'type:rh' | 'type:lh'

export interface History {
  past: string[]
  future: string[]
  /** what produced the newest entry, so a typing run can be extended */
  lastSource: EditSource | null
  lastAt: number
  /** characters changed so far in the open run */
  runChars: number
}

export function emptyHistory(): History {
  return { past: [], future: [], lastSource: null, lastAt: 0, runChars: 0 }
}

/**
 * Note that the document is changing from `previous` to `next`.
 *
 * Typing is collapsed into runs so that undo steps back a word rather than a
 * letter; anything else — a button, a pasted clean-up, a settings change — is
 * always its own step, because that is the thing a person means to take back.
 *
 * Mutates in place: this is called on every keystroke, and the caller holds it
 * in a ref rather than in state.
 */
export function record(
  h: History,
  previous: string,
  next: string,
  source: EditSource,
  now: number,
): void {
  const drift = Math.abs(next.length - previous.length) || 1
  const continuesRun =
    source !== 'action' &&
    source === h.lastSource &&
    now - h.lastAt < TYPING_RUN_MS &&
    h.runChars + drift <= MAX_RUN_CHARS &&
    !crossesWordBoundary(previous, next)

  if (continuesRun) {
    h.runChars += drift
    // still inside one run, but it is no longer redoable past this point
    h.future = []
  } else {
    // A change that lands back on the state already at the top of the stack
    // would cost a step that appears to do nothing. What matters is the text,
    // never what produced it.
    if (h.past.length > 0 && h.past[h.past.length - 1] === previous) {
      h.future = []
    } else {
      h.past.push(previous)
      if (h.past.length > LIMIT) h.past.shift()
      h.future = []
    }
    h.runChars = drift
  }
  h.lastSource = source
  h.lastAt = now
}

/**
 * Whether the edit from `previous` to `next` involves a space or a newline.
 *
 * This is what makes undo step back a word rather than a whole phrase: in
 * music that means one note or one bar, since a space separates notes and a
 * barline is typed with spaces around it. Without it, a run only ends at a
 * pause, so someone typing steadily loses everything since they last stopped.
 */
function crossesWordBoundary(previous: string, next: string): boolean {
  let head = 0
  const shortest = Math.min(previous.length, next.length)
  while (head < shortest && previous[head] === next[head]) head++
  let tail = 0
  while (
    tail < shortest - head &&
    previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++
  }
  const removed = previous.slice(head, previous.length - tail)
  const added = next.slice(head, next.length - tail)
  return /\s/.test(removed) || /\s/.test(added)
}

/**
 * An open typing run can end up back at its own starting text — typing a
 * character and deleting it is the most ordinary correction there is — which
 * leaves an entry identical to what is on screen. Stepping onto it would look
 * like a dead key press, so those are discarded rather than visited.
 */
function popMeaningful(stack: string[], current: string): string | null {
  while (stack.length > 0) {
    const candidate = stack.pop() as string
    if (candidate !== current) return candidate
  }
  return null
}

/** Whether undo would visibly change anything. */
export function canUndo(h: History, current: string): boolean {
  return h.past.some((t) => t !== current)
}

/** Whether redo would visibly change anything. */
export function canRedo(h: History, current: string): boolean {
  return h.future.some((t) => t !== current)
}

/** The text to move to, or null when there is nothing to undo. */
export function undo(h: History, current: string): string | null {
  const previous = popMeaningful(h.past, current)
  if (previous === null) return null
  h.future.push(current)
  closeRun(h)
  return previous
}

/** The text to move to, or null when there is nothing to redo. */
export function redo(h: History, current: string): string | null {
  const next = popMeaningful(h.future, current)
  if (next === null) return null
  h.past.push(current)
  if (h.past.length > LIMIT) h.past.shift()
  closeRun(h)
  return next
}

/** After a jump, the next keystroke starts a fresh step. */
function closeRun(h: History): void {
  h.lastSource = null
  h.lastAt = 0
  h.runChars = 0
}

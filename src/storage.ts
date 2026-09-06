import { SEED_DOCS, TUTORIAL_ABC } from './examples'

export interface Doc {
  id: string
  title: string
  abc: string
  updatedAt: number
}

const DOCS_KEY = 'music-notepad.docs'
const CURRENT_KEY = 'music-notepad.currentId'
const TUTORIAL_ADDED_KEY = 'music-notepad.tutorialAdded'

function makeId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadDocs(): Doc[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    if (raw) {
      const docs = JSON.parse(raw) as Doc[]
      if (Array.isArray(docs) && docs.length > 0) {
        // One-time migration: visitors from before the tutorial existed get it
        // prepended once (deleting it afterwards must not resurrect it).
        if (!localStorage.getItem(TUTORIAL_ADDED_KEY)) {
          localStorage.setItem(TUTORIAL_ADDED_KEY, '1')
          const migrated = [newDoc(TUTORIAL_ABC, 'Start Here'), ...docs]
          saveDocs(migrated)
          return migrated
        }
        return docs
      }
    }
  } catch {
    // corrupted storage: fall through and reseed
  }
  const seeded = SEED_DOCS.map((d, i) => ({
    id: makeId() + '-' + i,
    title: d.title,
    abc: d.abc,
    updatedAt: Date.now(),
  }))
  try {
    localStorage.setItem(TUTORIAL_ADDED_KEY, '1')
  } catch {
    // ignore
  }
  saveDocs(seeded)
  return seeded
}

export function saveDocs(docs: Doc[]): boolean {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
    return true
  } catch {
    // storage full or unavailable — nothing sensible to do in-app
    return false
  }
}

/**
 * Write these documents without dropping any that appeared in storage since
 * they were read — a practice page in another tab can add one, and a whole
 * array write from the editor would otherwise delete it.
 */
export function saveDocsMerging(docs: Doc[]): boolean {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    const stored = raw ? (JSON.parse(raw) as Doc[]) : []
    const known = new Set(docs.map((d) => d.id))
    const appended = Array.isArray(stored) ? stored.filter((d) => d?.id && !known.has(d.id)) : []
    return saveDocs([...docs, ...appended])
  } catch {
    return saveDocs(docs)
  }
}

export function loadCurrentId(docs: Doc[]): string {
  const saved = localStorage.getItem(CURRENT_KEY)
  if (saved && docs.some((d) => d.id === saved)) return saved
  return docs[0].id
}

export function saveCurrentId(id: string): void {
  try {
    localStorage.setItem(CURRENT_KEY, id)
  } catch {
    // ignore
  }
}

export function newDoc(abc: string, title = 'Untitled'): Doc {
  return { id: makeId(), title, abc, updatedAt: Date.now() }
}

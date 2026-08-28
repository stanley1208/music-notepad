import { SEED_DOCS } from './examples'

export interface Doc {
  id: string
  title: string
  abc: string
  updatedAt: number
}

const DOCS_KEY = 'music-notepad.docs'
const CURRENT_KEY = 'music-notepad.currentId'

function makeId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadDocs(): Doc[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    if (raw) {
      const docs = JSON.parse(raw) as Doc[]
      if (Array.isArray(docs) && docs.length > 0) return docs
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
  saveDocs(seeded)
  return seeded
}

export function saveDocs(docs: Doc[]): void {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
  } catch {
    // storage full or unavailable — nothing sensible to do in-app
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

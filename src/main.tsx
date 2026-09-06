import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PracticeView from './PracticeView.tsx'
import { currentShareFragment, decodeShare, type SharedDoc } from './share'
import { loadDocs, newDoc, saveCurrentId, saveDocsMerging } from './storage'

/**
 * A link with an exercise in it opens the practice page; anything else opens
 * the editor. Deciding here keeps the two from mounting at once, so their
 * players can never fight over the audio.
 */
function Root() {
  const [shared, setShared] = useState<SharedDoc | null>(null)
  const [checked, setChecked] = useState(false)
  const [saved, setSaved] = useState(false)
  // A link that carries a payload we cannot read is worth saying out loud,
  // rather than silently dropping the student into the editor.
  const [brokenLink, setBrokenLink] = useState(false)

  useEffect(() => {
    let alive = true
    const read = async () => {
      const fragment = currentShareFragment()
      if (!fragment) {
        if (alive) {
          setShared(null)
          setBrokenLink(false)
          setChecked(true)
        }
        return
      }
      const doc = await decodeShare(fragment)
      if (!alive) return
      setShared(doc)
      setBrokenLink(doc === null)
      setSaved(false)
      setChecked(true)
    }
    read()
    window.addEventListener('hashchange', read)
    return () => {
      alive = false
      window.removeEventListener('hashchange', read)
    }
  }, [])

  const saveCopy = useCallback(() => {
    if (!shared) return
    try {
      const docs = loadDocs()
      const copy = newDoc(shared.abc, shared.title)
      if (!saveDocsMerging([...docs, copy])) return
      saveCurrentId(copy.id)
      setSaved(true)
    } catch {
      // storage unavailable: the link still works, nothing is lost
    }
  }, [shared])

  const openEditor = useCallback(() => {
    // replaceState leaves the address clean without reloading the page, which
    // assigning to location.hash would do
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setShared(null)
    setBrokenLink(false)
  }, [])

  // Nothing is rendered until the address has been read, so the editor never
  // flashes up in front of a student following a link.
  if (!checked) return null
  if (brokenLink) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 p-6 text-stone-800">
        <div className="max-w-sm rounded-lg bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-base font-semibold">This link is damaged</h1>
          <p className="mb-4 text-sm text-stone-600">
            The music could not be read from it. Links can get cut short when they are pasted, so
            ask whoever sent it to send the whole link again.
          </p>
          <button
            type="button"
            onClick={openEditor}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            Open Music Notepad
          </button>
        </div>
      </div>
    )
  }
  if (shared) {
    return (
      <PracticeView
        title={shared.title}
        abc={shared.abc}
        saved={saved}
        onSaveCopy={saveCopy}
        onOpenEditor={openEditor}
      />
    )
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

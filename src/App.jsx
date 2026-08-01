import { useState, useEffect, useCallback } from 'react'
import Gallery from './components/Gallery'
import Modal from './components/Modal'
import './App.css'

export default function App() {
  const [entries, setEntries] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // { entry, idx }
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('images-manifest.json')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load manifest')
        return r.json()
      })
      .then(setEntries)
      .catch(e => setError(e.message))
  }, [])

  // Back button (especially on mobile) closes the viewer instead of leaving the site
  useEffect(() => {
    const onPop = () => setModal(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openModal = useCallback((entry) => {
    setModal({ entry, idx: 0 })
    window.history.pushState({ modal: true }, '')
  }, [])

  const closeModal = useCallback(() => {
    if (window.history.state?.modal) window.history.back()
    else setModal(null)
  }, [])

  const navigate = useCallback((dir) => {
    setModal(prev => {
      if (!prev) return null
      const files = prev.entry.files || [prev.entry.first]
      const idx = (prev.idx + dir + files.length) % files.length
      return { ...prev, idx }
    })
  }, [])

  const setIdx = useCallback((idx) => {
    setModal(prev => prev ? { ...prev, idx } : null)
  }, [])

  if (error) return <div className="container"><p>Error loading images</p></div>

  const filtered = entries?.filter(e =>
    e.dir.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div className="container">
      <div className="header">
        <h1>Stuff I made out of Wood</h1>
        <input
          className="search"
          type="search"
          placeholder="Search projects…"
          aria-label="Search projects"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      {entries === null ? (
        <div className="grid" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="no-results">No projects match “{query.trim()}”</p>
      ) : (
        <Gallery entries={filtered} onOpen={openModal} />
      )}
      {modal && (
        <Modal
          entry={modal.entry}
          idx={modal.idx}
          onClose={closeModal}
          onNavigate={navigate}
          onSetIdx={setIdx}
        />
      )}
    </div>
  )
}

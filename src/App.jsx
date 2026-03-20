import { useState, useEffect, useCallback } from 'react'
import Gallery from './components/Gallery'
import Modal from './components/Modal'
import './App.css'

export default function App() {
  const [entries, setEntries] = useState([])
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // { entry, idx }

  useEffect(() => {
    fetch('images-manifest.json')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load manifest')
        return r.json()
      })
      .then(setEntries)
      .catch(e => setError(e.message))
  }, [])

  const openModal = useCallback((entry) => {
    setModal({ entry, idx: 0 })
  }, [])

  const closeModal = useCallback(() => {
    setModal(null)
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

  return (
    <div className="container">
      <h1>Stuff I made out of Wood</h1>
      <Gallery entries={entries} onOpen={openModal} />
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

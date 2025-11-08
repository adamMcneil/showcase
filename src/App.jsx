import React, { useState } from 'react'
import imageIndex from './imageIndex.json'

function GalleryCard({ entry, onOpen }) {
  return (
    <button className="card" onClick={() => onOpen(entry)} aria-label={`Open ${entry.dir}`}>
      <div className="thumb">
        <img src={entry.first} alt={entry.dir} />
      </div>
      <div className="title">{entry.dir}</div>
    </button>
  )
}

function Modal({ entry, startIndex = 0, onClose }) {
  const [idx, setIdx] = useState(startIndex)
  if (!entry) return null
  const files = entry.files || [entry.first]

  function prev() {
    setIdx((i) => (i - 1 + files.length) % files.length)
  }
  function next() {
    setIdx((i) => (i + 1) % files.length)
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content">
        <header className="modal-header">
          <h3>{entry.dir}</h3>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">
          <button className="nav left" onClick={prev} aria-label="Previous">◀</button>
          <div className="modal-image">
            <img src={files[idx]} alt={`${entry.dir} ${idx + 1}`} />
          </div>
          <button className="nav right" onClick={next} aria-label="Next">▶</button>
        </div>
        <div className="thumb-row">
          {files.map((f, i) => (
            <button key={f} className={`thumb-item ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>
              <img src={f} alt={`thumb-${i}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [openEntry, setOpenEntry] = useState(null)

  return (
    <div className="container">
      <h1>Stuff I made out of Wood</h1>
      <div className="grid">
        {imageIndex.map((e) => (
          <GalleryCard key={e.dir} entry={e} onOpen={(entry) => setOpenEntry(entry)} />
        ))}
      </div>

      {openEntry && (
        <Modal entry={openEntry} onClose={() => setOpenEntry(null)} />
      )}
    </div>
  )
}

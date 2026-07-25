import { useEffect, useRef, useState } from 'react'
import { sized, full } from '../lib/cloudinary'
import './Modal.css'

export default function Modal({ entry, idx, onClose, onNavigate, onSetIdx }) {
  const files = entry.files || [entry.first]
  const touchStartX = useRef(null)
  const hiRef = useRef(null)
  const activeThumbRef = useRef(null)
  const [loaded, setLoaded] = useState(false)

  const hiSrc = full(files[idx])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowLeft') onNavigate(-1)
      if (e.key === 'ArrowRight') onNavigate(1)
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onNavigate, onClose])

  // Lock page scroll while the viewer is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Detect cached images that load before onLoad can fire
  useEffect(() => {
    setLoaded(false)
    const img = hiRef.current
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true)
  }, [hiSrc])

  // Preload neighbours so next/prev feels instant
  useEffect(() => {
    if (files.length < 2) return
    for (const offset of [1, -1]) {
      const img = new Image()
      img.src = full(files[(idx + offset + files.length) % files.length])
    }
  }, [idx, files])

  // Keep the active filmstrip thumb visible
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [idx])

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e) {
    if (touchStartX.current == null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) onNavigate(diff > 0 ? 1 : -1)
    touchStartX.current = null
  }

  function closeOnBackdrop(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={entry.dir}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={closeOnBackdrop}
    >
      <div className="modal-top">
        <span className="modal-title">{entry.dir}</span>
        {files.length > 1 && <span className="counter">{idx + 1} / {files.length}</span>}
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="modal-image-wrap" onClick={closeOnBackdrop}>
        {files.length > 1 && (
          <button className="nav left" onClick={() => onNavigate(-1)} aria-label="Previous">‹</button>
        )}
        {/* Low-res placeholder (usually cached from the grid) shows instantly */}
        {!loaded && (
          <img className="modal-img low" src={sized(files[idx], 600)} alt="" aria-hidden="true" />
        )}
        <img
          key={hiSrc}
          ref={hiRef}
          className={`modal-img hi${loaded ? ' loaded' : ''}`}
          src={hiSrc}
          alt={`${entry.dir} ${idx + 1}`}
          onLoad={() => setLoaded(true)}
        />
        {files.length > 1 && (
          <button className="nav right" onClick={() => onNavigate(1)} aria-label="Next">›</button>
        )}
      </div>

      {files.length > 1 && (
        <div className="thumb-row">
          {files.map((f, i) => (
            <button
              key={i}
              ref={i === idx ? activeThumbRef : null}
              className={`thumb-item${i === idx ? ' active' : ''}`}
              onClick={() => onSetIdx(i)}
              aria-label={`Photo ${i + 1}`}
            >
              <img src={sized(f, 200)} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

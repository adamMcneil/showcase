import { useEffect, useRef } from 'react'
import './Modal.css'

export default function Modal({ entry, idx, onClose, onNavigate, onSetIdx }) {
  const files = entry.files || [entry.first]
  const touchStartX = useRef(null)

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowLeft') onNavigate(-1)
      if (e.key === 'ArrowRight') onNavigate(1)
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onNavigate, onClose])

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e) {
    if (touchStartX.current == null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) onNavigate(diff > 0 ? 1 : -1)
    touchStartX.current = null
  }

  return (
    <div className="modal" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="modal-top">
        <span className="modal-title">{entry.dir}</span>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="modal-image-wrap">
        <button className="nav left" onClick={() => onNavigate(-1)} aria-label="Previous">‹</button>
        <img className="modal-img" src={files[idx]} alt={`${entry.dir} ${idx + 1}`} />
        <button className="nav right" onClick={() => onNavigate(1)} aria-label="Next">›</button>
      </div>

      {files.length > 1 && (
        <div className="thumb-row">
          {files.map((f, i) => (
            <button
              key={i}
              className={`thumb-item${i === idx ? ' active' : ''}`}
              onClick={() => onSetIdx(i)}
            >
              <img src={f} alt={`thumb-${i}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

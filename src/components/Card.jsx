import { useRef } from 'react'
import { sized, full } from '../lib/cloudinary'
import './Card.css'

export default function Card({ entry, onOpen }) {
  const preloaded = useRef(false)
  const count = entry.files?.length ?? 1

  // Warm the cache for the full-size image as soon as the user shows intent.
  function preload() {
    if (preloaded.current) return
    preloaded.current = true
    const img = new Image()
    img.src = full(entry.first)
  }

  return (
    <button
      className="card"
      aria-label={`Open ${entry.dir}`}
      onClick={() => onOpen(entry)}
      onMouseEnter={preload}
      onFocus={preload}
    >
      <div className="thumb">
        <img
          src={sized(entry.thumb ?? entry.first, 600)}
          srcSet={[300, 600, 900].map(w => `${sized(entry.thumb ?? entry.first, w)} ${w}w`).join(', ')}
          sizes="(max-width: 600px) 50vw, 220px"
          alt={entry.dir}
          loading="lazy"
          decoding="async"
        />
        {count > 1 && (
          <span className="count" aria-label={`${count} photos`}>
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
              <rect x="1" y="4" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4.5 1.5h8A2 2 0 0 1 14.5 3.5v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {count}
          </span>
        )}
      </div>
      <div className="title">{entry.dir}</div>
    </button>
  )
}

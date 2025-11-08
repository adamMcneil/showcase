import React from 'react'
import imageIndex from './imageIndex.json'

function GalleryCard({ entry }) {
  return (
    <div className="card">
      <div className="thumb">
        <img src={entry.first} alt={entry.dir} />
      </div>
      <div className="title">{entry.dir}</div>
    </div>
  )
}

export default function App() {
  return (
    <div className="container">
      <h1>Showcase Gallery</h1>
      <p className="subtitle">First photo from each folder — click to open</p>
      <div className="grid">
        {imageIndex.map((e) => (
          <a key={e.dir} className="link" href={e.first} target="_blank" rel="noreferrer">
            <GalleryCard entry={e} />
          </a>
        ))}
      </div>
    </div>
  )
}

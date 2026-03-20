import './Card.css'

export default function Card({ entry, onOpen }) {
  return (
    <button
      className="card"
      aria-label={`Open ${entry.dir}`}
      onClick={() => onOpen(entry)}
    >
      <div className="thumb">
        <img src={entry.thumb ?? entry.first} alt={entry.dir} loading="lazy" decoding="async" />
      </div>
      <div className="title">{entry.dir}</div>
    </button>
  )
}

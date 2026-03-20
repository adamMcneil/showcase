import Card from './Card'
import './Gallery.css'

export default function Gallery({ entries, onOpen }) {
  return (
    <div className="grid">
      {entries.map(entry => (
        <Card key={entry.dir} entry={entry} onOpen={onOpen} />
      ))}
    </div>
  )
}

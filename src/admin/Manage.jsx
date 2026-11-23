import { useEffect, useState } from 'react'
import { sized } from '../lib/cloudinary'
import { shownCount, toProjects } from './projects'
import { deletePhotos, listProjects, publish, setHidden } from './uploader'

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function summary(project) {
  const total = plural(project.photos.length, 'photo')
  if (project.hidden) return `Hidden · ${total}`
  const hidden = project.photos.filter(p => p.hidden).length
  if (hidden === 0) return total
  if (hidden === project.photos.length) return `${total}, all hidden`
  return `${total} · ${hidden} hidden`
}

// Drops deleted photos, and projects left with none.
function withoutPhotos(projects, assetFolder, ids) {
  const gone = new Set(ids)
  return projects
    .map(p => (p.assetFolder === assetFolder ? { ...p, photos: p.photos.filter(ph => !gone.has(ph.publicId)) } : p))
    .filter(p => p.photos.length > 0)
}

export default function Manage({ token, onError, clearError }) {
  const [projects, setProjects] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [openFolder, setOpenFolder] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(null) // what's being done, while a change runs
  const [notice, setNotice] = useState(null)
  const [needsPublish, setNeedsPublish] = useState(false)

  useEffect(() => {
    if (projects || loadFailed) return
    let cancelled = false
    listProjects(token)
      .then(r => !cancelled && setProjects(toProjects(r.projects)))
      .catch(e => {
        if (cancelled) return
        setLoadFailed(true)
        onError(e)
      })
    return () => {
      cancelled = true
    }
  }, [token, projects, loadFailed]) // eslint-disable-line react-hooks/exhaustive-deps

  const project = projects?.find(p => p.assetFolder === openFolder) ?? null

  function open(assetFolder) {
    clearError()
    setNotice(null)
    setSelected(new Set())
    setOpenFolder(assetFolder)
    window.scrollTo(0, 0)
  }

  function retryLoad() {
    clearError()
    setLoadFailed(false)
  }

  async function updateSite() {
    setBusy('Starting the site update…')
    try {
      await publish(token)
      setNeedsPublish(false)
      return true
    } catch (e) {
      setNeedsPublish(true)
      onError(e)
      return false
    } finally {
      setBusy(null)
    }
  }

  // Makes one change in Cloudinary, shows it here, then starts the site update.
  async function change(doing, run, apply, describe) {
    clearError()
    setNotice(null)
    setBusy(doing)
    let result
    try {
      result = await run()
    } catch (e) {
      setBusy(null)
      onError(e)
      return
    }
    setProjects(prev => apply(prev, result))
    setSelected(new Set())
    const done = describe(result)
    setNotice(done)
    if (await updateSite()) setNotice(`${done} The site is up to date.`)
  }

  function toggleProjectHidden() {
    const p = project
    const hide = !p.hidden
    change(
      hide ? 'Hiding the project…' : 'Showing the project…',
      () => setHidden(token, { assetFolder: p.assetFolder, project: true }, hide),
      prev => prev.map(x => (x.assetFolder === p.assetFolder ? { ...x, hidden: hide } : x)),
      () => (hide ? `Hid “${p.name}”.` : `“${p.name}” is back on the site.`)
    )
  }

  function deleteProject() {
    const p = project
    const photos = p.photos.length === 1 ? 'its photo' : `all ${p.photos.length} of its photos`
    const ok = window.confirm(
      `Delete “${p.name}” and ${photos} from Cloudinary?\n\n` +
        "This can't be undone. To take it off the site but keep it, use Hide project instead."
    )
    if (!ok) return
    change(
      'Deleting the project…',
      () => deletePhotos(token, { assetFolder: p.assetFolder, project: true }),
      (prev, r) => withoutPhotos(prev, p.assetFolder, r.deleted),
      r => `Deleted “${p.name}” (${plural(r.deleted.length, 'photo')}).`
    )
  }

  function setSelectedHidden(hide) {
    const p = project
    const ids = p.photos.filter(ph => selected.has(ph.publicId) && ph.hidden !== hide).map(ph => ph.publicId)
    const changed = new Set(ids)
    change(
      hide ? 'Hiding…' : 'Showing…',
      () => setHidden(token, { assetFolder: p.assetFolder, publicIds: ids }, hide),
      prev =>
        prev.map(x =>
          x.assetFolder === p.assetFolder
            ? { ...x, photos: x.photos.map(ph => (changed.has(ph.publicId) ? { ...ph, hidden: hide } : ph)) }
            : x
        ),
      () => `${hide ? 'Hid' : 'Showed'} ${plural(ids.length, 'photo')}.`
    )
  }

  function deleteSelected() {
    const p = project
    const ids = [...selected]
    const them = ids.length === 1 ? 'it' : 'them'
    const ok = window.confirm(
      `Delete ${plural(ids.length, 'photo')} from Cloudinary?\n\n` +
        `This can't be undone. To take ${them} off the site but keep ${them}, use Hide instead.`
    )
    if (!ok) return
    change(
      'Deleting…',
      () => deletePhotos(token, { assetFolder: p.assetFolder, publicIds: ids }),
      (prev, r) => withoutPhotos(prev, p.assetFolder, r.deleted),
      r => `Deleted ${plural(r.deleted.length, 'photo')}.`
    )
  }

  function toggle(publicId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(publicId)) next.delete(publicId)
      else next.add(publicId)
      return next
    })
  }

  const status = (busy || notice || needsPublish) && (
    <div className="manage-status">
      {busy ? (
        <p className="muted waiting" role="status">
          {busy}
        </p>
      ) : (
        notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )
      )}
      {needsPublish && !busy && (
        <button className="secondary" onClick={updateSite}>
          Try the site update again
        </button>
      )}
    </div>
  )

  if (!projects) {
    return loadFailed ? (
      <button className="primary" onClick={retryLoad}>
        Try again
      </button>
    ) : (
      <p className="muted">Loading projects…</p>
    )
  }

  if (!project) {
    const q = query.trim().toLowerCase()
    const matches = projects.filter(p => p.name.toLowerCase().includes(q))
    return (
      <section>
        {status}
        <p className="muted">
          Pick a project to hide or delete it, or some of its photos. Hidden photos stay in Cloudinary, so you can show
          them again later.
        </p>
        <input
          className="search admin-search"
          type="search"
          placeholder="Search projects…"
          aria-label="Search projects"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <ul className="projects">
          {matches.map(p => {
            const cover = p.photos.find(ph => !ph.hidden) ?? p.photos[0]
            return (
              <li key={p.assetFolder}>
                <button
                  className={`project${shownCount(p) === 0 ? ' project-off' : ''}`}
                  onClick={() => open(p.assetFolder)}
                >
                  <img className="project-thumb" src={sized(cover.url, 160)} alt="" loading="lazy" />
                  <span className="project-text">
                    <strong>
                      {p.name}
                      {p.hidden && <span className="badge badge-hidden">hidden</span>}
                    </strong>
                    <small>{summary(p)}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {matches.length === 0 && <p className="muted">No projects match.</p>}
      </section>
    )
  }

  const chosen = project.photos.filter(ph => selected.has(ph.publicId))
  const off = shownCount(project) === 0

  return (
    <section className="panel">
      <button className="link-button" onClick={() => open(null)}>
        ← All projects
      </button>
      <h2>
        {project.name}
        {project.hidden && <span className="badge badge-hidden">hidden</span>}
      </h2>
      <p className="muted">
        {summary(project)}.{' '}
        {project.hidden
          ? 'The whole project is off the site.'
          : off
            ? 'Every photo is hidden, so the project is off the site.'
            : 'Tap photos to select them.'}
      </p>
      <div className="actions">
        <button className="secondary" disabled={Boolean(busy)} onClick={toggleProjectHidden}>
          {project.hidden ? 'Show project' : 'Hide project'}
        </button>
        <button className="danger" disabled={Boolean(busy)} onClick={deleteProject}>
          Delete project
        </button>
      </div>
      {status}
      <ul className="photo-grid manage-grid">
        {project.photos.map((ph, i) => {
          const isSelected = selected.has(ph.publicId)
          return (
            <li
              key={ph.publicId}
              className={`photo${ph.hidden ? ' photo-hidden' : ''}${isSelected ? ' photo-selected' : ''}`}
            >
              <button
                type="button"
                className="photo-button"
                aria-pressed={isSelected}
                aria-label={`Photo ${i + 1}${ph.hidden ? ', hidden' : ''}`}
                disabled={Boolean(busy)}
                onClick={() => toggle(ph.publicId)}
              >
                <img src={sized(ph.url, 300)} alt="" loading="lazy" />
                {ph.hidden && <span className="photo-flag">Hidden</span>}
                {isSelected && (
                  <span className="photo-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {chosen.length > 0 && (
        <div className="selection-bar">
          <span>{chosen.length} selected</span>
          {chosen.some(ph => !ph.hidden) && (
            <button className="secondary" disabled={Boolean(busy)} onClick={() => setSelectedHidden(true)}>
              Hide
            </button>
          )}
          {chosen.some(ph => ph.hidden) && (
            <button className="secondary" disabled={Boolean(busy)} onClick={() => setSelectedHidden(false)}>
              Show
            </button>
          )}
          <button className="danger" disabled={Boolean(busy)} onClick={deleteSelected}>
            Delete
          </button>
          <button className="link-button" disabled={Boolean(busy)} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
    </section>
  )
}

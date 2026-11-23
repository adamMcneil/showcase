import { useEffect, useState } from 'react'
import { sized } from '../lib/cloudinary'
import {
  SignInExpired,
  createSession,
  deleteSession,
  getSession,
  listPicked,
  pickerLink,
  seconds,
  signIn,
  signOut,
} from './googlePhotos'
import Manage from './Manage'
import { copyPhoto, publish } from './uploader'
import '../App.css'
import './Admin.css'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const CONFIGURED = Boolean(CLIENT_ID && import.meta.env.VITE_UPLOADER_URL)
const SITE_URL = import.meta.env.BASE_URL
const AUTH_KEY = 'showcase-admin-auth'
const PENDING_KEY = 'showcase-admin-pending'
const COPY_CONCURRENCY = 2

function load(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key))
  } catch {
    return null
  }
}

function save(key, value) {
  if (value == null) sessionStorage.removeItem(key)
  else sessionStorage.setItem(key, JSON.stringify(value))
}

function storedAuth() {
  const auth = load(AUTH_KEY)
  return auth && auth.expiresAt - Date.now() > 5 * 60_000 ? auth : null
}

export function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isPhoto(item) {
  return item.type === 'PHOTO' || (item.mediaFile?.mimeType ?? '').startsWith('image/')
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The tab is in the URL (#manage), so it can be bookmarked.
function modeFromHash() {
  return window.location.hash === '#manage' ? 'manage' : 'add'
}

export default function Admin() {
  const [mode, setMode] = useState(modeFromHash)
  const [auth, setAuth] = useState(storedAuth)
  const [error, setError] = useState(null)
  const [projects, setProjects] = useState(null)
  const [target, setTarget] = useState(() => load(PENDING_KEY)?.target ?? null)
  const [session, setSession] = useState(() => load(PENDING_KEY)?.session ?? null)
  const [photos, setPhotos] = useState(null) // [{ item, status, url, error }]
  const [skipped, setSkipped] = useState(0)
  const [publishing, setPublishing] = useState(null) // null | 'working' | 'done'

  const step = !auth ? 'signin' : !target ? 'choose' : !photos ? 'pick' : publishing === 'done' ? 'done' : 'copy'

  function fail(e) {
    if (e instanceof SignInExpired) {
      save(AUTH_KEY, null)
      setAuth(null)
    }
    setError(e.message)
  }

  useEffect(() => {
    function onHashChange() {
      setError(null)
      setMode(modeFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!auth || projects) return
    fetch(`${SITE_URL}images-manifest.json`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load the project list'))))
      .then(setProjects)
      .catch(e => setError(e.message))
  }, [auth, projects])

  useEffect(() => {
    if (!auth || !target || session || photos) return
    let cancelled = false
    createSession(auth.token)
      .then(s => {
        if (cancelled) return deleteSession(auth.token, s.id)
        const next = { id: s.id, pickerUri: s.pickerUri }
        save(PENDING_KEY, { target, session: next })
        setSession(next)
      })
      .catch(e => !cancelled && fail(e))
    return () => {
      cancelled = true
    }
  }, [auth, target, session, photos])

  useEffect(() => {
    if (!auth || !target || !session || photos) return
    let stopped = false
    let busy = false
    let timer

    async function poll() {
      if (busy || stopped) return
      busy = true
      clearTimeout(timer)
      try {
        const s = await getSession(auth.token, session.id)
        if (stopped) return
        if (s.mediaItemsSet) {
          const items = await listPicked(auth.token, session.id)
          if (!stopped) startCopy(auth.token, target, session, items)
          return
        }
        timer = setTimeout(poll, seconds(s.pollingConfig?.pollInterval, 3) * 1000)
      } catch (e) {
        if (!stopped) fail(e)
      } finally {
        busy = false
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') poll()
    }

    poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [auth, target, session, photos])

  async function handleSignIn() {
    setError(null)
    try {
      const next = await signIn(CLIENT_ID)
      save(AUTH_KEY, next)
      setAuth(next)
    } catch (e) {
      setError(e.message)
    }
  }

  function handleSignOut() {
    if (session) deleteSession(auth.token, session.id)
    signOut(auth.token)
    save(AUTH_KEY, null)
    save(PENDING_KEY, null)
    setAuth(null)
    reset()
  }

  function reset() {
    setTarget(null)
    setSession(null)
    setPhotos(null)
    setSkipped(0)
    setPublishing(null)
    setError(null)
  }

  function chooseProject(next) {
    setError(null)
    setTarget(next)
  }

  function cancelPicking() {
    if (session) deleteSession(auth.token, session.id)
    save(PENDING_KEY, null)
    reset()
  }

  function pickAgain() {
    if (session) deleteSession(auth.token, session.id)
    save(PENDING_KEY, null)
    setSession(null)
    setPhotos(null)
    setSkipped(0)
    setError(null)
  }

  async function startCopy(token, tgt, sess, items) {
    const picked = items.filter(isPhoto)
    setSkipped(items.length - picked.length)
    setPhotos(picked.map(item => ({ item, status: 'waiting' })))
    if (picked.length === 0) return
    const failed = await copyAll(token, tgt, picked, picked.map((_, i) => i))
    if (failed === 0) await finish(token, sess)
  }

  async function copyAll(token, tgt, items, indexes) {
    const queue = [...indexes]
    let failed = 0
    const update = (i, patch) => setPhotos(prev => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)))

    async function lane() {
      while (queue.length) {
        const i = queue.shift()
        update(i, { status: 'copying', error: null })
        try {
          const r = await copyPhoto(token, {
            assetFolder: tgt.assetFolder,
            productName: tgt.isNew ? tgt.name : undefined,
            item: items[i],
          })
          update(i, { status: 'done', url: r.url })
        } catch (e) {
          failed++
          update(i, { status: 'failed', error: e.message })
          if (e instanceof SignInExpired) {
            queue.length = 0
            fail(e)
          }
        }
      }
    }

    await Promise.all(Array.from({ length: COPY_CONCURRENCY }, lane))
    return failed
  }

  async function finish(token, sess) {
    setError(null)
    setPublishing('working')
    deleteSession(token, sess.id)
    save(PENDING_KEY, null)
    try {
      await publish(token)
      setPublishing('done')
    } catch (e) {
      setPublishing(null)
      fail(e)
    }
  }

  async function retryFailed() {
    setError(null)
    const indexes = photos.flatMap((p, i) => (p.status === 'failed' ? [i] : []))
    const failed = await copyAll(auth.token, target, photos.map(p => p.item), indexes)
    if (failed === 0) await finish(auth.token, session)
  }

  return (
    <div className="container admin">
      <div className="header">
        <a className="brand" href={SITE_URL}>
          <img className="brand-logo" src={`${SITE_URL}logo.svg`} alt="" width="40" height="40" />
          <h1>{mode === 'manage' ? 'Hide or remove' : 'Add photos'}</h1>
        </a>
        {auth && (
          <button className="link-button" onClick={handleSignOut}>
            Sign out
          </button>
        )}
      </div>

      {CONFIGURED && auth && (
        <nav className="admin-tabs">
          <a href="#add" aria-current={mode === 'add' ? 'page' : undefined}>
            Add photos
          </a>
          <a href="#manage" aria-current={mode === 'manage' ? 'page' : undefined}>
            Hide or remove
          </a>
        </nav>
      )}

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      {!CONFIGURED ? (
        <section className="panel">
          <h2>Not set up yet</h2>
          <p>Photo uploads need a Google sign-in client and the uploader Worker. See docs/adding-photos.md in the repo.</p>
        </section>
      ) : step === 'signin' ? (
        <section className="panel">
          <h2>Sign in</h2>
          <p>Sign in with the Google account that holds your photos.</p>
          <button className="primary" onClick={handleSignIn}>
            Sign in with Google
          </button>
        </section>
      ) : mode === 'manage' ? (
        <Manage token={auth.token} onError={fail} clearError={() => setError(null)} />
      ) : step === 'choose' ? (
        <ProjectChooser projects={projects} onChoose={chooseProject} />
      ) : step === 'pick' ? (
        <PickStep target={target} session={session} error={error} onCancel={cancelPicking} onRestart={pickAgain} />
      ) : step === 'copy' ? (
        <CopyStep
          target={target}
          photos={photos}
          skipped={skipped}
          publishing={publishing}
          onRetry={retryFailed}
          onPublish={() => finish(auth.token, session)}
          onPickAgain={pickAgain}
          onCancel={cancelPicking}
        />
      ) : (
        <section className="panel">
          <h2>Done</h2>
          <p>
            Added {plural(photos.filter(p => p.status === 'done').length, 'photo')} to <strong>{target.name}</strong>
            {skipped > 0 && ` (skipped ${plural(skipped, 'video')})`}. The site shows them in about 2–3 minutes.
          </p>
          <PhotoGrid photos={photos} />
          <div className="actions">
            <button className="primary" onClick={reset}>
              Add more photos
            </button>
            <a className="secondary" href={SITE_URL}>
              View site
            </a>
          </div>
        </section>
      )}
    </div>
  )
}

function ProjectChooser({ projects, onChoose }) {
  const [query, setQuery] = useState('')

  if (!projects) {
    return <p className="muted">Loading projects…</p>
  }

  const q = query.trim()
  const root = projects.find(p => p.assetFolder)?.assetFolder.split('/')[0]
  const slug = slugify(q)
  const existing = q
    ? projects.find(p => p.assetFolder?.split('/')[1] === slug || p.dir.toLowerCase() === q.toLowerCase())
    : null
  const matches = projects.filter(p => p === existing || p.dir.toLowerCase().includes(q.toLowerCase()))
  const canCreate = Boolean(q && slug && root && !existing)

  return (
    <section>
      <p className="muted">Pick the project to add photos to, or type a new project's name.</p>
      {!root && (
        <p className="admin-error">
          The project list doesn't include Cloudinary folders yet. Run the “Update Image Manifest” workflow on GitHub
          once, then reload this page.
        </p>
      )}
      <input
        className="search admin-search"
        type="search"
        placeholder="Search or name a new project…"
        aria-label="Project name"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <ul className="projects">
        {canCreate && (
          <li>
            <button className="project" onClick={() => onChoose({ name: q, assetFolder: `${root}/${slug}`, isNew: true })}>
              <span className="project-thumb project-new" aria-hidden="true">
                +
              </span>
              <span className="project-text">
                <strong>New project “{q}”</strong>
                <small>Cloudinary folder {`${root}/${slug}`}</small>
              </span>
            </button>
          </li>
        )}
        {matches.map(p => (
          <li key={p.assetFolder ?? p.dir}>
            <button
              className="project"
              disabled={!p.assetFolder}
              onClick={() => onChoose({ name: p.dir, assetFolder: p.assetFolder, isNew: false })}
            >
              <img className="project-thumb" src={sized(p.thumb ?? p.first, 160)} alt="" loading="lazy" />
              <span className="project-text">
                <strong>{p.dir}</strong>
                <small>{plural(p.files?.length ?? 1, 'photo')}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {matches.length === 0 && !canCreate && <p className="muted">No projects match.</p>}
    </section>
  )
}

function PickStep({ target, session, error, onCancel, onRestart }) {
  return (
    <section className="panel">
      <h2>
        Add photos to {target.name}
        {target.isNew && <span className="badge">new</span>}
      </h2>
      {!session ? (
        error ? (
          <button className="primary" onClick={onRestart}>
            Try again
          </button>
        ) : (
          <p className="muted">Connecting to Google Photos…</p>
        )
      ) : (
        <>
          <ol className="steps">
            <li>Open Google Photos and tick the photos for this project.</li>
            <li>Tap Done, then come back to this page.</li>
          </ol>
          <a className="primary" href={pickerLink(session.pickerUri)} target="_blank" rel="noopener noreferrer">
            Open Google Photos
          </a>
          {error ? (
            <button className="secondary" onClick={onRestart}>
              Start picking again
            </button>
          ) : (
            <p className="muted waiting">Waiting for your picks…</p>
          )}
        </>
      )}
      <button className="link-button" onClick={onCancel}>
        Choose a different project
      </button>
    </section>
  )
}

function CopyStep({ target, photos, skipped, publishing, onRetry, onPublish, onPickAgain, onCancel }) {
  const done = photos.filter(p => p.status === 'done').length
  const failed = photos.filter(p => p.status === 'failed').length
  const busy = photos.some(p => p.status === 'waiting' || p.status === 'copying')

  if (photos.length === 0) {
    return (
      <section className="panel">
        <h2>No photos picked</h2>
        <p>{skipped > 0 ? `Only videos were picked (${skipped}). The site shows photos only.` : 'Nothing was picked.'}</p>
        <div className="actions">
          <button className="primary" onClick={onPickAgain}>
            Pick again
          </button>
          <button className="secondary" onClick={onCancel}>
            Choose a different project
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>Adding photos to {target.name}</h2>
      <p className="muted">
        {publishing === 'working'
          ? 'Starting the site update…'
          : `Copied ${done} of ${photos.length}${failed ? `, ${failed} failed` : ''}${skipped ? ` (skipped ${plural(skipped, 'video')})` : ''}.`}
      </p>
      <progress max={photos.length} value={done} />
      {!busy && failed > 0 && <p className="admin-error">{photos.find(p => p.status === 'failed').error}</p>}
      <PhotoGrid photos={photos} />
      {!busy && !publishing && (failed > 0 || done === photos.length) && (
        <div className="actions">
          {failed > 0 && (
            <button className="primary" onClick={onRetry}>
              Retry {plural(failed, 'failed photo')}
            </button>
          )}
          {done > 0 && (
            <button className={failed > 0 ? 'secondary' : 'primary'} onClick={onPublish}>
              {failed > 0 ? `Publish the ${done} copied` : 'Update the site'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function PhotoGrid({ photos }) {
  return (
    <ul className="photo-grid">
      {photos.map(p => (
        <li key={p.item.id} className={`photo photo-${p.status}`} title={p.error ?? p.item.mediaFile?.filename}>
          {p.url ? <img src={sized(p.url, 240)} alt="" /> : <span>{p.status === 'failed' ? '!' : ''}</span>}
        </li>
      ))}
    </ul>
  )
}

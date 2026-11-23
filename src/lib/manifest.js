// The gallery's list of projects and photos. Read live from the uploader
// Worker, so changes made on the admin page show up straight away; if the
// Worker can't be reached, the static copy deployed with the site is used.
const LIVE_URL = import.meta.env.VITE_UPLOADER_URL
  ? `${import.meta.env.VITE_UPLOADER_URL.replace(/\/$/, '')}/manifest`
  : null
const STATIC_URL = `${import.meta.env.BASE_URL}images-manifest.json`
const LIVE_TIMEOUT_MS = 3000

export async function loadManifest() {
  if (LIVE_URL) {
    try {
      const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) })
      if (res.ok) return await res.json()
    } catch {
      // fall through to the static copy
    }
  }
  const res = await fetch(STATIC_URL, { cache: 'no-cache' })
  if (!res.ok) throw new Error('Failed to load manifest')
  return res.json()
}

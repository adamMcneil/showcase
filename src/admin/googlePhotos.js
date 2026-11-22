const PICKER_API = 'https://photospicker.googleapis.com/v1'
const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
const SCOPES = `openid email ${PHOTOS_SCOPE}`

export class SignInExpired extends Error {
  constructor() {
    super('Your Google sign-in expired. Sign in again to continue.')
  }
}

export function signIn(clientId) {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2
    if (!oauth2) {
      reject(new Error('Google sign-in did not load. Check your connection and reload the page.'))
      return
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: res => {
        if (res.error) return reject(new Error(res.error_description || res.error))
        if (!oauth2.hasGrantedAllScopes(res, PHOTOS_SCOPE)) {
          return reject(new Error('Allow access to Google Photos to pick photos.'))
        }
        resolve({ token: res.access_token, expiresAt: Date.now() + Number(res.expires_in) * 1000 })
      },
      error_callback: err => {
        reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in failed.'))
      },
    })
    client.requestAccessToken()
  })
}

export function signOut(token) {
  window.google?.accounts?.oauth2?.revoke(token, () => {})
}

async function api(token, path, init = {}) {
  const res = await fetch(PICKER_API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (res.status === 401) throw new SignInExpired()
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? `Google Photos returned ${res.status}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

export function createSession(token) {
  return api(token, '/sessions', { method: 'POST', body: '{}' })
}

export function getSession(token, id) {
  return api(token, `/sessions/${encodeURIComponent(id)}`)
}

export function deleteSession(token, id) {
  return api(token, `/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
}

export async function listPicked(token, sessionId) {
  const items = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ sessionId, pageSize: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await api(token, `/mediaItems?${params}`)
    items.push(...(page.mediaItems ?? []))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return items
}

// Google durations look like "5s" or "1.5s".
export function seconds(duration, fallback) {
  const n = parseFloat(duration)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Desktop browsers can close the Google Photos tab when picking is done;
// phones open the Google Photos app instead.
export function pickerLink(pickerUri) {
  const touch = window.matchMedia?.('(pointer: coarse)').matches
  return touch ? pickerUri : `${pickerUri.replace(/\/$/, '')}/autoclose`
}

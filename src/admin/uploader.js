import { SignInExpired } from './googlePhotos'

const UPLOADER_URL = (import.meta.env.VITE_UPLOADER_URL ?? '').replace(/\/$/, '')

async function call(token, path, body) {
  const res = await fetch(UPLOADER_URL + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (res.status === 401) throw new SignInExpired()
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Uploader returned ${res.status}`)
  return data
}

export function copyPhoto(token, { assetFolder, productName, item }) {
  return call(token, '/copy', { assetFolder, productName, item })
}

export function publish(token) {
  return call(token, '/publish')
}

// Copies photos picked in Google Photos into Cloudinary, then asks GitHub to
// rebuild the image manifest. Called by the admin page (admin.html).
//
// Google's download links expire after an hour and need the owner's Google
// token in a header, which browsers can't send there, so the copy happens here.
// Every request must carry the owner's Google access token; it is checked with
// Google and never stored.

const GOOGLE_PHOTO_URL = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//
const ASSET_FOLDER = /^[\w -]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_UPLOAD_BYTES = 10_000_000 // Cloudinary free-plan image limit
const FALLBACK_SIZE = '=w4000-h4000'

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      if (!env.OWNER_EMAIL || !env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Uploader is not configured yet')
      if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')

      const { pathname } = new URL(request.url)
      const googleToken = await requireOwner(request, env)

      if (pathname === '/copy') return json(await copyPhoto(await readJson(request), googleToken, env), 200, cors)
      if (pathname === '/publish') return json(await publish(env), 200, cors)
      throw new HttpError(404, 'Not found')
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      return json({ error: e.message }, status, cors)
    }
  },
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const origin = request.headers.get('Origin')
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  }
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'Request body must be JSON')
  }
}

async function requireOwner(request, env) {
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'Sign in with Google first')

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new HttpError(401, 'Google sign-in expired, sign in again')
  const info = await res.json()

  const sameApp = info.aud === env.GOOGLE_CLIENT_ID || info.azp === env.GOOGLE_CLIENT_ID
  const isOwner = String(info.email_verified) === 'true'
    && (info.email ?? '').toLowerCase() === env.OWNER_EMAIL.toLowerCase()
  if (!sameApp || !isOwner) throw new HttpError(403, 'This Google account is not allowed to add photos')
  return token
}

async function copyPhoto(body, googleToken, env) {
  const { assetFolder, productName, item } = body ?? {}
  const file = item?.mediaFile
  if (typeof assetFolder !== 'string' || !ASSET_FOLDER.test(assetFolder)) throw new HttpError(400, 'Bad project folder')
  if (!file || !GOOGLE_PHOTO_URL.test(file.baseUrl ?? '')) throw new HttpError(400, 'Bad Google Photos item')
  if (item.type !== 'PHOTO' && !(file.mimeType ?? '').startsWith('image/')) throw new HttpError(400, 'Only photos can be added')

  const photo = await downloadPhoto(file.baseUrl, googleToken)
  const stem = fileStem(file.filename)
  const publicId = `${stem}_${(await sha1Hex(`${assetFolder}/${item.id}`)).slice(0, 8)}`

  const context = { taken: item.createTime }
  if (productName) context.product = productName

  const uploaded = await uploadToCloudinary(env, photo, file.filename || `${stem}.jpg`, {
    asset_folder: assetFolder,
    context: contextString(context),
    display_name: stem,
    overwrite: 'false',
    public_id: publicId,
  })
  return { publicId: uploaded.public_id, url: uploaded.secure_url, existing: Boolean(uploaded.existing) }
}

async function downloadPhoto(baseUrl, googleToken) {
  const get = async suffix => {
    const res = await fetch(baseUrl + suffix, { headers: { Authorization: `Bearer ${googleToken}` } })
    if (!res.ok) throw new HttpError(502, `Google Photos download failed (${res.status})`)
    return res.blob()
  }
  // =d keeps the camera metadata (date taken); very large originals are
  // downsized so they fit Cloudinary's upload limit.
  const original = await get('=d')
  return original.size <= MAX_UPLOAD_BYTES ? original : get(FALLBACK_SIZE)
}

export function fileStem(filename) {
  const stem = String(filename ?? '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return stem || 'photo'
}

export function contextString(values) {
  const escape = v => String(v).replace(/[=|]/g, m => `\\${m}`)
  return Object.entries(values)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${escape(v)}`)
    .join('|')
}

export async function cloudinarySignature(params, apiSecret) {
  const toSign = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')
  return sha1Hex(toSign + apiSecret)
}

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function uploadToCloudinary(env, photo, filename, params) {
  const signed = { ...params, timestamp: String(Math.floor(Date.now() / 1000)) }
  const form = new FormData()
  for (const [k, v] of Object.entries(signed)) form.append(k, v)
  form.append('api_key', env.CLOUDINARY_API_KEY)
  form.append('signature', await cloudinarySignature(signed, env.CLOUDINARY_API_SECRET))
  form.append('file', photo, filename)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(502, `Cloudinary upload failed: ${data.error?.message ?? res.status}`)
  return data
}

async function publish(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/update-manifest.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'showcase-uploader',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  )
  if (res.status !== 204) throw new HttpError(502, `Could not start the site update (GitHub ${res.status})`)
  return { ok: true }
}

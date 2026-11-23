// The admin page's (admin.html) back end. It copies photos picked in Google
// Photos into Cloudinary, hides and deletes photos and projects there, and asks
// GitHub to rebuild the image manifest.
//
// Google's download links expire after an hour and need the owner's Google
// token in a header, which browsers can't send there, so the copy happens here.
// Every request must carry the owner's Google access token; it is checked with
// Google and never stored.

const GOOGLE_PHOTO_URL = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//
// New projects get slug folders; older ones can have spaces ("baptism crosses").
const ASSET_FOLDER = /^[\w -]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const PROJECT_FOLDER = /^[\w -]+\/[\w -]+$/
const MAX_UPLOAD_BYTES = 10_000_000 // Cloudinary free-plan image limit
const FALLBACK_SIZE = '=w4000-h4000'
const BATCH_SIZE = 100 // most public IDs Cloudinary's delete call takes

// Hidden photos stay in Cloudinary but scripts/generate-manifest.js leaves
// them off the site. Tags, not context, because adding or removing one tag
// leaves the photo's other metadata alone.
export const HIDDEN_TAG = 'hidden'
// Put on every photo of a hidden project. A project is hidden while any of its
// photos has it, so photos added later stay hidden too.
export const HIDDEN_PROJECT_TAG = 'hidden-project'

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
      if (pathname === '/list') return json(await listProjects(env), 200, cors)
      if (pathname === '/hide') return json(await setHidden(await readJson(request), env), 200, cors)
      if (pathname === '/delete') return json(await deletePhotos(await readJson(request), env), 200, cors)
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
  if (!sameApp || !isOwner) throw new HttpError(403, 'This Google account is not allowed to change the site')
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

// Every photo in every project, hidden ones included, for the admin page.
// One Admin API call per 500 photos (the free plan allows 500 calls an hour).
async function listProjects(env) {
  const projects = new Map()
  let cursor
  do {
    const page = await adminApi(env, 'GET', 'resources/image', {
      max_results: 500,
      context: true,
      tags: true,
      ...(cursor ? { next_cursor: cursor } : {}),
    })
    for (const r of page.resources ?? []) {
      const assetFolder = r.asset_folder ?? ''
      if (!PROJECT_FOLDER.test(assetFolder)) continue
      const context = r.context?.custom ?? r.context ?? {}
      const tags = r.tags ?? []
      if (!projects.has(assetFolder)) projects.set(assetFolder, { assetFolder, product: null, hidden: false, photos: [] })
      const project = projects.get(assetFolder)
      project.product ??= context.product ?? null
      project.hidden ||= tags.includes(HIDDEN_PROJECT_TAG)
      project.photos.push({
        publicId: r.public_id,
        url: r.secure_url,
        taken: context.taken ?? r.created_at ?? null,
        hidden: tags.includes(HIDDEN_TAG),
      })
    }
    cursor = page.next_cursor
  } while (cursor)
  return { projects: [...projects.values()] }
}

async function setHidden(body, env) {
  if (typeof body?.hidden !== 'boolean') throw new HttpError(400, 'Say whether to hide or show')
  const { ids, project } = await resolveTargets(body, env)
  const tag = project ? HIDDEN_PROJECT_TAG : HIDDEN_TAG
  for (const batch of chunks(ids, BATCH_SIZE)) await tagPhotos(env, body.hidden ? 'add' : 'remove', tag, batch)
  return { changed: ids.length }
}

async function deletePhotos(body, env) {
  const { ids, project } = await resolveTargets(body, env)
  const deleted = []
  for (const batch of chunks(ids, BATCH_SIZE)) {
    const res = await adminApi(env, 'DELETE', 'resources/image/upload', { public_ids: batch })
    // "not_found" means it's already gone, which is what was asked for.
    for (const [id, status] of Object.entries(res.deleted ?? {})) {
      if (status === 'deleted' || status === 'not_found') deleted.push(id)
    }
  }
  if (project) {
    // Tidies up the Media Library; the site only lists folders with photos.
    const path = body.assetFolder.split('/').map(encodeURIComponent).join('/')
    await adminApi(env, 'DELETE', `folders/${path}`).catch(() => {})
  }
  return { deleted }
}

// Body: { assetFolder, project: true } for a whole project, or
// { assetFolder, publicIds: [...] } for photos, which must be in that project.
async function resolveTargets(body, env) {
  const { assetFolder, publicIds, project } = body ?? {}
  if (typeof assetFolder !== 'string' || !PROJECT_FOLDER.test(assetFolder)) throw new HttpError(400, 'Bad project folder')
  const wholeProject = project === true
  if (!wholeProject) {
    const valid = Array.isArray(publicIds) && publicIds.length > 0 && publicIds.every(id => typeof id === 'string' && id)
    if (!valid) throw new HttpError(400, 'Say which photos, or the whole project')
  }

  const inFolder = await folderPhotoIds(env, assetFolder)
  if (wholeProject) {
    if (inFolder.length === 0) throw new HttpError(404, 'That project has no photos')
    return { ids: inFolder, project: true }
  }
  const known = new Set(inFolder)
  const strays = publicIds.filter(id => !known.has(id))
  if (strays.length) throw new HttpError(400, `Not in this project: ${strays.join(', ')}`)
  return { ids: [...new Set(publicIds)], project: false }
}

async function folderPhotoIds(env, assetFolder) {
  const ids = []
  let cursor
  do {
    const page = await adminApi(env, 'GET', 'resources/by_asset_folder', {
      asset_folder: assetFolder,
      max_results: 500,
      ...(cursor ? { next_cursor: cursor } : {}),
    })
    for (const r of page.resources ?? []) {
      if ((r.resource_type ?? 'image') === 'image' && (r.type ?? 'upload') === 'upload') ids.push(r.public_id)
    }
    cursor = page.next_cursor
  } while (cursor)
  return ids
}

export function chunks(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function adminApi(env, method, path, params = {}) {
  const url = new URL(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(`${k}[]`, item))
    else url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${btoa(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`)}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(502, `Cloudinary ${method} ${path} failed: ${data.error?.message ?? res.status}`)
  return data
}

async function tagPhotos(env, command, tag, publicIds) {
  const signed = { command, public_ids: publicIds, tag, timestamp: String(Math.floor(Date.now() / 1000)) }
  const form = new FormData()
  form.append('command', command)
  form.append('tag', tag)
  form.append('timestamp', signed.timestamp)
  for (const id of publicIds) form.append('public_ids[]', id)
  form.append('api_key', env.CLOUDINARY_API_KEY)
  form.append('signature', await cloudinarySignature(signed, env.CLOUDINARY_API_SECRET))

  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/tags`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(502, `Cloudinary could not ${command} the ${tag} tag: ${data.error?.message ?? res.status}`)
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

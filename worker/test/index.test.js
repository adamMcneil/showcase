import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import worker, { cloudinarySignature, contextString, fileStem } from '../src/index.js'

const env = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  OWNER_EMAIL: 'Owner@example.com',
  CLOUDINARY_CLOUD_NAME: 'demo',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
  GH_DISPATCH_TOKEN: 'gh-token',
  GITHUB_REPO: 'someone/showcase',
  ALLOWED_ORIGINS: 'https://adammcneil.github.io',
}

const ownerTokenInfo = { aud: env.GOOGLE_CLIENT_ID, email: 'owner@example.com', email_verified: 'true' }

const item = {
  id: 'AF1Qip-abc',
  type: 'PHOTO',
  createTime: '2026-11-17T01:36:38.140Z',
  mediaFile: {
    baseUrl: 'https://lh3.googleusercontent.com/ppa/xyz',
    mimeType: 'image/jpeg',
    filename: 'PXL_20261117_013638140.jpg',
  },
}

let calls
let routes
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  routes = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const route = routes.find(r => String(url).startsWith(r.prefix))
    if (!route) throw new Error(`Unexpected fetch ${url}`)
    return route.respond(String(url), init)
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function route(prefix, respond) {
  routes.push({ prefix, respond })
}

function post(path, body, token = 'google-token') {
  return new Request(`https://uploader.example.workers.dev${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://adammcneil.github.io',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('signature matches Cloudinary documented examples', async () => {
  assert.equal(await cloudinarySignature({ timestamp: '1315060510' }, 'abcd'), 'a21ad0f63beb4de2e5575204b79ab90bffb02c10')
  assert.equal(
    await cloudinarySignature(
      { timestamp: '1315060510', public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' },
      'abcd'
    ),
    'bfd09f95f331f558cbd1320e67aa8d488770583e'
  )
})

test('context values escape = and |', () => {
  assert.equal(contextString({ taken: '2026-01-01', product: 'A=B|C', empty: '' }), 'taken=2026-01-01|product=A\\=B\\|C')
})

test('file stem drops extension and unsafe characters', () => {
  assert.equal(fileStem('PXL_20261117_013638140.jpg'), 'PXL_20261117_013638140')
  assert.equal(fileStem('My photo (1).HEIC'), 'My_photo_1')
  assert.equal(fileStem(undefined), 'photo')
})

test('preflight allows the site origin', async () => {
  const res = await worker.fetch(
    new Request('https://uploader.example.workers.dev/copy', {
      method: 'OPTIONS',
      headers: { Origin: 'https://adammcneil.github.io' },
    }),
    env
  )
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://adammcneil.github.io')
})

test('preflight does not allow other origins', async () => {
  const res = await worker.fetch(
    new Request('https://uploader.example.workers.dev/copy', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
    env
  )
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
})

test('refuses requests when not configured', async () => {
  const res = await worker.fetch(post('/copy', {}), { ...env, OWNER_EMAIL: undefined })
  assert.equal(res.status, 503)
  assert.equal(calls.length, 0)
})

test('refuses requests without a Google token', async () => {
  const res = await worker.fetch(post('/copy', {}, null), env)
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

test('refuses an expired Google token', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse({ error: 'invalid_token' }, 400))
  const res = await worker.fetch(post('/copy', {}), env)
  assert.equal(res.status, 401)
})

test('refuses a Google account that is not the owner', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse({ ...ownerTokenInfo, email: 'someone@else.com' }))
  const res = await worker.fetch(post('/copy', { assetFolder: 'images/box', item }), env)
  assert.equal(res.status, 403)
  assert.equal(calls.length, 1)
})

test('refuses a token issued to another app', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse({ ...ownerTokenInfo, aud: 'other-app' }))
  const res = await worker.fetch(post('/copy', { assetFolder: 'images/box', item }), env)
  assert.equal(res.status, 403)
})

test('refuses download links that are not Google Photos', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  const bad = { ...item, mediaFile: { ...item.mediaFile, baseUrl: 'https://example.com/x' } }
  const res = await worker.fetch(post('/copy', { assetFolder: 'images/box', item: bad }), env)
  assert.equal(res.status, 400)
  assert.equal(calls.length, 1)
})

test('refuses bad project folders', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  for (const assetFolder of ['box', 'images/Box', 'images/box/extra', '../box', 'images/box-']) {
    const res = await worker.fetch(post('/copy', { assetFolder, item }), env)
    assert.equal(res.status, 400, assetFolder)
  }
})

test('refuses videos', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  const video = { ...item, type: 'VIDEO', mediaFile: { ...item.mediaFile, mimeType: 'video/mp4' } }
  const res = await worker.fetch(post('/copy', { assetFolder: 'images/box', item: video }), env)
  assert.equal(res.status, 400)
})

test('copies a picked photo into the project folder with a signed upload', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://lh3.googleusercontent.com/', () => new Response(new Uint8Array([1, 2, 3])))
  route('https://api.cloudinary.com/', () =>
    jsonResponse({ public_id: 'PXL_20261117_013638140_abcd1234', secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg' })
  )

  const res = await worker.fetch(
    post('/copy', { assetFolder: 'images/kitchen-island', productName: "Meg's Island", item }),
    env
  )
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    publicId: 'PXL_20261117_013638140_abcd1234',
    url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg',
    existing: false,
  })

  const download = calls.find(c => c.url.startsWith('https://lh3'))
  assert.equal(download.url, `${item.mediaFile.baseUrl}=d`)
  assert.equal(download.init.headers.Authorization, 'Bearer google-token')

  const upload = calls.find(c => c.url.startsWith('https://api.cloudinary.com'))
  assert.equal(upload.url, 'https://api.cloudinary.com/v1_1/demo/image/upload')
  const form = upload.init.body
  assert.equal(form.get('asset_folder'), 'images/kitchen-island')
  assert.equal(form.get('display_name'), 'PXL_20261117_013638140')
  assert.equal(form.get('overwrite'), 'false')
  assert.match(form.get('public_id'), /^PXL_20261117_013638140_[0-9a-f]{8}$/)
  assert.equal(form.get('context'), "taken=2026-11-17T01:36:38.140Z|product=Meg's Island")
  assert.equal(form.get('api_key'), 'key')
  assert.equal(form.get('file').size, 3)

  const signed = {}
  for (const k of ['asset_folder', 'context', 'display_name', 'overwrite', 'public_id', 'timestamp']) signed[k] = form.get(k)
  assert.equal(form.get('signature'), await cloudinarySignature(signed, 'secret'))
})

test('same photo in the same project gets the same public id', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://lh3.googleusercontent.com/', () => new Response(new Uint8Array([1])))
  route('https://api.cloudinary.com/', () => jsonResponse({ public_id: 'x', secure_url: 'u', existing: true }))

  const ids = []
  for (const assetFolder of ['images/box', 'images/box', 'images/other-box']) {
    await worker.fetch(post('/copy', { assetFolder, item }), env)
    ids.push(calls.filter(c => c.url.startsWith('https://api.cloudinary.com')).at(-1).init.body.get('public_id'))
  }
  assert.equal(ids[0], ids[1])
  assert.notEqual(ids[0], ids[2])
})

test('downsizes photos too large for Cloudinary', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://lh3.googleusercontent.com/', url =>
    new Response(url.endsWith('=d') ? new Uint8Array(10_000_001) : new Uint8Array(5))
  )
  route('https://api.cloudinary.com/', () => jsonResponse({ public_id: 'x', secure_url: 'u' }))

  const res = await worker.fetch(post('/copy', { assetFolder: 'images/box', item }), env)
  assert.equal(res.status, 200)
  const downloads = calls.filter(c => c.url.startsWith('https://lh3')).map(c => c.url)
  assert.deepEqual(downloads, [`${item.mediaFile.baseUrl}=d`, `${item.mediaFile.baseUrl}=w4000-h4000`])
  const upload = calls.find(c => c.url.startsWith('https://api.cloudinary.com'))
  assert.equal(upload.init.body.get('file').size, 5)
})

test('reports Cloudinary errors', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://lh3.googleusercontent.com/', () => new Response(new Uint8Array([1])))
  route('https://api.cloudinary.com/', () => jsonResponse({ error: { message: 'Invalid Signature' } }, 401))
  const res = await worker.fetch(post('/copy', { assetFolder: 'images/box', item }), env)
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /Invalid Signature/)
})

test('publish starts the Update Image Manifest workflow on main', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://api.github.com/', () => new Response(null, { status: 204 }))
  const res = await worker.fetch(post('/publish', {}), env)
  assert.equal(res.status, 200)
  const dispatch = calls.find(c => c.url.startsWith('https://api.github.com'))
  assert.equal(dispatch.url, 'https://api.github.com/repos/someone/showcase/actions/workflows/update-manifest.yml/dispatches')
  assert.equal(dispatch.init.headers.Authorization, 'Bearer gh-token')
  assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main' })
})

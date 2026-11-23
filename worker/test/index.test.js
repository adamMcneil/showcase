import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import worker, { HIDDEN_PROJECT_TAG, HIDDEN_TAG, chunks, cloudinarySignature, contextString, fileStem } from '../src/index.js'

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

// ── The site's manifest ───────────────────────────────────────────────────────

function fakeKv(initial) {
  const store = new Map(initial ? [['manifest', initial]] : [])
  return {
    store,
    async get(key) {
      return store.get(key) ?? null
    },
    async put(key, value) {
      store.set(key, value)
    },
  }
}

const boxPhoto = {
  public_id: 'box_one',
  asset_folder: 'images/box',
  display_name: 'box_one',
  created_at: '2024-03-01T00:00:00Z',
  tags: [],
  context: { custom: { taken: '2024-02-01T09:00:00' } },
}

test('publish refreshes the live manifest, then starts the Update Image Manifest workflow', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://api.cloudinary.com/v1_1/demo/resources/image', () => jsonResponse({ resources: [boxPhoto] }))
  route('https://api.github.com/', () => new Response(null, { status: 204 }))
  const kv = fakeKv()
  const res = await worker.fetch(post('/publish', {}), { ...env, MANIFEST: kv })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, backup: true })

  const stored = JSON.parse(kv.store.get('manifest'))
  assert.deepEqual(stored.map(e => e.dir), ['Box'])
  assert.deepEqual(stored[0].dates, ['2024-02-01T09:00:00'])

  const dispatch = calls.find(c => c.url.startsWith('https://api.github.com'))
  assert.equal(dispatch.url, 'https://api.github.com/repos/someone/showcase/actions/workflows/update-manifest.yml/dispatches')
  assert.equal(dispatch.init.headers.Authorization, 'Bearer gh-token')
  assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main' })
})

test('publish still succeeds when GitHub refuses, since the site reads the live manifest', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://api.cloudinary.com/v1_1/demo/resources/image', () => jsonResponse({ resources: [boxPhoto] }))
  route('https://api.github.com/', () => jsonResponse({ message: 'Bad credentials' }, 401))
  const kv = fakeKv()
  const res = await worker.fetch(post('/publish', {}), { ...env, MANIFEST: kv })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.backup, false)
  assert.match(body.warning, /GitHub 401/)
  assert.ok(kv.store.has('manifest'))
})

test('publish fails when Cloudinary does, and leaves the stored manifest alone', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://api.cloudinary.com/', () => jsonResponse({ error: { message: 'Rate Limit Exceeded' } }, 420))
  const kv = fakeKv('[{"dir":"Old"}]')
  const res = await worker.fetch(post('/publish', {}), { ...env, MANIFEST: kv })
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /Rate Limit Exceeded/)
  assert.equal(kv.store.get('manifest'), '[{"dir":"Old"}]')
  assert.equal(calls.filter(c => c.url.startsWith('https://api.github.com')).length, 0)
})

test('GET /manifest serves the stored manifest to anyone, without calling Cloudinary', async () => {
  const kv = fakeKv('[{"dir":"Box"}]')
  const res = await worker.fetch(new Request('https://uploader.example.workers.dev/manifest'), { ...env, MANIFEST: kv })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(res.headers.get('Content-Type'), 'application/json')
  assert.deepEqual(await res.json(), [{ dir: 'Box' }])
  assert.equal(calls.length, 0)
})

test('GET /manifest builds and stores the manifest when there is none, reusing the site copy\'s dates', async () => {
  const old = { ...boxPhoto, public_id: 'old_photo', display_name: 'old_photo', context: {} }
  route('https://api.cloudinary.com/v1_1/demo/resources/image', () => jsonResponse({ resources: [boxPhoto, old] }))
  route('https://site.example/images-manifest.json', () =>
    jsonResponse([{ files: ['https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/old_photo?_a=x'], dates: ['2019-05-05T05:05:05'] }])
  )
  const kv = fakeKv()
  const res = await worker.fetch(new Request('https://uploader.example.workers.dev/manifest'), {
    ...env,
    MANIFEST: kv,
    SITE_URL: 'https://site.example/',
  })
  assert.equal(res.status, 200)
  const manifest = await res.json()
  assert.deepEqual(manifest[0].dates, ['2019-05-05T05:05:05', '2024-02-01T09:00:00'])
  assert.deepEqual(JSON.parse(kv.store.get('manifest')), manifest)
  // Both photos had a date, so no camera-date lookups.
  assert.equal(calls.filter(c => c.url.includes('/resources/image/upload/')).length, 0)
})

test('GET /manifest looks up camera dates only for photos with none', async () => {
  const old = { ...boxPhoto, public_id: 'old_photo', display_name: 'old_photo', context: {} }
  route('https://api.cloudinary.com/v1_1/demo/resources/image/upload/old_photo', () =>
    jsonResponse({ image_metadata: { DateTimeOriginal: '2018:01:02 03:04:05' } })
  )
  route('https://api.cloudinary.com/v1_1/demo/resources/image', () => jsonResponse({ resources: [boxPhoto, old] }))
  const res = await worker.fetch(new Request('https://uploader.example.workers.dev/manifest'), { ...env, MANIFEST: fakeKv() })
  assert.deepEqual((await res.json())[0].dates, ['2018-01-02T03:04:05', '2024-02-01T09:00:00'])
  const lookups = calls.filter(c => c.url.includes('/resources/image/upload/'))
  assert.equal(lookups.length, 1)
  assert.equal(new URL(lookups[0].url).searchParams.get('image_metadata'), 'true')
})

test('GET /manifest reports a Cloudinary failure so the site can fall back', async () => {
  route('https://api.cloudinary.com/', () => jsonResponse({ error: { message: 'down' } }, 500))
  const res = await worker.fetch(new Request('https://uploader.example.workers.dev/manifest'), { ...env, MANIFEST: fakeKv() })
  assert.equal(res.status, 502)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
})

test('without KV, a manifest built by publish is reused for a while', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://api.cloudinary.com/v1_1/demo/resources/image', () => jsonResponse({ resources: [boxPhoto] }))
  route('https://api.github.com/', () => new Response(null, { status: 204 }))
  await worker.fetch(post('/publish', {}), env)
  const before = calls.length
  const res = await worker.fetch(new Request('https://uploader.example.workers.dev/manifest'), env)
  assert.deepEqual((await res.json()).map(e => e.dir), ['Box'])
  assert.equal(calls.length, before)
})

// ── Hiding and deleting ───────────────────────────────────────────────────────

const basicAuth = `Basic ${btoa('key:secret')}`

// A Cloudinary folder listing as resources/by_asset_folder returns it.
function folderRoute(byFolder) {
  route('https://api.cloudinary.com/v1_1/demo/resources/by_asset_folder', url => {
    const folder = new URL(url).searchParams.get('asset_folder')
    return jsonResponse({ resources: (byFolder[folder] ?? []).map(public_id => ({ public_id, resource_type: 'image', type: 'upload' })) })
  })
}

function cloudinaryCalls(path) {
  return calls.filter(c => c.url.startsWith(`https://api.cloudinary.com/v1_1/demo/${path}`))
}

test('chunks splits into batches', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunks([], 2), [])
})

test('list groups every photo by project, hidden ones included', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  route('https://api.cloudinary.com/v1_1/demo/resources/image', url => {
    const cursor = new URL(url).searchParams.get('next_cursor')
    if (!cursor) {
      return jsonResponse({
        next_cursor: 'page2',
        resources: [
          { public_id: 'a1', asset_folder: 'images/box', secure_url: 'https://x/a1', created_at: '2024-01-01T00:00:00Z', tags: [], context: { custom: { taken: '2023-05-01T10:00:00' } } },
          { public_id: 'a2', asset_folder: 'images/box', secure_url: 'https://x/a2', created_at: '2024-01-02T00:00:00Z', tags: [HIDDEN_TAG] },
          { public_id: 'loose', asset_folder: 'images', secure_url: 'https://x/loose', tags: [] },
          { public_id: 'deep', asset_folder: 'images/box/old', secure_url: 'https://x/deep', tags: [] },
        ],
      })
    }
    return jsonResponse({
      resources: [
        { public_id: 'b1', asset_folder: 'images/baptism crosses', secure_url: 'https://x/b1', created_at: '2024-02-01T00:00:00Z', tags: [HIDDEN_PROJECT_TAG], context: { custom: { product: 'Baptism Crosses' } } },
        { public_id: 'b2', asset_folder: 'images/baptism crosses', secure_url: 'https://x/b2', created_at: '2024-02-02T00:00:00Z' },
      ],
    })
  })

  const res = await worker.fetch(post('/list', {}), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    projects: [
      {
        assetFolder: 'images/box',
        product: null,
        hidden: false,
        photos: [
          { publicId: 'a1', url: 'https://x/a1', taken: '2023-05-01T10:00:00', hidden: false },
          { publicId: 'a2', url: 'https://x/a2', taken: '2024-01-02T00:00:00Z', hidden: true },
        ],
      },
      {
        assetFolder: 'images/baptism crosses',
        product: 'Baptism Crosses',
        hidden: true,
        photos: [
          { publicId: 'b1', url: 'https://x/b1', taken: '2024-02-01T00:00:00Z', hidden: false },
          { publicId: 'b2', url: 'https://x/b2', taken: '2024-02-02T00:00:00Z', hidden: false },
        ],
      },
    ],
  })

  const lists = cloudinaryCalls('resources/image')
  assert.equal(lists.length, 2)
  const first = new URL(lists[0].url).searchParams
  assert.equal(first.get('tags'), 'true')
  assert.equal(first.get('context'), 'true')
  assert.equal(first.get('max_results'), '500')
  assert.equal(new URL(lists[1].url).searchParams.get('next_cursor'), 'page2')
  assert.equal(lists[0].init.headers.Authorization, basicAuth)
})

test('hiding photos tags them with a signed request', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  folderRoute({ 'images/box': ['a1', 'a2', 'a3'] })
  route('https://api.cloudinary.com/v1_1/demo/image/tags', () => jsonResponse({ public_ids: ['a1', 'a3'] }))

  const res = await worker.fetch(post('/hide', { assetFolder: 'images/box', publicIds: ['a1', 'a3'], hidden: true }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { changed: 2 })

  const listing = cloudinaryCalls('resources/by_asset_folder')[0]
  assert.equal(new URL(listing.url).searchParams.get('asset_folder'), 'images/box')
  assert.equal(listing.init.headers.Authorization, basicAuth)

  const [tagCall] = cloudinaryCalls('image/tags')
  const form = tagCall.init.body
  assert.equal(form.get('command'), 'add')
  assert.equal(form.get('tag'), HIDDEN_TAG)
  assert.deepEqual(form.getAll('public_ids[]'), ['a1', 'a3'])
  assert.equal(form.get('api_key'), 'key')
  const signed = { command: 'add', public_ids: 'a1,a3', tag: HIDDEN_TAG, timestamp: form.get('timestamp') }
  assert.equal(form.get('signature'), await cloudinarySignature(signed, 'secret'))
})

test('showing a project removes the project tag from all its photos', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  folderRoute({ 'images/baptism crosses': ['b1', 'b2'] })
  route('https://api.cloudinary.com/v1_1/demo/image/tags', () => jsonResponse({}))

  const res = await worker.fetch(post('/hide', { assetFolder: 'images/baptism crosses', project: true, hidden: false }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { changed: 2 })
  const form = cloudinaryCalls('image/tags')[0].init.body
  assert.equal(form.get('command'), 'remove')
  assert.equal(form.get('tag'), HIDDEN_PROJECT_TAG)
  assert.deepEqual(form.getAll('public_ids[]'), ['b1', 'b2'])
})

test('refuses to touch photos from another project', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  folderRoute({ 'images/box': ['a1'] })
  for (const [path, extra] of [['/hide', { hidden: true }], ['/delete', {}]]) {
    const res = await worker.fetch(post(path, { assetFolder: 'images/box', publicIds: ['a1', 'elsewhere'], ...extra }), env)
    assert.equal(res.status, 400, path)
    assert.match((await res.json()).error, /elsewhere/)
  }
  assert.equal(cloudinaryCalls('image/tags').length, 0)
  assert.equal(calls.filter(c => c.init.method === 'DELETE').length, 0)
})

test('refuses unclear hide and delete requests before calling Cloudinary', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  const bad = [
    ['/hide', { assetFolder: 'images/box', publicIds: ['a1'] }],
    ['/hide', { assetFolder: 'images/box', hidden: true }],
    ['/delete', { assetFolder: 'images/box' }],
    ['/delete', { assetFolder: 'images/box', project: 'yes' }],
    ['/delete', { assetFolder: 'images/box', publicIds: [] }],
    ['/delete', { assetFolder: 'images/box', publicIds: [42] }],
    ['/delete', { assetFolder: 'box', project: true }],
    ['/delete', { assetFolder: 'images/box/extra', project: true }],
    ['/delete', { assetFolder: '../box', project: true }],
  ]
  for (const [path, body] of bad) {
    const res = await worker.fetch(post(path, body), env)
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  assert.equal(calls.filter(c => c.url.startsWith('https://api.cloudinary.com')).length, 0)
})

test('deleting photos deletes only those, and keeps the folder', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  folderRoute({ 'images/box': ['a1', 'a2', 'a3'] })
  route('https://api.cloudinary.com/v1_1/demo/resources/image/upload', () =>
    jsonResponse({ deleted: { a2: 'deleted', a3: 'not_found' }, partial: false })
  )

  const res = await worker.fetch(post('/delete', { assetFolder: 'images/box', publicIds: ['a2', 'a3'] }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { deleted: ['a2', 'a3'] })

  const deletes = calls.filter(c => c.init.method === 'DELETE')
  assert.equal(deletes.length, 1)
  assert.equal(deletes[0].init.headers.Authorization, basicAuth)
  assert.deepEqual(new URL(deletes[0].url).searchParams.getAll('public_ids[]'), ['a2', 'a3'])
})

test('deleting a project deletes its photos in batches of 100, then its folder', async () => {
  route('https://oauth2.googleapis.com/tokeninfo', () => jsonResponse(ownerTokenInfo))
  const ids = Array.from({ length: 150 }, (_, i) => `p${i}`)
  folderRoute({ 'images/baptism crosses': ids })
  route('https://api.cloudinary.com/v1_1/demo/resources/image/upload', url =>
    jsonResponse({ deleted: Object.fromEntries(new URL(url).searchParams.getAll('public_ids[]').map(id => [id, 'deleted'])) })
  )
  // Cloudinary refuses while it still sees the folder's photos; that's ignored.
  route('https://api.cloudinary.com/v1_1/demo/folders/', () => jsonResponse({ error: { message: 'Folder is not empty' } }, 400))

  const res = await worker.fetch(post('/delete', { assetFolder: 'images/baptism crosses', project: true }), env)
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).deleted, ids)

  const batches = cloudinaryCalls('resources/image/upload').map(c => new URL(c.url).searchParams.getAll('public_ids[]').length)
  assert.deepEqual(batches, [100, 50])
  const folder = cloudinaryCalls('folders/')
  assert.equal(folder.length, 1)
  assert.equal(folder[0].url, 'https://api.cloudinary.com/v1_1/demo/folders/images/baptism%20crosses')
  assert.equal(folder[0].init.method, 'DELETE')
})

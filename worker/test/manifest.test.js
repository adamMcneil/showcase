import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest, exifToIso, isProjectFolder, knownDates, undated } from '../src/manifest.js'

function photo(publicId, assetFolder, extra = {}) {
  return {
    public_id: publicId,
    asset_folder: assetFolder,
    display_name: publicId,
    created_at: '2025-01-01T00:00:00Z',
    tags: [],
    ...extra,
  }
}

const taken = date => ({ context: { custom: { taken: date } } })

test('project folders are exactly one level under the root', () => {
  assert.equal(isProjectFolder('images/box'), true)
  assert.equal(isProjectFolder('images/baptism crosses'), true)
  for (const f of ['images', 'images/box/old', '', undefined, 'images/', '/box']) assert.equal(isProjectFolder(f), false, f)
})

test('groups photos into projects, oldest photo first, newest project first', () => {
  const manifest = buildManifest(
    [
      photo('b2', 'images/bench', taken('2024-06-02T00:00:00')),
      photo('b1', 'images/bench', taken('2024-06-01T00:00:00')),
      photo('t1', 'images/table', taken('2025-03-01T00:00:00')),
      photo('stray', 'images'),
      photo('deep', 'images/bench/old'),
    ],
    { cloud: 'demo' }
  )
  assert.deepEqual(
    manifest.map(e => [e.dir, e.assetFolder, e.added, e.dates]),
    [
      ['Table', 'images/table', '2025-03-01T00:00:00', ['2025-03-01T00:00:00']],
      ['Bench', 'images/bench', '2024-06-01T00:00:00', ['2024-06-01T00:00:00', '2024-06-02T00:00:00']],
    ]
  )
  assert.deepEqual(manifest[1].files, [
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/b1',
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/b2',
  ])
  assert.equal(manifest[1].thumb, 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_600/b1')
  assert.equal(manifest[1].first, manifest[1].files[0])
})

test('leaves out hidden photos, and whole projects with any photo tagged hidden-project', () => {
  const manifest = buildManifest(
    [
      photo('a1', 'images/a', { tags: ['hidden'] }),
      photo('a2', 'images/a'),
      photo('b1', 'images/b', { tags: ['hidden-project'] }),
      photo('b2', 'images/b'), // added after the project was hidden
      photo('c1', 'images/c', { tags: ['hidden'] }),
    ],
    { cloud: 'demo' }
  )
  assert.deepEqual(manifest.map(e => e.assetFolder), ['images/a'])
  assert.deepEqual(manifest[0].files, ['https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/a2'])
})

test('names come from folders.json, then the saved product name, then the folder', () => {
  const manifest = buildManifest(
    [
      photo('a', 'images/catan', { context: { custom: { product: 'Ignored' } } }),
      photo('b', 'images/megs-island', { context: { custom: { product: "Meg's Island" } } }),
      photo('c', 'images/end-table'),
    ],
    { cloud: 'demo', names: { catan: 'Catan Board' } }
  )
  assert.deepEqual(manifest.map(e => e.dir).sort(), ['Catan Board', 'End Table', "Meg's Island"])
})

test('the photo named "first" is the cover', () => {
  const [entry] = buildManifest(
    [photo('one_abc123', 'images/box', taken('2024-01-01')), photo('first_def456', 'images/box', taken('2024-05-01'))],
    { cloud: 'demo' }
  )
  assert.match(entry.thumb, /\/first_def456$/)
  assert.match(entry.files[0], /\/one_abc123$/)
})

test('dates: known, then the uploader\'s, then EXIF, then the upload date', () => {
  const [entry] = buildManifest(
    [
      photo('known', 'images/box', taken('2030-01-01')),
      photo('uploader', 'images/box', taken('2021-01-01T00:00:00')),
      photo('exif', 'images/box'),
      photo('uploaded', 'images/box', { created_at: '2023-01-01T00:00:00Z' }),
    ],
    { cloud: 'demo', known: { known: '2020-01-01T00:00:00' }, exif: { exif: '2022-01-01T00:00:00' } }
  )
  assert.deepEqual(entry.dates, ['2020-01-01T00:00:00', '2021-01-01T00:00:00', '2022-01-01T00:00:00', '2023-01-01T00:00:00Z'])
})

test('known dates round-trip through a built manifest, old URL style included', () => {
  const built = buildManifest([photo('4499.jpg_qkect1', 'images/box', taken('2024-01-01T00:00:00'))], { cloud: 'demo' })
  assert.deepEqual(knownDates(built), { '4499.jpg_qkect1': '2024-01-01T00:00:00' })
  const old = [{ files: ['https://res.cloudinary.com/d/image/upload/f_auto,q_auto/PXL_1_abc?_a=BAMAOGfk0'], dates: ['2026-11-16T19:36:38'] }]
  assert.deepEqual(knownDates(old), { PXL_1_abc: '2026-11-16T19:36:38' })
  assert.deepEqual(knownDates(null), {})
})

test('undated lists project photos with no known or uploader date', () => {
  const resources = [
    photo('known', 'images/box'),
    photo('uploader', 'images/box', taken('2024-01-01')),
    photo('needs-exif', 'images/box'),
    photo('not-a-project', 'images'),
  ]
  assert.deepEqual(undated(resources, { known: '2020-01-01' }), ['needs-exif'])
})

test('EXIF dates become ISO dates', () => {
  assert.equal(exifToIso('2026:04:11 01:53:08'), '2026-04-11T01:53:08')
  assert.equal(exifToIso('nonsense'), null)
  assert.equal(exifToIso(undefined), null)
})

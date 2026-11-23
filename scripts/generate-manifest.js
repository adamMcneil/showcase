#!/usr/bin/env node
// Generates public/images-manifest.json.
//
// Cloudinary mode: lists every project folder under the root (e.g. images/).
//   folders.json is optional — use it to override display names.
//
// Local mode: scans all subdirectories of images/.

require('dotenv').config()
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outFile = path.join(root, 'public', 'images-manifest.json')

// Load name overrides from folders.json if it exists
function loadNameOverrides() {
  const foldersFile = path.join(root, 'folders.json')
  if (!fs.existsSync(foldersFile)) return {}
  const entries = JSON.parse(fs.readFileSync(foldersFile, 'utf8'))
  const map = {}
  for (const e of entries) {
    if (typeof e === 'object' && e.folder && e.name) map[e.folder] = e.name
  }
  return map
}

function toTitle(folder) {
  return folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Cloudinary ────────────────────────────────────────────────────────────────

// The site reads the manifest live from the uploader Worker (GET /manifest);
// this static copy is what it falls back to. Both are built by
// worker/src/manifest.js, so they agree on hidden photos, names and dates.
async function fromCloudinary(nameOverrides) {
  const { buildManifest, exifToIso, knownDates, undated } = await import('../worker/src/manifest.js')
  const cloudinary = require('cloudinary').v2
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })

  const resources = []
  let nextCursor
  do {
    const res = await new Promise((resolve, reject) =>
      cloudinary.api.resources({ max_results: 500, context: true, tags: true, next_cursor: nextCursor }, (err, r) =>
        err ? reject(err) : resolve(r)
      )
    )
    resources.push(...res.resources)
    nextCursor = res.next_cursor
  } while (nextCursor)

  // Photo date: the one already in this file, else the Google Photos date saved
  // by the uploader, else the camera (EXIF) date, else the upload date. EXIF
  // costs one Admin API call per photo and the free plan allows 500 an hour, so
  // dates already worked out are reused.
  const known = fs.existsSync(outFile) ? knownDates(JSON.parse(fs.readFileSync(outFile, 'utf8'))) : {}
  const missing = undated(resources, known)
  console.log(`${resources.length} assets, fetching EXIF dates for ${missing.length} new ones...`)
  const exif = {}
  const CONCURRENCY = 10
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async id => {
        const details = await new Promise((resolve, reject) =>
          cloudinary.api.resource(id, { image_metadata: true }, (err, r) => (err ? reject(err) : resolve(r)))
        )
        const meta = details.image_metadata ?? {}
        const date = exifToIso(meta.DateTimeOriginal) ?? exifToIso(meta.CreateDate)
        if (date) exif[id] = date
      })
    )
  }

  return buildManifest(resources, { cloud: process.env.CLOUDINARY_CLOUD_NAME, names: nameOverrides, known, exif })
}

// ── Local fallback ────────────────────────────────────────────────────────────

function fromLocal(nameOverrides) {
  const imagesDir = path.join(root, 'images')
  if (!fs.existsSync(imagesDir)) return []

  const isImage = name => /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name)
  const result = []

  const dirs = fs.readdirSync(imagesDir, { withFileTypes: true }).filter(d => d.isDirectory())
  for (const d of dirs) {
    const files = fs.readdirSync(path.join(imagesDir, d.name)).filter(isImage).sort()
    if (files.length === 0) continue
    const posix = files.map(f => path.posix.join('images', d.name, f))
    const firstIdx = files.findIndex(f => f.toLowerCase() === 'first.jpg')
    const first = firstIdx !== -1 ? posix[firstIdx] : posix[0]
    result.push({
      dir: nameOverrides[d.name] ?? toTitle(d.name),
      thumb: first,
      first,
      files: posix,
    })
  }

  return result.sort((a, b) => a.dir.localeCompare(b.dir))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const nameOverrides = loadNameOverrides()

  let result
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    console.log('Generating manifest from Cloudinary...')
    result = await fromCloudinary(nameOverrides)
  } else {
    const imagesDir = path.join(root, 'images')
    if (!fs.existsSync(imagesDir)) {
      console.log('No CLOUDINARY_CLOUD_NAME and no images/ dir — skipping manifest generation.')
      return
    }
    console.log('No CLOUDINARY_CLOUD_NAME set, using local images/...')
    result = fromLocal(nameOverrides)
  }

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
  console.log('Wrote', outFile, 'with', result.length, 'entries')
}

main().catch(e => { console.error(e); process.exit(1) })

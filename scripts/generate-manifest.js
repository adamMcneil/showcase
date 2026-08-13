#!/usr/bin/env node
// Generates images-manifest.json.
//
// Cloudinary mode: queries all folders under showcase/ automatically.
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

async function fromCloudinary(nameOverrides) {
  const cloudinary = require('cloudinary').v2
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })

  const thumb = id => cloudinary.url(id, {
    secure: true,
    transformation: [{ width: 600, fetch_format: 'auto', quality: 'auto' }],
  })
  const full = id => cloudinary.url(id, { secure: true, fetch_format: 'auto', quality: 'auto' })

  // EXIF dates look like "2026:04:11 01:53:08" — convert to ISO for sorting/display
  const exifToIso = s => {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s ?? '')
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : null
  }

  // Fetch all resources using dynamic folder mode (asset_folder grouping)
  const assets = [] // { folder, name, public_id, created_at }
  let nextCursor
  do {
    const res = await new Promise((resolve, reject) =>
      cloudinary.api.resources({ max_results: 500, next_cursor: nextCursor }, (err, r) =>
        err ? reject(err) : resolve(r)
      )
    )
    for (const r of res.resources) {
      const assetFolder = r.asset_folder ?? ''
      // Only include assets one level under the root folder (e.g. images/<folder>)
      const parts = assetFolder.split('/')
      if (parts.length !== 2) continue
      const [, folder] = parts
      // Strip the Cloudinary-appended suffix (_xxxxxx) to recover the original filename
      const name = r.display_name.replace(/_[a-z0-9]+$/i, '')
      assets.push({ folder, name, public_id: r.public_id, created_at: r.created_at })
    }
    nextCursor = res.next_cursor
  } while (nextCursor)

  // EXIF is only exposed by the per-asset details endpoint, so fetch it for
  // each asset (a few at a time) and prefer the date the photo was taken,
  // falling back to upload date when EXIF is missing.
  console.log(`Fetching EXIF dates for ${assets.length} assets...`)
  const CONCURRENCY = 10
  for (let i = 0; i < assets.length; i += CONCURRENCY) {
    await Promise.all(
      assets.slice(i, i + CONCURRENCY).map(async a => {
        const details = await new Promise((resolve, reject) =>
          cloudinary.api.resource(a.public_id, { image_metadata: true }, (err, r) =>
            err ? reject(err) : resolve(r)
          )
        )
        const meta = details.image_metadata ?? {}
        a.taken = exifToIso(meta.DateTimeOriginal) ?? exifToIso(meta.CreateDate) ?? a.created_at
      })
    )
  }

  const groups = {} // folder -> [{ name, public_id, taken }]
  for (const a of assets) {
    if (!groups[a.folder]) groups[a.folder] = []
    groups[a.folder].push(a)
  }

  const result = []
  for (const [folder, items] of Object.entries(groups)) {
    // Oldest photo first within a folder
    items.sort((a, b) => a.taken.localeCompare(b.taken))
    const firstItem = items.find(i => i.name.toLowerCase() === 'first') ?? items[0]
    // Date of the folder = earliest photo taken in it
    const added = items[0].taken
    result.push({
      dir: nameOverrides[folder] ?? toTitle(folder),
      added,
      thumb: thumb(firstItem.public_id),
      first: full(firstItem.public_id),
      files: items.map(i => full(i.public_id)),
      dates: items.map(i => i.taken),
    })
  }

  // Newest folders first
  return result.sort((a, b) => b.added.localeCompare(a.added))
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

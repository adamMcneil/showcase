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
const outFile = path.join(root, 'images-manifest.json')

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

  // Fetch all resources under showcase/
  let resources = []
  let nextCursor
  do {
    const res = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'showcase/',
      max_results: 500,
      next_cursor: nextCursor,
    })
    resources = resources.concat(res.resources)
    nextCursor = res.next_cursor
  } while (nextCursor)

  // Group by folder
  const groups = {}
  for (const r of resources) {
    const parts = r.public_id.split('/')  // ['showcase', 'folder', 'file']
    if (parts.length < 3) continue
    const folder = parts[1]
    if (!groups[folder]) groups[folder] = []
    groups[folder].push({ file: parts[2], public_id: r.public_id })
  }

  const result = []
  for (const [folder, items] of Object.entries(groups)) {
    items.sort((a, b) => a.file.localeCompare(b.file))
    const firstItem = items.find(i => i.file.toLowerCase() === 'first') ?? items[0]
    result.push({
      dir: nameOverrides[folder] ?? toTitle(folder),
      thumb: thumb(firstItem.public_id),
      first: full(firstItem.public_id),
      files: items.map(i => full(i.public_id)),
    })
  }

  return result.sort((a, b) => a.dir.localeCompare(b.dir))
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
    console.log('No CLOUDINARY_CLOUD_NAME set, using local images/...')
    result = fromLocal(nameOverrides)
  }

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
  console.log('Wrote', outFile, 'with', result.length, 'entries')
}

main().catch(e => { console.error(e); process.exit(1) })

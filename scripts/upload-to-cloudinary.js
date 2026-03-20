#!/usr/bin/env node
// Uploads images from images/ to Cloudinary based on folders.json.
// Images are uploaded to showcase/<folder>/<filename_without_ext>.
// Skips files that already exist in Cloudinary (overwrite: false).
//
// Usage: npm run upload

require('dotenv').config()
const cloudinary = require('cloudinary').v2
const fs = require('fs')
const path = require('path')

if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.error('Missing CLOUDINARY_CLOUD_NAME. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const root = path.join(__dirname, '..')
const imagesDir = path.join(root, 'images')

function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(name)
}

function loadFolders() {
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'folders.json'), 'utf8'))
  return entries.map(e => typeof e === 'string' ? { folder: e } : e)
}

async function uploadFile(filePath, publicId) {
  try {
    await cloudinary.uploader.upload(filePath, {
      public_id: publicId,
      overwrite: false,
      resource_type: 'image',
    })
    return 'uploaded'
  } catch (e) {
    // Cloudinary returns 400 when the public_id already exists with overwrite:false
    if (e?.http_code === 400 || e?.error?.http_code === 400) return 'skipped'
    throw e
  }
}

async function main() {
  const folders = loadFolders()
  let uploaded = 0, skipped = 0, errors = 0

  for (const { folder } of folders) {
    const dirPath = path.join(imagesDir, folder)
    if (!fs.existsSync(dirPath)) {
      console.log(`\n  ✗ images/${folder}/ not found, skipping`)
      continue
    }

    const files = fs.readdirSync(dirPath).filter(isImage).sort()
    if (files.length === 0) continue

    console.log(`\n${folder} (${files.length} image${files.length === 1 ? '' : 's'})`)

    for (const file of files) {
      const basename = path.basename(file, path.extname(file))
      const publicId = `showcase/${folder}/${basename}`
      const filePath = path.join(dirPath, file)

      try {
        const status = await uploadFile(filePath, publicId)
        if (status === 'uploaded') {
          console.log(`  ✓ ${basename}`)
          uploaded++
        } else {
          console.log(`  – ${basename} (already exists)`)
          skipped++
        }
      } catch (e) {
        console.error(`  ✗ ${basename}: ${e?.error?.message ?? e}`)
        errors++
      }
    }
  }

  console.log(`\nDone. ${uploaded} uploaded, ${skipped} skipped, ${errors} errors.`)
  if (uploaded > 0) console.log('Run npm run generate-manifest to update images-manifest.json.')
}

main().catch(e => { console.error(e); process.exit(1) })

#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const imagesDir = path.join(__dirname, '..', 'images')
const outFile = path.join(__dirname, '..', 'src', 'imageIndex.json')

function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name)
}

function main() {
  if (!fs.existsSync(imagesDir)) {
    console.warn('images/ directory not found in repo root; writing empty index')
    fs.writeFileSync(outFile, JSON.stringify([], null, 2))
    return
  }

  const dirs = fs.readdirSync(imagesDir, { withFileTypes: true }).filter(d => d.isDirectory())
  const result = []
  for (const d of dirs) {
    const dirPath = path.join(imagesDir, d.name)
    let files = fs.readdirSync(dirPath).filter(isImage)
    if (files.length === 0) continue
    // sort to get a deterministic order
    files.sort()
    // create relative paths that will work with copied images directory
    const filesPosix = files.map(f => path.posix.join('./images', d.name, f))
    const first = filesPosix[0]
    result.push({ dir: d.name, first, files: filesPosix })
  }

  // sort result by dir name for consistency
  result.sort((a, b) => a.dir.localeCompare(b.dir))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
  console.log('Wrote', outFile, 'with', result.length, 'entries')
}

main()

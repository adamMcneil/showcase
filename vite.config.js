import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

// Serve images/ and images-manifest.json from the project root in dev
function serveLocalAssets() {
  return {
    name: 'serve-local-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        // Strip base prefix if present
        const stripped = url.startsWith('/showcase/') ? url.slice('/showcase'.length) : url
        const local = ['/images-manifest.json'].includes(stripped) || stripped.startsWith('/images/')
        if (!local) return next()
        const filePath = path.join(process.cwd(), stripped)
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
          res.setHeader('Content-Type', mime)
          fs.createReadStream(filePath).pipe(res)
        } else {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  base: '/showcase/',
  plugins: [react(), serveLocalAssets()],
})

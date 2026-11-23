// Builds the gallery's manifest (the list of projects and photos the site
// shows) from a Cloudinary resource listing. Shared by the Worker, which serves
// it live at GET /manifest, and scripts/generate-manifest.js, which writes the
// static copy in public/ that the site falls back to.

// Hidden photos stay in Cloudinary but the site leaves them out. Tags, not
// context, because adding or removing one tag leaves the photo's other
// metadata alone.
export const HIDDEN_TAG = 'hidden'
// Put on every photo of a hidden project. A project is hidden while any of its
// photos has it, so photos added later stay hidden too.
export const HIDDEN_PROJECT_TAG = 'hidden-project'

// Projects are the folders one level under the root, e.g. images/<project>.
export function isProjectFolder(assetFolder) {
  const parts = String(assetFolder ?? '').split('/')
  return parts.length === 2 && parts.every(Boolean)
}

export function toTitle(folder) {
  return folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function contextOf(r) {
  return r.context?.custom ?? r.context ?? {}
}

// Dates already worked out for photos in a manifest, keyed by public ID.
export function knownDates(manifest) {
  const known = {}
  for (const entry of manifest ?? []) {
    ;(entry.files ?? []).forEach((url, i) => {
      const m = /\/upload\/[^/]+\/([^?]+)/.exec(url)
      if (m && entry.dates?.[i]) known[decodeURIComponent(m[1])] = entry.dates[i]
    })
  }
  return known
}

// Photos the manifest has no date for yet: not in `known`, and not dated by the
// uploader (context "taken"). Their camera (EXIF) date costs one API call each.
export function undated(resources, known) {
  return resources
    .filter(r => isProjectFolder(r.asset_folder) && !known[r.public_id] && !contextOf(r).taken)
    .map(r => r.public_id)
}

// EXIF dates look like "2026:04:11 01:53:08".
export function exifToIso(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : null
}

// resources: Cloudinary Admin API resources, listed with tags and context.
// names: folder → display name overrides (folders.json).
// known: public ID → date from an earlier manifest; exif: public ID → EXIF date.
export function buildManifest(resources, { cloud, names = {}, known = {}, exif = {} }) {
  const base = `https://res.cloudinary.com/${cloud}/image/upload`
  const thumb = id => `${base}/f_auto,q_auto,w_600/${encodeURI(id)}`
  const full = id => `${base}/f_auto,q_auto/${encodeURI(id)}`

  const photos = resources
    .filter(r => isProjectFolder(r.asset_folder))
    .map(r => {
      const context = contextOf(r)
      return {
        folder: r.asset_folder.split('/')[1],
        assetFolder: r.asset_folder,
        // Strip Cloudinary's random suffix (_xxxxxx) to get the file name back.
        name: String(r.display_name ?? r.public_id).replace(/_[a-z0-9]+$/i, ''),
        publicId: r.public_id,
        taken: known[r.public_id] ?? context.taken ?? exif[r.public_id] ?? r.created_at ?? '',
        product: context.product,
        tags: r.tags ?? [],
      }
    })

  const hiddenFolders = new Set(photos.filter(p => p.tags.includes(HIDDEN_PROJECT_TAG)).map(p => p.folder))
  const shown = photos.filter(p => !p.tags.includes(HIDDEN_TAG) && !hiddenFolders.has(p.folder))

  const groups = new Map()
  for (const p of shown) {
    if (!groups.has(p.folder)) groups.set(p.folder, [])
    groups.get(p.folder).push(p)
  }

  const result = []
  for (const [folder, items] of groups) {
    items.sort((a, b) => a.taken.localeCompare(b.taken)) // oldest photo first
    const cover = items.find(i => i.name.toLowerCase() === 'first') ?? items[0]
    result.push({
      dir: names[folder] ?? items.find(i => i.product)?.product ?? toTitle(folder),
      assetFolder: items[0].assetFolder,
      added: items[0].taken, // a project is dated by its earliest photo
      thumb: thumb(cover.publicId),
      first: full(cover.publicId),
      files: items.map(i => full(i.publicId)),
      dates: items.map(i => i.taken),
    })
  }
  return result.sort((a, b) => b.added.localeCompare(a.added)) // newest projects first
}

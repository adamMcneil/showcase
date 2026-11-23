import folders from '../../folders.json'

const NAMES = Object.fromEntries(folders.filter(e => e?.folder && e?.name).map(e => [e.folder, e.name]))

// Same order as scripts/generate-manifest.js: folders.json, then the name the
// admin page saved on the photos, then the folder name in title case.
export function projectName(assetFolder, product) {
  const folder = assetFolder.split('/')[1] ?? assetFolder
  return NAMES[folder] ?? product ?? folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Shapes the uploader's /list result: photos oldest first, projects newest
// first, like the site.
export function toProjects(list) {
  const byTaken = (a, b) => (a.taken ?? '').localeCompare(b.taken ?? '')
  return list
    .map(p => ({
      assetFolder: p.assetFolder,
      name: projectName(p.assetFolder, p.product),
      hidden: p.hidden,
      photos: [...p.photos].sort(byTaken),
    }))
    .sort((a, b) => (b.photos[0]?.taken ?? '').localeCompare(a.photos[0]?.taken ?? ''))
}

// Photos the site shows for a project.
export function shownCount(project) {
  return project.hidden ? 0 : project.photos.filter(p => !p.hidden).length
}

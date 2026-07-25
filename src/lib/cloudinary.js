// Returns a Cloudinary delivery URL constrained to the given width.
// Leaves non-Cloudinary URLs (local mode) untouched.
export function sized(url, w) {
  if (!url || !url.includes('/upload/')) return url
  if (/\/upload\/[^/]*[a-z]_[^/]*\//.test(url)) {
    return url.replace(/\/upload\/([^/]*)\//, (_, t) => {
      const parts = t.split(',').filter(p => p && !/^w_\d+$/.test(p))
      parts.push(`w_${w}`)
      return `/upload/${parts.join(',')}/`
    })
  }
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${w}/`)
}

// Size used for full-screen viewing; single size so preloads always hit cache.
export const FULL_WIDTH = 1600

export function full(url) {
  return sized(url, FULL_WIDTH)
}

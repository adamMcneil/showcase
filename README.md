# Showcase Gallery

Small React (Vite) app that displays the first image from each folder in the repository's `images/` directory. Includes a GitHub Actions workflow that builds and deploys the site to GitHub Pages on push to `main`.

How it works
- `scripts/generate-manifest.js` scans `images/*` directories and generates `src/imageIndex.json` with objects `{ dir, first }` where `first` is a path like `/images/dir/firstfile.jpg`.
- The React app imports `src/imageIndex.json` and renders a card per folder showing the first image and directory name.
- The GitHub Actions workflow runs `npm run build` and publishes `dist/` to GitHub Pages.

Run locally

1. Install deps:

```bash
npm install
```

2. Run dev server (manifest is regenerated before dev):

```bash
npm run dev
```

3. Build for production:

```bash
npm run build
```

Deployment

On each push to `main`, GitHub Actions will run the build and deploy `dist/` to GitHub Pages. The workflow uses the provided `GITHUB_TOKEN` so no additional secrets are required.

Notes
- Make sure your repository has `images/` with subfolders containing at least one image each.
- If you want the site to be hosted under a repository path (e.g., `https://username.github.io/repo/`) the Vite `base` is set to `./` so it should work for typical GitHub Pages deployments.

# Adding photos from Google Photos

Open **https://adammcneil.github.io/showcase/admin.html** (on your phone is fine; add it to your home screen):

1. Sign in with Google.
2. Pick a project, or type a new project's name.
3. Tap **Open Google Photos**, tick the photos, tap **Done**, and come back to the browser tab.
4. The page copies the photos into Cloudinary and updates the site. They show up straight away.

Picking the same photo twice for the same project doesn't make a duplicate. Videos are skipped.

## Hiding and removing

On the same page, open the **Hide or remove** tab (or go straight to `admin.html#manage`) and pick a project:

- **Hide project** / **Show project** takes the whole project off the site or puts it back.
- Tap photos to select them, then **Hide**, **Show** or **Delete**.
- **Delete project** deletes the project and all its photos.

Each change shows up on the site straight away.

Hiding keeps the photos in Cloudinary. The Worker tags them (`hidden` on a photo, `hidden-project` on every photo of a hidden project), and the site's manifest leaves tagged photos out. A project stays hidden while any of its photos has `hidden-project`, so photos you add to a hidden project stay hidden too. You can hide or show photos in the Cloudinary Media Library by adding or removing those tags.

Deleting removes the photos from Cloudinary, and can't be undone. Photos added from Google Photos are still in Google Photos.

## How it works

```
admin.html (GitHub Pages)  ──sign in──▶ Google
        │  creates a Picker session, polls it, lists the picked photos
        ▼
Uploader Worker (Cloudflare, worker/)
        │  checks the Google token is yours, downloads each photo from Google,
        │  uploads it to Cloudinary <root>/<project>, then rebuilds the manifest
        ▼
KV "showcase-manifest" ◀── GET /manifest ── the site (index.html)

        └─ also starts "Update Image Manifest" ──▶ "Deploy to GitHub Pages"
           (the static copy in public/, which the site falls back to)
```

The site reads its list of projects and photos (the manifest) live from the Worker's `GET /manifest`, which serves it from Cloudflare KV. Each change on the admin page rebuilds it from Cloudinary, so the site never waits for GitHub. If the Worker can't be reached within 3 seconds, the site uses the static `public/images-manifest.json` instead, which the "Update Image Manifest" workflow keeps up to date. Both are built by `worker/src/manifest.js`.

A photo uploaded straight to Cloudinary (not through the admin page) shows up after the next change made on the admin page.

- Google only lets apps read photos you pick, and its download links last an hour and need your Google token, so each photo is copied to Cloudinary when you pick it. Google Photos stays the original.
- The Worker exists because browsers can't download from Google's photo links. It never stores your Google token. It accepts requests only from your Google account (`OWNER_EMAIL`).
- Projects are the Cloudinary folders one level under the root. New projects store their display name on the photos (Cloudinary context `product`), so `folders.json` is only needed to rename a project.
- Photos added here are dated by Google Photos; photos uploaded straight to Cloudinary use their camera (EXIF) date.
- Cloudinary's free plan allows 500 Admin API calls an hour. Visitors cost none, since the Worker serves the manifest from KV. Rebuilding it reuses the dates already worked out and only looks up the camera date of photos it hasn't seen, so a rebuild costs one or two calls. The **Hide or remove** tab costs one or two calls to open and two or three per change.
- The deploy workflow finds or creates the KV namespace `showcase-manifest` with the Cloudflare token. If that fails, the Worker still works without it, rebuilding the manifest about once a minute while the site is being viewed.
- The "Update Image Manifest" workflow runs one at a time and checks out the latest `main`, so several quick changes queue up instead of failing to push. A queued run reads Cloudinary when it starts, so the last one includes every change.

Still done in Cloudinary or `folders.json`: choosing the cover (name it `first`), renaming a project.

## One-time setup

### 1. Google sign-in client

In the [Google Cloud console](https://console.cloud.google.com/), signed in with the Google account that holds your photos:

1. Create a project (any name, e.g. `showcase`).
2. **APIs & Services → Library**: enable **Photos Picker API**.
3. **Google Auth Platform → Branding**: app name `Showcase`, your email as support and developer contact.
4. **Audience**: user type **External**, leave it in **Testing**, and add your Google account under **Test users**.
5. **Data Access → Add or remove scopes**: add `.../auth/photospicker.mediaitems.readonly`.
6. **Clients → Create client**: type **Web application**, authorized JavaScript origin `https://adammcneil.github.io` (add `http://localhost:5173` too if you want to run the page locally). Copy the **Client ID**.

Google shows an "app isn't verified" warning when you sign in. That's expected for a personal app in Testing; continue past it.

### 2. Cloudflare

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/) and open **Workers & Pages** once so it sets up your `workers.dev` subdomain.
2. Copy your **Account ID** (Workers & Pages overview, right side).
3. **My Profile → API Tokens → Create Token**, template **Edit Cloudflare Workers**. Copy the token.

### 3. GitHub token for the Worker

GitHub **Settings → Developer settings → Fine-grained tokens → Generate new token**:
repository access **Only select repositories → showcase**, permission **Actions: Read and write**. Copy it. Note its expiry date; when it expires, the static fallback copy stops updating (the live site doesn't need it) until you replace the secret.

### 4. Repo secrets and variables

In this repo, **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | token from step 2 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | account ID from step 2 |
| Secret | `OWNER_EMAIL` | the Google account that's allowed to add photos |
| Secret | `UPLOADER_GITHUB_TOKEN` | token from step 3 |
| Variable | `GOOGLE_CLIENT_ID` | client ID from step 1 |

The `CLOUDINARY_*` secrets are already there and are reused.

### 5. Deploy

1. **Actions → Deploy Uploader Worker → Run workflow.** The "Deploy" step's log shows the Worker's URL, like `https://showcase-uploader.<subdomain>.workers.dev`.
2. Add a repo **variable** `UPLOADER_URL` with that URL.
3. **Actions → Deploy to GitHub Pages → Run workflow** so the admin page picks up the variables.

If the project list on the admin page says it doesn't include Cloudinary folders, run **Update Image Manifest** once.

## Development

- `npm test` runs the Worker tests (Node 22+).
- `npm run dev` serves the site; the admin page is at `/showcase/admin.html`. It needs `VITE_GOOGLE_CLIENT_ID` and `VITE_UPLOADER_URL` in `.env`.

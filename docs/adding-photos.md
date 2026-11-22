# Adding photos from Google Photos

Open **https://adammcneil.github.io/showcase/admin.html** (on your phone is fine; add it to your home screen):

1. Sign in with Google.
2. Pick a project, or type a new project's name.
3. Tap **Open Google Photos**, tick the photos, tap **Done**, and come back to the browser tab.
4. The page copies the photos into Cloudinary and starts the site update. The site shows them in 2–3 minutes.

Picking the same photo twice for the same project doesn't make a duplicate. Videos are skipped.

## How it works

```
admin.html (GitHub Pages)  ──sign in──▶ Google
        │  creates a Picker session, polls it, lists the picked photos
        ▼
Uploader Worker (Cloudflare, worker/)
        │  checks the Google token is yours, downloads each photo from Google,
        │  uploads it to Cloudinary <root>/<project>, then starts
        ▼
"Update Image Manifest" workflow ──▶ "Deploy to GitHub Pages"
```

- Google only lets apps read photos you pick, and its download links last an hour and need your Google token, so each photo is copied to Cloudinary when you pick it. Google Photos stays the original.
- The Worker exists because browsers can't download from Google's photo links. It never stores your Google token. It accepts requests only from your Google account (`OWNER_EMAIL`).
- The manifest still comes from Cloudinary folders. New projects store their display name on the photos (Cloudinary context `product`), so `folders.json` is only needed to rename a project.
- Photos added here are dated by Google Photos; photos uploaded straight to Cloudinary use their camera (EXIF) date.
- Cloudinary's free plan allows 500 Admin API calls an hour. The manifest script reuses the dates already in `public/images-manifest.json` and only looks up photos it hasn't seen, so a run costs one or two calls.

Still done in Cloudinary or `folders.json`: removing a photo, choosing the cover (name it `first`), renaming a project.

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
repository access **Only select repositories → showcase**, permission **Actions: Read and write**. Copy it. Note its expiry date; when it expires, adding photos fails at "Starting the site update" until you replace the secret.

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

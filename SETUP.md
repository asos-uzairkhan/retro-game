# Setup — Manual Steps

The game is fully implemented as a static site, but it needs a Firebase backend and a
place to host it. An engineer must perform the steps below once.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
   - Name it anything (e.g. `datatech-retro`). Google Analytics is **not** needed.
2. In the project, click the **Web** icon (`</>`) to register a web app.
   - Nickname: `retro-game`. Do **not** tick Firebase Hosting (we use GitHub Pages).
3. Firebase shows a `firebaseConfig` object — keep this tab open, you'll need every
   value in it for step 2 below.
   - `databaseURL` isn't shown until step 4 below — come back for it then.

> **Note on secrecy:** Firebase's web `apiKey` etc. are not secret by design — Google's
> own docs say they're safe to expose client-side, since access control is enforced by
> the security rules (step 5), not by hiding this config. That said, if your security
> team requires it, or you simply don't want infrastructure config sitting in git
> history, follow step 2 to keep it out of source control and inject it via GitHub
> Secrets instead.

## 2. Configure Firebase secrets (instead of committing them)

The repo never contains real Firebase values — [js/firebase-config.js](js/firebase-config.js)
is gitignored, and [js/firebase-config.template.js](js/firebase-config.template.js) is
the committed placeholder. Real values live in two places only:

**For local development**, run `node scripts/generate-firebase-config.js` with the
values from your Firebase project as environment variables:

```powershell
$env:FIREBASE_API_KEY = "..."
$env:FIREBASE_AUTH_DOMAIN = "....firebaseapp.com"
$env:FIREBASE_DATABASE_URL = "https://....firebasedatabase.app"
$env:FIREBASE_PROJECT_ID = "..."
$env:FIREBASE_APP_ID = "..."
node scripts/generate-firebase-config.js
```

This writes `js/firebase-config.js` locally (gitignored, never pushed).

**For the deployed site**, add the same five values as **GitHub Secrets**, which the
deploy workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) injects
at build time:

1. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository
   secret**.
2. Add each of: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`.

The workflow generates `js/firebase-config.js` fresh on every deploy; the file itself
is never committed.

## 3. Enable Anonymous Authentication

1. In the Firebase console: **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab, select **Anonymous**, toggle **Enable**, save.

## 4. Create the Realtime Database

1. In the Firebase console: **Build → Realtime Database → Create Database**.
2. Pick the region closest to the team (e.g. `europe-west1`).
3. Start in **locked mode** (the rules below replace it).
4. Copy the database URL shown at the top (e.g.
   `https://datatech-retro-default-rtdb.europe-west1.firebasedatabase.app`) — you'll
   use it as `FIREBASE_DATABASE_URL` in step 2 and again for the cleanup script
   (step 9).

## 5. Deploy the security rules

1. In **Realtime Database → Rules**, replace the entire contents with the contents of
   [firebase.rules.json](firebase.rules.json).
2. Click **Publish**.

> Note (accepted trade-off, see Design.md §13.2): this is a static app with no server
> code, so game secrets are technically readable by a player who opens dev tools. The
> rules protect against accidental/malicious *writes*, not reads. Do not invest in
> obfuscation for v1.

## 6. Deploy to GitHub Pages

Deployment is automated by [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which builds `js/firebase-config.js` from the secrets configured in step 2 and
publishes the site — no branch juggling needed.

1. Push this repository to GitHub (make sure the five secrets from step 2 are set
   first, or the first deploy will fail).
2. In the repo: **Settings → Pages → Build and deployment → Source**, select
   **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab) and wait
   for the **Deploy to GitHub Pages** workflow to finish; the site will be at
   `https://<org-or-user>.github.io/<repo>/`.

## 7. Authorize the domain for Firebase Auth

1. In the Firebase console: **Authentication → Settings → Authorized domains**.
2. Click **Add domain** and add `<org-or-user>.github.io`.
   (`localhost` is authorized by default, which covers local testing.)

## 8. Smoke test

1. Local test: serve the folder (`python -m http.server 8000` or the VS Code
   Live Server extension — ES modules do not work from `file://`) and open
   `http://localhost:8000`.
2. Create a game in one browser window, join it from a second (private/incognito)
   window — each browser session gets its own anonymous identity.
3. Play through all phases with 2 players: solve rooms, find a clue, reflect,
   vote, reveal, and check the Markdown export on the summary screen.

## 9. Clearing stale game data

Games are never deleted automatically (Design.md §15). To clear stale or all games,
use [scripts/clear-database.js](scripts/clear-database.js) — a one-off Node tool for an
engineer to run manually, not part of the deployed app.

1. **Get a service account key** (one-time, done by an engineer with project access):
   - Firebase console → project **Settings (gear icon) → Service accounts**.
   - Click **Generate new private key** → confirm. A JSON file downloads.
   - Save it outside the repo, or inside it under a name matching `*serviceAccountKey*.json`
     (already gitignored) — never commit this file, it grants full admin access to your
     Firebase project.
2. **Install the script's dependency** (one-time):

   ```powershell
   cd scripts
   npm install
   ```

3. **Run it**, pointing at your key and database:

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
   $env:FIREBASE_DATABASE_URL = "https://....firebasedatabase.app"
   node scripts/clear-database.js --dry-run                # preview only
   node scripts/clear-database.js --older-than-days=7       # delete stale games
   node scripts/clear-database.js --all --yes               # wipe everything, no prompt
   ```

The script uses the Firebase Admin SDK, which bypasses `firebase.rules.json` entirely,
so it can list and delete every game regardless of the client-facing rules. Always run
`--dry-run` first. This is a destructive operation — deleted games cannot be recovered.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Firebase connection failed" toast on load | `js/firebase-config.js` missing or stale — rerun step 2's local generation command |
| Deploy workflow fails at "Generate firebase-config.js" | One or more GitHub Secrets from step 2 are missing |
| `auth/configuration-not-found` | Anonymous sign-in not enabled (step 3) |
| `PERMISSION_DENIED` on every action | Rules not published (step 5) or wrong `databaseURL` |
| Auth works locally but not on GitHub Pages | Domain not authorized (step 7) |
| Blank page, module errors in console | Site opened via `file://` — use a web server |
| `clear-database.js` fails with a credentials error | `GOOGLE_APPLICATION_CREDENTIALS` not set or path is wrong (step 9) |

# Spyret IDE — client-side deployment

The default build runs the Pyret compiler, REPL, Spytial visualization, and Google integration in the browser. Deploy `build/static/` to a static web host. No Express application, Redis database, OAuth client secret, or token-refresh service is required at runtime.

## Build and run

Use Node.js 20 or later, npm, and Make:

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Open http://localhost:4999/editor/. `npm start` is a local file server, with no application API routes. The build creates the `pyret` symlink if needed and builds the compiler bundle. A fresh build can take several minutes. `npm run build:static` is an alias for `npm run build`.

The editor works without Google configuration. File → Open local file imports a program, edits are saved on this device as local drafts, and File → Download exports it. Drafts belong to the browser and origin; clearing site data removes them. A storage failure is shown explicitly. Reloading an unsaved draft restores it; File → New opens a separate draft.

## Optional Google Drive and Sheets

Copy `.env.static.example` to `.env.static`, then fill in these **public** values:

- `GOOGLE_CLIENT_ID`: a Google OAuth client ID for a Web application.
- `GOOGLE_API_KEY`: a browser API key restricted to your deployed origins and the APIs you use.
- `GOOGLE_APP_ID`: the numeric Google Cloud project number, used by Google Picker.

Enable the Drive API, Google Picker API, and Sheets API in that project. Configure the OAuth consent screen (and test users when using testing mode). Register your deployment origin and `http://localhost:4999` as authorized JavaScript origins. The browser token flow uses no Spyret OAuth callback route or client secret.

Run `npm run build` again after changing configuration. The build reads `.env.static`, with explicit environment variables taking precedence; it does not use the legacy server `.env` for public configuration.

Click **Connect to Google Drive** to authorize access. The app requests `drive.file` to save files created by this app or selected through its picker, and `drive.readonly` to open existing files and shared links that your account can read. File → My Programs opens Google Picker. Save, Save a copy, Rename, and Share call Google directly. Enable Google Sheets access from the Pyret menu when needed.

Declare both Drive scopes on the consent screen. `drive.readonly` is a restricted scope and public distribution requires Google's corresponding app verification. It allows direct opening by file ID; `drive.file` alone would require recipients to select private files in Picker first. See [Google's Drive scope requirements](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Access tokens stay in memory. After token expiry or page reload, reconnect through the button. Reconnecting preserves local edits; saving uploads them only after authorization. The status label distinguishes local recovery from a completed Drive save. Disconnect clears the in-memory token; it does not revoke the app's grant in your Google account.

See [Google's browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) and [Drive JavaScript setup](https://developers.google.com/workspace/drive/api/quickstart/js).

## Sharing and images

**Share** saves the current file and provides an IDE link to its latest saved contents. It keeps the file's Drive permissions. Use the Drive link in the dialog to grant access to particular people or enable “Anyone with the link” in Google's Share dialog. A recipient opens the IDE link and connects with a Google account that has access. Public files can also open without signing in. A denied or deleted file shows an access error. Edits to a shared program stay local until the recipient uses **Save a copy**.

Links carry a `resourcekey` when Drive provides one; it is forwarded for both metadata and content reads. Recipients fetch directly from Google with their own access. Old owner-credential links work only if the underlying file's Drive permissions allow the recipient to read it. No owner's credentials, refresh tokens, or sharing database are involved.

Images selected from Drive are embedded as data URLs in the program, so reading them later needs no credentials or image proxy. Arbitrary external image URLs must allow browser access (CORS). Large embedded images increase program and draft sizes.

## Static hosting

Upload the contents of `build/static/`. Serve `.js` as JavaScript and use directory index files (`/editor/` → `/editor/index.html`). HTTPS is required outside localhost for Google authorization. Do not add cross-origin isolation headers that block Google's authorization popups or the external scripts.

For a deployment such as `https://example.com/spyret/`, set `STATIC_BASE_PATH=/spyret` before building and mount the output at that path. `npm start` also honors that prefix. No SPA fallback or dynamic routes are needed.

This is a **client-only application**, not a fully offline distribution: it still loads pinned Spytial assets and Google Charts from CDNs, and Google features and remote imports require network access. Node and Make are build-time tools only.

### GitHub Pages

The included **Deploy static IDE to GitHub Pages** workflow builds, tests, and uploads the static files when run manually. In the GitHub repository:

1. Set Settings → Pages → Source to **GitHub Actions**.
2. Add repository Actions secrets `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, and `GOOGLE_APP_ID` with the public deployment configuration above.
3. Register `https://sidprasad.github.io` as a Google authorized JavaScript origin (no `/spyret` suffix), and allow the deployed pages in the browser API key's HTTP referrer restrictions.
4. Run **Deploy static IDE to GitHub Pages** from Actions. The workflow derives the asset and link prefix from Pages configuration.

For `https://sidprasad.github.io/spyret/`, host this project in a repository named `spyret`. The current `sidprasad/spyret-ide` repository would instead use `/spyret-ide/`. Another option is to place a `/spyret` build in the `spyret` directory of the `sidprasad.github.io` user-site repository.

To preview the intended path locally, run `STATIC_BASE_PATH=/spyret npm run build`, then `npm start` and open `http://localhost:4999/spyret/editor/`. Docker is not needed. See [GitHub's custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Tests

```sh
npm run build
npm run test:client
```

The client tests serve the built files at their configured path with a plain static server and run the actual compiler and Spytial in Chrome. They also cover local draft recovery, simulated Google authorization, and public/private sharing with allowed and denied recipients. They do not use a real Google account. Set `CHROME_BINARY` if Chrome is installed at a nonstandard location. See `test/client-side/`.

The existing runtime regression suites remain available:

```sh
npm run test:constructor-data:unit
npm run test:constructor-data
npm run test:reify-fidelity
```

See [constructor round-trip tests](test/constructor-data/README.md) and [broader fidelity tests](test/reify-fidelity/README.md).

## Legacy server

The original Express implementation remains available through `npm run build:server` and `npm run start:server` for compatibility and comparison. It is not part of the default deployment. See [legacy setup](docs/legacy-server.md). The legacy Parley/project-template routes and Blocks editor are not included in the static distribution.

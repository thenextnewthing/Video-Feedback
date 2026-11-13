# Setup and agent workflow

## Local setup

Run from `assets/app` with Node 22 or newer:

```sh
npm test
npm start
```

Open `http://127.0.0.1:8765`. No installation or account is required. Copy your own MP4 previews to `media/` and replace the example `public/stories.json`. Filenames must match `[a-z0-9][a-z0-9-]{0,95}.mp4`.

This is a single-household review room, not a multi-tenant product. Each installation needs its own storage and privacy boundary. Do not use a shared origin for unrelated households: browser drafts are origin-scoped.

## Phone or remote deployment

The included server binds only to loopback. Put an authenticated HTTPS reverse proxy in front of it and set `PUBLIC_ORIGIN` to the exact public origin. Keep the upstream private; protect all paths, including `/api/media`, `/api/drafts`, `/api/reviews`, and the manifest. Use a provider-supported identity-aware proxy or equivalent trusted authentication. The starter does not configure a proxy, provision accounts, or supply cloud credentials.

Verify an anonymous browser cannot access the page, manifest, video, or feedback; verify authenticated GET and Range requests work. Use persistent disk for `data/`, private backups, and household-specific access. Data is not encrypted by this application at rest; use encrypted disk/storage where needed. No telemetry, email delivery, webhook, transcription service, or agent notification is built in.

Desktop browser speech recognition can use a browser/vendor service; reviewers should understand that their speech may leave the device. On iPhone, use the operating system's keyboard dictation and its privacy controls. Users can always type instead.

## Data and revision contract

Example manifest:

```json
[{"key":"weekend","id":"weekend-v2","title":"A weekend together","filename":"weekend-v2.mp4","duration":42,"credits":""}]
```

Keep `key` stable for links such as `/?video=weekend`; increment `id` whenever the rendered cut changes. Retain earlier MP4s privately if useful. Stars represent current revisions with no submitted review, not whether the video has merely been opened.

- GET `/api/reviews` returns `{reviews:[{id, videoId, savedAt, ...}]}`.
- GET `/api/reviews/{id}` returns the complete submitted review.
- GET `/api/drafts` and `/api/drafts/{id}` are separate unsubmitted snapshots.
- PUT with a UUID receipt is idempotent for exactly the same content; reuse with different content returns 409.
- `overallFeedback` contains text and optional `[m:ss]` anchors; `notes` preserves earlier timestamped notes.
- `finished` is boolean. Only the explicit completion meaning `finished-no-more-editing` marks a finished video.

The agent can read JSON through the API from the authenticated environment or read the private `data/` files on the same machine. Each disk file wraps `{raw, customMetadata}`; parse `raw` to obtain the review. Never commit these files. Keep receipt IDs and last processed revision to avoid applying duplicate instructions. Report missing or malformed feedback directly.

Local drafts survive ordinary reloads, but private mode, clearing browser storage, device loss, or storage quotas can remove them. Server autosave needs connectivity; the UI distinguishes device-only storage from confirmed sync. Multiple devices are last-newest-snapshot selection, not collaborative merging: avoid editing the same video simultaneously on two devices. Keep backups; this starter is not a full archival system.

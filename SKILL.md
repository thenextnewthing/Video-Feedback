---
name: family-video-feedback
description: Set up a private, phone-friendly video review page and turn submitted family-video feedback into an agent edit plan. Use for collecting feedback, tracking revised cuts, and reviewing finished status, not automatic editing or public sharing.
---

# Family Video Feedback

Use the runnable starter in `assets/app/`. It gives reviewers one video, one text box, timestamp insertion, current/all submission, saved drafts, and a finished checkbox. Read [setup and agent workflow](references/workflow.md) when installing or consuming feedback.

## Set up

1. Copy `assets/app` to a private workspace outside a public repository. Run `npm test`, then `npm start` with Node 22+.
2. Put only authorized preview MP4s in `media/`. Configure `public/stories.json`: a stable `key`, a unique revision-specific `id`, `title`, `filename`, optional `duration` and `credits`.
3. Never put family footage, feedback storage, credentials, or private paths into a public Git repository. The bundled examples contain no videos.
4. Default hosting is loopback-only. Remote/mobile use requires a separately configured authenticated HTTPS reverse proxy covering every page, media, and API route. A random URL is not authentication. Verify unauthenticated requests fail before sharing the link.

## Review and revise

- Tell the user what autosave means: drafts are saved, but are not instructions to start editing. `Submit this one` sends the current video's changes; `Submit all` sends outstanding changes for current cuts. The service does not automatically wake an agent.
- Retrieve `/api/reviews`, then `/api/reviews/{id}`. Use the latest submission per exact revision ID. `/api/drafts` is separate: do not treat a newer draft as submitted authorization.
- Read written feedback and finished status. If an old audio attachment is unreadable, say so rather than inventing content. The current interface uses visible dictated text instead of new audio recording.
- `finished: true` with `completionMeaning: finished-no-more-editing` means no further editing unless the user explicitly requests it.
- Apply only authorized edits, preserve the source and previous cut, and verify the result. New cut = new manifest ID, with the same key; this creates a star and avoids mixing old-cut notes with new-cut notes.
- Do not impose one family's music, duration, names, or date-card preferences on every user. Ask or use the user's own editing brief.

## Validation

Verify desktop and phone-sized layout, play/seek, timestamp insertion, local draft recovery, server save/read, current-only/all selection, duplicate/partial failure handling, and finished-only changes. Browser simulations do not prove physical iPhone dictation works: iPhone users tap the keyboard microphone themselves. The page cannot activate it.

Before reporting a deployment complete, check the live page and the privacy boundary. Preserve data on failed deployment. When a saved version can safely be retried, retry that version rather than recreating state.

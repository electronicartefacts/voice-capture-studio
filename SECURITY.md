# Security Policy

Voice Capture Studio is local-first software. Its core security promise is that recordings and
workspace data stay on the user's device unless the user explicitly exports files.

## Supported Versions

Security fixes target the current `main` branch until tagged releases begin.

## Reporting A Vulnerability

Do not open a public issue for a vulnerability that could expose recordings, workspace data, or
browser storage contents. Use GitHub private vulnerability reporting when it is available for this
repository. If private reporting is unavailable, contact the maintainers through Electronic
Artefacts' private support channel and include:

- affected version or commit
- browser and operating system
- reproduction steps
- expected impact
- whether any private data was exposed

## Security Expectations

- No credentials, API keys, recordings, or generated workspaces belong in Git.
- Browser storage is local convenience storage, not cloud backup.
- Microphone access requires a secure context: HTTPS or localhost.
- The app must not upload recordings or workspace metadata without an explicit product decision,
  privacy review, and documentation update.

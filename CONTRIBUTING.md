# Contributing

Voice Capture Studio is a local-first capture tool. Contributions should preserve that privacy
model: user recordings, workspaces, consent records, and generated voice exports must never enter
the repository.

## Development Setup

Requirements:

- Node.js 22 or newer
- npm 11 or newer

Install and validate:

```bash
npm ci
npm run validate
```

Run the app locally:

```bash
npm run dev
```

The app is configured with the GitHub Pages base path. In local development, open the URL shown by
Vite and, when necessary, use `/voice-capture-studio/`.

## Contribution Workflow

1. Open an issue for substantive behavior changes before writing a large patch.
2. Keep domain logic inside `src/domains/*` and browser/UI orchestration inside `src/app/*`.
3. Add or update tests for behavior changes.
4. Run `npm run validate` before submitting a pull request.
5. Keep commits focused and explain user-visible behavior changes in the pull request body.

## Data And Privacy Rules

- Do not commit recordings, generated workspaces, exports, logs, local screenshots with private
  content, or environment files.
- Use neutral fixture identities and synthetic text in tests.
- Do not introduce network upload, telemetry, analytics, or remote processing without an explicit
  privacy review and documentation update.

## Documentation

Update the README or files in `docs/` when you change:

- browser/runtime requirements
- export shapes
- workspace schema
- corpus compatibility rules
- GitHub Pages behavior
- privacy or security posture

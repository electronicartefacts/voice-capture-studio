# Voice Capture Studio

Voice Capture Studio is a local-first browser application for directed voice capture. It helps a
speaker record clean, reviewable takes against a versioned prompt corpus, then exports structured
metadata suitable for downstream voice archive and dataset pipelines.

The project is published by [Electronic Artefacts](https://www.electronicartefacts.com) as an
open-source foundation for privacy-preserving voice capture workflows.

> Voice recordings and generated workspaces are user data. They do not belong in this repository
> and the app does not upload them to a remote service.

## Features

- Guided prompt sessions for French and English starter corpora.
- Local microphone capture through Web Audio.
- WAV PCM mono export at 48 kHz / 24-bit where browser support allows it.
- Room-tone calibration and first-pass technical quality checks.
- Transcript, timing, intent, prosody, and quality metadata for each take.
- Browser-estimated word-to-phoneme alignment for every new take, with explicit forced-alignment
  handoff metadata.
- Keeper/review/reject flow so coverage only advances on accepted material.
- Browser-private workspace storage with explicit downloads and folder export where supported.
- Static GitHub Pages deployment with PWA manifest and service worker support.
- Domain-oriented TypeScript architecture with unit coverage for corpus, workspace, recording, and
  export behavior.

## Live demo

The current build is available on [GitHub Pages](https://electronicartefacts.github.io/voice-capture-studio/).
Run the local preview when you need to inspect a branch or test microphone permissions locally.

## Installation

Requirements:

- Node.js 22 or newer
- npm 11 or newer
- A modern browser with microphone support

Install dependencies:

```bash
npm ci
```

Start the development server:

```bash
npm run dev
```

Build and preview the production app:

```bash
npm run build
npm run preview
```

Because the app is configured for GitHub Pages, the production build is served under
`/voice-capture-studio/`.

## Usage

1. Open the app in a secure browser context: HTTPS or localhost.
2. Select a speaker profile and language.
3. Confirm browser runtime diagnostics and microphone access.
4. Capture room tone before recording keeper material.
5. Record prompted takes and review the quality verdict.
6. Download WAV and JSON exports, or save to a chosen folder where the browser supports the File
   System Access API.

Chrome and Edge currently provide the strongest browser support for the full local workspace flow.
Android Chrome can record and download exports, but folder selection is typically unavailable.

## Development

Core commands:

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run validate
```

`npm run validate` is the CI and release gate. It checks formatting, linting, TypeScript project
references, unit tests, and the production build. `npm run test:e2e` drives the full capture flow
(microphone permission, room tone, take, review) in Chromium with a simulated microphone, plus
workspace persistence across reloads; CI runs it after `validate`.

## Architecture

The repository separates browser orchestration from domain behavior:

```text
src/
  app/        React shell, browser capture, storage adapters, export orchestration
  domains/    Corpus, sessions, workspace, coverage, recording, speakers, settings
  shared/     Shared branded types and language helpers
tests/        Node test runner suites for domain and app services
docs/         Architecture, workspace, corpus, export, and Pages notes
```

Important documents:

- [Architecture doctrine](docs/architecture-doctrine.md)
- [Browser-native engineering manifesto](docs/browser-native-engineering-manifesto.md)
- [System model](docs/system-model.md)
- [Corpus structure](docs/corpus-structure.md)
- [Workspace structure](docs/workspace-structure.md)
- [Export structure](docs/export-structure.md)
- [Capture technology audit](docs/capture-technology-audit.md)
- [Production engineering audit](docs/production-engineering-audit.md)
- [Android and GitHub Pages](docs/android-github-pages.md)

## GitHub Pages

This repository is ready for GitHub Pages through
[`.github/workflows/pages.yml`](.github/workflows/pages.yml). The workflow installs dependencies,
runs `npm run validate`, uploads `dist/`, and deploys with GitHub Pages Actions.

Repository setup:

1. Open repository Settings -> Pages.
2. Set Source to GitHub Actions.
3. Push to `main`.
4. The app will be available at:

```text
https://electronicartefacts.github.io/voice-capture-studio/
```

The app is technically static and can be hosted by GitHub Pages. Microphone access still requires
HTTPS, which GitHub Pages provides.

## Privacy And Security

- No voice data, workspaces, exports, or recordings should be committed.
- The app is local-first and does not upload captured audio.
- Browser storage can be cleared by browser policy or user action; export important work.
- Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Roadmap

- Workspace restore/import for downloaded backups.
- Explicit workspace schema migration pipeline.
- Corpus tombstone support for long-lived compatibility.
- Stronger File System Access first-run flow where supported.
- More export targets once the `voice.capture_session` contract stabilizes.
- Screenshot and release artifact automation for tagged releases.

## Contributing

Contributions are welcome when they preserve the local-first privacy model and domain boundaries.
Read [CONTRIBUTING.md](CONTRIBUTING.md), run `npm run validate`, and do not include private voice
data in issues or pull requests.

GitHub Discussions can be enabled for design ideas, corpus proposals, and workflow questions. A
discussion template is included in `.github/DISCUSSION_TEMPLATE/`.

## License

Voice Capture Studio is released under the [MIT License](LICENSE).

## Acknowledgements

Built with React, Vite, TypeScript, the Web Audio API, and the Node.js test runner.

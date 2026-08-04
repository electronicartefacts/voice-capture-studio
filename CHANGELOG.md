# Changelog

All notable changes to Voice Capture Studio will be documented in this file.

This project follows semantic versioning for public releases.

## [Unreleased]

### Added

- Fifth mode, **Découpe lexicale**, for local audio/video import, on-device
  Whisper word timing, and ZIP export with one WAV per detected word, a JSON
  manifest, a CSV timeline, and the transcript.
- Direct entry into media processing without requesting microphone access.
- Installable PWA screenshots and `SoftwareApplication` structured metadata,
  validated from the production build.
- Explicit workspace schema 1 → 2 migration plus generated unsafe-path and
  multi-session archive stress coverage.
- Signed SLSA provenance and SBOM attestations for every successful `main`
  release archive.

### Changed

- Dataset download and folder export lifecycles now share a dedicated
  cancellable React controller outside the central capture orchestrator.
- Upgraded the build/runtime baseline to Vite 8, React tooling 6, Lucide 1 and
  stable ONNX Runtime Web 1.27; the full local Whisper/VAD inference gate passes.

## [0.1.0] - 2026-07-09

### Added

- Initial public source release.
- Local-first Vite/React voice capture studio.
- Browser microphone capture with WAV PCM export.
- Canonical bilingual corpus seed data.
- Workspace progress, coverage, and export metadata models.
- GitHub Pages deployment workflow.
- Validation scripts for formatting, linting, typechecking, tests, and builds.

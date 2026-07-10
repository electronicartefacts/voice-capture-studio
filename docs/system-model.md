# System Model

This document describes the architecture currently observed in code. It is intentionally descriptive:
it records how Voice Capture Studio works today, not a target architecture imposed from outside.

## Product Shape

Voice Capture Studio is a local-first directed capture studio for clean voice takes. Its current
runtime is a static Vite/React app that produces browser-side WAV recordings, local workspace
progress, and Forge-shaped `voice.capture_session` metadata.

The repository owns source code, corpus definitions, seed speaker identities, language metadata,
documentation, and deployment configuration. User voice data belongs outside the repository.

## Runtime Flow

1. `src/app/main.tsx` boots the React shell and registers the production service worker.
2. `App` opens `workspace.local.main` through `createBrowserWorkspaceRepository`, which returns
   both the normalized workspace and its current durability (`persistent` or `memory-only`).
3. Opened workspaces are reconciled through `reconcileWorkspaceProgress`, so keeper takes stored in
   `capturedSessions` repair a missing or stale `corpusProgress` projection before planning.
4. If no workspace exists, `createEmptyWorkspace` seeds speakers, settings, and an empty progress
   projection.
5. `inspectRuntime` computes browser capability diagnostics for microphone, Web Audio, storage,
   folder export, downloads, and wake lock.
6. `planSession` selects prompt ids from the canonical corpus by language, speaker progress, and
   simple diversity scoring. Local text corpora are parsed into cue-safe prompts and their latest
   source snapshot is persisted in the workspace.
7. Recording uses `getUserMedia` plus `createPcmRecorder`. Capture prefers an `AudioWorkletNode`
   and retains a `ScriptProcessorNode` compatibility fallback, then encodes local mono WAV PCM
   48 kHz / 24-bit and computes first-pass technical metrics.
8. `finalizeCaptureSession` in `src/app/recording/finalizeCaptureSession.ts` coordinates take
   finalization, audio persistence, workspace projection, and metadata export.
9. `createRecordedTake` in `src/app/recording/recordedTake.ts` builds transcript, word/phoneme
   timing, intent, quality, measured pitch/energy prosody, and review metadata from the prompt plus
   local metrics. Web Speech transcript matching is treated as an actual ASR observation; a
   prompt-only estimate cannot become a keeper. Browser grapheme-to-phoneme timing remains
   explicitly estimated until an acoustic forced-alignment JSON is imported.
10. Empty audio blobs do not create takes and therefore cannot credit corpus coverage.
11. Audio is persisted through IndexedDB, File System Access, or explicit download fallback. Dataset
    exports resolve audio from IndexedDB first and the connected folder second. If the WAV cannot
    be accepted by durable browser or folder storage, the take is marked rejected with an
    `audio_persistence` gate and cannot credit coverage.
12. `completePlannedSession` stores the captured session, then rebuilds the current corpus progress
    projection from workspace history.
13. `createCaptureSessionExportBundle` derives Forge-shaped metadata and reports, then the shell
    writes them to the chosen folder or exposes a JSON download.

## Projections

The system does not have an explicit event log yet. Its current projections are:

- `corpusProgress` in the workspace, derived from captured sessions.
- `CoverageSummary`, derived from workspace progress plus the current corpus.
- Browser export reports, derived from the session, takes, prompt metadata, and coverage summary.

This makes replay possible in principle, but not yet first-class. The durable history is
`capturedSessions`; `corpusProgress` is a cached projection that must remain derivable.
The current implementation reconciles this projection when sessions are completed and when the
workspace is opened, preserving legacy progress while replaying keeper takes found in history.
Browser payloads are normalized through `normalizeWorkspacePayload` before runtime use, so missing
or malformed schema-1 fields fall back to safe defaults. Future schema versions are rejected until
an explicit migration exists.

## Verified Principles

- Domain modules are free of React, CSS, DOM, `window`, `document`, and browser APIs.
- Domain modules communicate through typed models and contracts.
- The app shell imports domains; domains do not import the shell.
- The corpus is shipped as source data and workspaces store prompt identifiers, not prompt text
  copies in progress snapshots.
- Browser export computes SHA-256 checksums for written bundle artifacts, using Web Crypto when
  available and a local fallback when it is not.

## Current Tensions

- `App.tsx` contains orchestration, UI state, and the browser capture lifecycle. Capture
  finalization, export bundle/report generation, and take construction now live in app-level
  services, but they are not yet promoted behind the domain recording/export ports.
- Workspace persistence prefers IndexedDB (with a one-time migration from the legacy
  `localStorage` payload and a `navigator.storage.persist()` request against eviction), falling
  back to `localStorage` and then memory-only when browser storage fails. The repository contract
  exposes this durability explicitly, and the shell exposes a workspace backup download, but there
  is no restore/import flow yet.
- Export reports are generated in an app-level service rather than behind the domain export port.
- Browser private storage is still the default initial workspace mode even though the doctrine says
  File System Access should be preferred where available.
- Corpus compatibility policy reserves tombstones, but the corpus model has no tombstone type yet.
- Local corpus snapshots are stored with the workspace so reloads do not orphan local sessions.
- Coverage separates prompt completion from measured audio quality, ASR coverage, prosody
  measurements, and acoustic forced-alignment coverage.
- Workspace normalization handles missing or malformed schema-1 browser payload fields and refuses
  future schema versions, but there is no transform-based migration path yet.

## Keeper Invariant

Coverage progress represents accepted dataset material, not every recorded attempt. A prompt is
credited as completed only when a captured take is rated `keeper`. `maybe` and `reject` takes remain
session history, but they do not close corpus coverage.

Persistence is part of that keeper invariant. A technically clean performance is still rejected if
the WAV was not accepted by durable local storage; the user can download the temporary file, but the
workspace will not treat it as completed training material.

This keeps the workspace projection aligned with the product goal: a smaller clean dataset is better
than a larger incoherent one.

## Next Useful Probes

1. Add an explicit future-version migration policy for `VoiceWorkspace.schemaVersion`.
2. Extend corpus integrity tests with future tombstone and compatibility migration rules.
3. Add a restore/import path for downloaded memory-only workspace backups.
4. Promote app-level recording/export services behind domain ports when a second implementation or
   export shape appears.
5. Audit bundle size and route splitting once more app-level services are introduced.
6. Extend the existing external forced-alignment import path with TextGrid support and explicit
   provenance adapters for MFA, WhisperX, or another acoustic aligner.

# Repository maturity scorecard

Date: 2026-08-04. Scope: source code, browser runtime, capture pipeline,
dataset contracts, local persistence, build, tests, CI, documentation, and the
GitHub Pages delivery model.

## Method

Each criterion is scored from 0 to 100 against evidence available in this
repository and in repeatable runtime checks. The overall score is a weighted
average; higher weights are assigned to audio integrity, dataset correctness,
performance, privacy, persistence, and automated validation. A score of 100
requires both automation and external evidence such as real-device tests,
assistive-technology review, or an exercised release and recovery procedure.

The `Before` column is the state at the beginning of this audit. It is not
comparable to earlier, narrower scorecards that covered only a few platform
dimensions.

## Scores

| Criterion                     | Weight | Before | Current | Evidence and remaining ceiling                                                                                                                         |
| ----------------------------- | -----: | -----: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product coherence             |      4 |     95 |      95 | Capture, review, quality and export remain aligned with the product constitution.                                                                      |
| Core UX                       |      5 |     96 |      96 | Direct capture paths and mode-specific controls are browser-tested.                                                                                    |
| Accessibility                 |      4 |     82 |      92 | WCAG A/AA serious and critical violations are gated on onboarding and the active studio; manual AT review remains.                                     |
| Responsive behavior           |      4 |     96 |      97 | Mobile, tablet, landscape and desktop profiles, including the lazy technical surface, are verified without horizontal overflow.                        |
| Browser compatibility         |      4 |     95 |      95 | Chromium, Firefox and WebKit layout checks pass; complete microphone capture remains Chromium-automated.                                               |
| PWA and offline resilience    |      3 |     90 |      95 | The installed shell proves a complete offline restart and refuses invalid module fallbacks.                                                            |
| Performance                   |      6 |     91 |      96 | Initial output is 160.1 KiB JS and 14.8 KiB CSS gzip under 170/16 KiB gates; technical UI and export services load on demand.                          |
| Audio capture fidelity        |      7 |     95 |      95 | PCM WAV, adaptive VAD, loudness, clipping, pitch, room tone and provenance are covered; a hardware lab matrix remains.                                 |
| Local Whisper and VAD         |      4 |     88 |      97 | The full on-device model flow passes locally and is scheduled weekly in CI. More representative speech fixtures remain.                                |
| Corpus quality                |      3 |     95 |      95 | Stable IDs, bilingual balance, capture gates and local corpus parsing are tested.                                                                      |
| Dataset and export contracts  |      6 |     97 |      99 | Shared scoped planning, end-to-end cancellation, Forge integrity, rights, checksums, ZIP reopening and missing-audio failure are tested.               |
| Data integrity and provenance |      5 |     96 |      99 | Keeper projections, immutable hashes, capture provenance, sequential payload reads and independent archive verification are enforced.                  |
| Persistence and recovery      |      5 |     91 |      99 | Archives restore every WAV collision-safely; direct folder writes are atomic and retain an incomplete marker until the package commits.                |
| Privacy                       |      5 |     96 |      98 | Capture/inference stay local and the shareable support profile structurally excludes audio, transcripts, identity, corpus and device labels.           |
| Application security          |      4 |     82 |      92 | CSP, restricted object/base/form sources, referrer policy and private reporting are present; HTTP response headers require a host with header control. |
| Supply-chain health           |      3 |     80 |      96 | Zero known npm vulnerabilities, CI audit, lockfile, Dependabot and a retained CycloneDX SBOM are automated; signed provenance remains.                 |
| Architecture                  |      5 |     88 |      92 | Export orchestration and atomic writing are explicit services, and technical styles are lazy; the central capture orchestrator remains large.          |
| Static code quality           |      4 |     92 |      92 | Strict TypeScript, lint and formatting are release gates.                                                                                              |
| Maintainability               |      4 |     84 |      90 | Global CSS and folder export shrank into stable modules with focused tests; `App.tsx` still needs careful lifecycle extraction.                        |
| Automated testing             |      6 |     91 |      99 | Cancellation, privacy redaction, large sequential reads, atomic aborts, archive corruption and clear/restore/reload flows are automated.               |
| CI/CD                         |      4 |     88 |      98 | Multi-engine CI, audit, concurrency, timeouts, failure traces, model inference and SHA-addressed release evidence are configured.                      |
| Diagnostics and operability   |      2 |     85 |      97 | A user-downloadable local profile exposes capabilities and storage health without free-form diagnostic details or private capture content.             |
| Documentation and onboarding  |      3 |     91 |      96 | Architecture, capture, cancellation, dataset, rights, recovery and release evidence are documented.                                                    |
| Licensing and governance      |      2 |     96 |      96 | MIT license, contribution rules, security policy and rights documentation are present.                                                                 |
| Internationalization          |      2 |     82 |      82 | Corpora cover French and English, while the application shell remains primarily French.                                                                |
| Discoverability               |      1 |     78 |      90 | Canonical URL, Open Graph URL, robots and sitemap are explicit; structured data and install screenshots remain.                                        |
| Release engineering           |      2 |     78 |      92 | Each green main build retains a SHA-addressed static archive, checksum and SBOM; tags, signing and a performed rollback drill remain.                  |
| Deployment reliability        |      2 |     93 |      94 | Static HTTPS deployment, base-path tests, PWA gates and source-preserving rollback guidance are strong; a production rehearsal remains.                |

**Weighted score: 90.8 → 95.4 / 100.**

## Changes made in this audit

- Enforced coverage floors: 90% lines, 80% branches and 85% functions for
  non-React TypeScript.
- Added automated WCAG A/AA checks for onboarding and the active studio.
- Added a CSP compatible with local workers, AudioWorklet, blob media and WASM,
  plus a strict referrer policy.
- Added canonical, Open Graph, robots and sitemap metadata.
- Added full dependency auditing, Dependabot updates, bounded CI execution and
  trace retention on failures.
- Added a scheduled and manually triggerable end-to-end Whisper/VAD job.
- Added a complete, self-verifying workspace archive with audio restoration and
  non-overwriting IndexedDB import.
- Added shared cancellable dataset planning, sequential large-collection
  hashing, ZIP revalidation, and atomic folder writes with incomplete markers.
- Added a privacy-safe support profile guarded by unit and browser tests.
- Split the technical page styles and export services into lazy chunks while
  preserving the initial bundle budgets and multi-engine layout matrix.
- Added immutable release archives, SHA-256 checksums, a CycloneDX SBOM, and a
  source-preserving recovery procedure for every successful `main` build.

## Path to the maximum level

### Priority 0 — closes correctness and recovery gaps

1. **Archive migrations and recovery drills.** Add explicit transforms when the
   archive or workspace schemas evolve, then rehearse cross-device recovery and
   production rollback from retained release evidence.
2. **Real-device audio lab.** Maintain measured fixtures for iPhone Safari,
   Android Chrome, macOS Safari, Windows Edge, USB interfaces, Bluetooth input
   and interrupted/backgrounded captures. Record sample-rate negotiation,
   latency, drift, clipping and persistence outcomes.
3. **Manual accessibility acceptance.** Complete VoiceOver, TalkBack, NVDA,
   keyboard-only, 200% zoom, forced-colors and reduced-motion reviews across
   capture, review and export.

### Priority 1 — reduces structural and operational debt

1. **Decompose the application shell.** Continue extracting workspace, capture
   and playback lifecycles into explicit hooks/services without splitting the
   atomic capture state machine prematurely.
2. **Signed release supply chain.** Add tags and signed build
   provenance/attestations around the existing SHA archive, checksum and SBOM,
   then perform the documented rollback drill.
3. **Host-level security headers.** If the deployment moves to a host with
   header control, emit CSP, Permissions-Policy, X-Content-Type-Options and
   cross-origin policies as HTTP headers and verify them in production.
4. **Dependency upgrade program.** Evaluate Vite, TypeScript, Lucide and
   ONNX Runtime major upgrades independently with bundle, model and browser
   regression baselines.

### Priority 2 — expands reach and evidence

1. Internationalize the application shell in French and English with automated
   missing-key and overflow checks.
2. Add representative speech fixtures for deterministic Whisper/VAD quality
   assertions instead of accepting only successful inference.
3. Add install screenshots and structured application metadata, then verify
   install prompts on Android, Windows and macOS.
4. Add property-based and mutation testing around archive paths, schema
   migration, malformed imports and export relations.
5. Exercise disaster recovery and rollback during a tagged release, and record
   the evidence in the changelog.

Reaching 97–98 is achievable through the Priority 0 and Priority 1 work.
Claiming 100 requires the external device, assistive-technology, release and
recovery evidence above; it cannot be established honestly from source code
alone.

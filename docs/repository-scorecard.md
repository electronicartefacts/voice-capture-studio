# Repository maturity scorecard

Date: 2026-07-10. Scope: source code, browser runtime, capture pipeline,
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
| Responsive behavior           |      4 |     96 |      96 | Mobile, tablet, landscape and desktop profiles are verified without horizontal overflow.                                                               |
| Browser compatibility         |      4 |     95 |      95 | Chromium, Firefox and WebKit layout checks pass; complete microphone capture remains Chromium-automated.                                               |
| PWA and offline resilience    |      3 |     90 |      95 | The installed shell now proves a complete offline restart and refuses invalid module fallbacks.                                                        |
| Performance                   |      6 |     91 |      93 | Initial budgets are 170 KiB gzip for JavaScript and 16 KiB for CSS; current values are 155.9 and 14.1 KiB. Field and low-end-device profiles remain.   |
| Audio capture fidelity        |      7 |     95 |      95 | PCM WAV, adaptive VAD, loudness, clipping, pitch, room tone and provenance are covered; a hardware lab matrix remains.                                 |
| Local Whisper and VAD         |      4 |     88 |      97 | The full on-device model flow passes locally and is scheduled weekly in CI. More representative speech fixtures remain.                                |
| Corpus quality                |      3 |     95 |      95 | Stable IDs, bilingual balance, capture gates and local corpus parsing are tested.                                                                      |
| Dataset and export contracts  |      6 |     97 |      97 | Forge package integrity, rights gates, relations, checksums and missing-audio failures are tested.                                                     |
| Data integrity and provenance |      5 |     96 |      96 | Keeper-only projections, immutable hashes and capture provenance are enforced.                                                                         |
| Persistence and recovery      |      5 |     91 |      91 | IndexedDB, folder and download fallbacks are strong; a restorable archive containing metadata and audio is still missing.                              |
| Privacy                       |      5 |     96 |      96 | Capture and model inference are local; optional browser speech recognition is identified separately.                                                   |
| Application security          |      4 |     82 |      92 | CSP, restricted object/base/form sources, referrer policy and private reporting are present; HTTP response headers require a host with header control. |
| Supply-chain health           |      3 |     80 |      93 | Zero known npm vulnerabilities, CI audit, lockfile and Dependabot for npm and Actions. Provenance attestations and SBOM publication remain.            |
| Architecture                  |      5 |     88 |      88 | Domain boundaries are clear, but the app orchestrator and several UI modules are oversized.                                                            |
| Static code quality           |      4 |     92 |      92 | Strict TypeScript, lint and formatting are release gates.                                                                                              |
| Maintainability               |      4 |     84 |      84 | `App.tsx`, `styles.css`, workspace folder storage and large screens need staged decomposition.                                                         |
| Automated testing             |      6 |     91 |      98 | 101 unit tests, enforced 91.78/82.08/90.60 line/branch/function coverage, 29 regular browser scenarios, and the heavy model flow pass.                 |
| CI/CD                         |      4 |     88 |      97 | Multi-engine CI, dependency audit, concurrency, timeouts, traces on failure and scheduled model inference are configured.                              |
| Diagnostics and operability   |      2 |     85 |      85 | Runtime capability and frame-pacing diagnostics are local; there is no exportable support bundle or privacy-safe field profile.                        |
| Documentation and onboarding  |      3 |     91 |      94 | Architecture, capture, dataset, rights, platform and this scorecard are documented.                                                                    |
| Licensing and governance      |      2 |     96 |      96 | MIT license, contribution rules, security policy and rights documentation are present.                                                                 |
| Internationalization          |      2 |     82 |      82 | Corpora cover French and English, while the application shell remains primarily French.                                                                |
| Discoverability               |      1 |     78 |      90 | Canonical URL, Open Graph URL, robots and sitemap are now explicit; structured data and install screenshots remain.                                    |
| Release engineering           |      2 |     78 |      78 | Build and Pages deployment are automated, but tags, immutable release archives, SBOM and provenance are not.                                           |
| Deployment reliability        |      2 |     93 |      93 | Static HTTPS deployment, base-path tests, PWA checks and build gates are strong; header control and rollback rehearsal remain.                         |

**Weighted score: 90.8 → 93.4 / 100.**

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
- Preserved the existing bundle budgets and multi-engine layout matrix.

## Path to the maximum level

### Priority 0 — closes correctness and recovery gaps

1. **Restorable workspace archive.** Define a versioned archive that contains
   workspace metadata, every referenced WAV, hashes and a verified import
   transaction. Restore into a clean profile and reject partial or future
   schemas atomically.
2. **Real-device audio lab.** Maintain measured fixtures for iPhone Safari,
   Android Chrome, macOS Safari, Windows Edge, USB interfaces, Bluetooth input
   and interrupted/backgrounded captures. Record sample-rate negotiation,
   latency, drift, clipping and persistence outcomes.
3. **Manual accessibility acceptance.** Complete VoiceOver, TalkBack, NVDA,
   keyboard-only, 200% zoom, forced-colors and reduced-motion reviews across
   capture, review and export.

### Priority 1 — reduces structural and operational debt

1. **Decompose the application shell.** Extract workspace lifecycle, capture
   lifecycle, local analysis, export orchestration and playback into explicit
   hooks/services. Split screen styles by stable surface without changing the
   product identity.
2. **Release supply chain.** Publish tagged immutable archives, a CycloneDX
   SBOM, build provenance/attestations, checksums and a tested rollback note.
3. **Host-level security headers.** If the deployment moves to a host with
   header control, emit CSP, Permissions-Policy, X-Content-Type-Options and
   cross-origin policies as HTTP headers and verify them in production.
4. **Privacy-safe performance profiles.** Export local diagnostic bundles with
   Web Vitals, frame pacing, capture configuration and storage health, with no
   recording or transcript content.
5. **Dependency upgrade program.** Evaluate Vite, TypeScript, Lucide and
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

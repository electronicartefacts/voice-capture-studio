# Production Engineering Audit

Last reviewed: 2026-07-09

This is the current technical reference for Voice Capture Studio. It describes
the implementation in this repository, not an aspirational redesign.

## Product and repository architecture

Voice Capture Studio is a static, local-first Vite/React application for
directed voice capture. It has no server, account, remote sync, or backend
audio pipeline. User recordings, workspaces, and exports remain on the
device.

`src/app/main.tsx` boots React strict mode and registers the production
service worker. `src/app/shell/App.tsx` composes the product flow:

1. Opening microphone ritual and runtime diagnostics.
2. Browser workspace open, normalization, and durability reporting.
3. Speaker/language/corpus choice and prompt-session planning.
4. Room-tone calibration, microphone capture, reading guidance, and review.
5. Take finalization, local persistence, coverage projection, and export.

The domain packages under `src/domains/` are pure TypeScript. They own corpus,
coverage, phonetics, session planning, speakers, settings, workspace state,
and contracts. They do not import React, CSS, DOM, or browser APIs. App-layer
services own PCM capture, browser storage, export writing, runtime diagnostics,
and the shell.

The durable flow is:

```text
canonical corpus + workspace -> planSession -> PCM capture -> finalizeCaptureSession
  -> persisted take/session -> coverage projection and export reports
```

`capturedSessions` is durable history. `corpusProgress` is a reconciled
projection which only credits keeper-rated takes with persistable audio.

## Rendering architecture

### Voice Filament

`src/app/rendering/liveAudioSignal.ts` owns a typed-array signal bus outside
React. Microphone blocks are reduced to 260 peak-preserving display buckets,
soft-limited at 0.9 with a 3.6 ratio, and timestamped. This preserves
responsive shape without turning React state into a sample-rate transport.

`VoiceWaveformSurface.tsx` owns the fixed canvas and its animation lifecycle.
It caps device pixel ratio at 2, reads theme tokens no more than twice per
second, caches dimensions until resize, and preallocates x, y, and previous
waveform typed arrays. Its frame loop starts only after microphone enablement.

Active frame order:

1. Read a live signal when it is younger than 260 ms; otherwise use a quiet
   idle carrier.
2. Apply temporal interpolation and a centre-weighted envelope.
3. Reconstruct a Catmull-Rom-derived cubic Bézier path from adjacent tangents.
4. Draw nine rounded ribbon strokes back-to-front, then the live core and the
   review playhead where applicable.

The filament is deliberately speech-oriented rather than a calibrated
oscilloscope. Bucket reduction, soft limiting, and temporal coherence remove
single-sample chatter while preserving immediate vocal response. It does not
use adaptive subdivision or arc-length parameterization; hardware profiling
does not currently justify those added costs.

### Acoustic Field

The background is a compositor-friendly CSS field, not a second canvas. A
2048-sample analyser reads time-domain and frequency data. At most every 50 ms,
`measureAcousticField` emits broad, power-curved controls:

| Layer  | Band        | Semantic role                   |
| ------ | ----------- | ------------------------------- |
| Halo A | 40-180 Hz   | low-frequency body and impact   |
| Halo B | 300-3400 Hz | vocal presence and articulation |
| Halo C | 3.4-10 kHz  | air, sibilance, and room detail |
| Halo D | 40-8000 Hz  | overall ambience                |

Those controls update CSS variables directly on the root, avoiding React
rerenders at analyser rate. The halos retain independent colour, drift phase,
position, blur, opacity, and scale. The field therefore remains semantically
alive even during quiet room activity, without presenting a literal spectrum.

## Audio architecture and DSP

The long-lived ambient monitor requests mono capture with echo cancellation,
noise suppression, and automatic gain control disabled. Its `AnalyserNode`
uses FFT size 2048, min/max decibels -100/-8, and
`smoothingTimeConstant = 0.42`. RMS is additionally smoothed by 30% per
animation update for stable interface metering.

The recorder clones the monitor stream where possible, creates a dedicated
context requesting 48 kHz, and writes mono 24-bit WAV. If the browser cannot
honour the target rate, it resamples once on stop with linear interpolation.

`createPcmRecorder` now prefers `AudioWorkletNode`. The audio thread batches
four 128-frame render quanta into 1024 samples, transfers each block to the
main thread, and flushes a partial block before shutdown. The old
`ScriptProcessorNode` is retained only as a compatibility fallback when a
browser or webview cannot load the dynamic worklet module.

`PcmSampleBuffer` grows geometrically with `Float32Array`. Stop-time analysis
reports peak dBFS, RMS-derived integrated LUFS estimate, frame-percentile noise
floor, derived SNR, clipping, tail/reverb score, plosive density, and
high-delta mouth-noise score. These are browser-side quality aids, not
calibrated studio measurements.

Speech recognition is optional reading guidance only. Prompt-derived phoneme
timing is explicitly marked for acoustic forced alignment downstream.

## Parameter map

| Parameter            |                Value | Responsibility                    |
| -------------------- | -------------------: | --------------------------------- |
| Display samples      |                  260 | filament density and Bézier cost  |
| Worklet batch        |          1024 frames | 21.3 ms maximum at 48 kHz         |
| Capture target       | mono, 48 kHz, 24-bit | archive-compatible WAV            |
| Ambient FFT          |                 2048 | field resolution                  |
| Analyser smoothing   |                 0.42 | spectral stability                |
| Field update maximum |                20 Hz | avoids style churn                |
| Fresh-signal window  |               260 ms | prevents stale live trace         |
| React audio UI       |      12.5 Hz maximum | keeps the shell off audio cadence |
| Karaoke style writes |        30 Hz maximum | bounds character DOM updates      |
| Input sensitivity    |   0.5-3; default 1.6 | visual/meter gain only            |
| Room tone            |              3000 ms | short stable calibration          |
| Reading guide        |                90 ms | voice-activity fallback cadence   |
| Review bars          |                   92 | review waveform density           |

## Latency and performance model

The capture-to-display path is microphone hardware/driver -> browser buffering
-> Web Audio quantum -> worklet batch -> typed-array bus -> next animation
frame -> canvas compositor -> display. The worklet batching bound is 21.3 ms at
48 kHz; the render handoff adds 0-16.7 ms at 60 Hz. Hardware buffers, display
scanout, and browser scheduling are device-specific and must be measured on
release hardware.

Measured repository checks on 2026-07-09:

| Check                           |     Before |      After |
| ------------------------------- | ---------: | ---------: |
| Unit tests                      | 43 passing | 45 passing |
| Lint, type-check, format        |       pass |       pass |
| Production build                |       pass |       pass |
| App chunk gzip                  |   47.95 kB |   49.27 kB |
| Canvas point objects/frame      |        260 |          0 |
| Canvas frames before mic enable | continuous |       none |

The small bundle increase is the explicit cost of the AudioWorklet path and
frequency-band field. It is justified by removing main-thread audio processing
from the primary capture path and assigning real acoustic roles to the field.

Desktop and 390x844 browser smoke checks completed with no console errors,
clipping, or horizontal overflow on the opening ritual. Physical microphone,
calibration, playback, end-to-end latency, CPU/GPU frame pacing, and long
recording memory cannot be honestly measured in this headless environment; they
remain hardware release checks.

## 2026-07-10 fluidity pass

The live canvas now reads its level directly from the typed-array signal bus.
Audio activity updates the root CSS variable directly, while the large React
shell receives meter state at most every 80 ms. This keeps the waveform and
field responsive at display cadence without repeatedly reconciling the entire
screen during recording.

Karaoke character styling is capped at 30 Hz and writes a CSS property only
when its rounded value changes. Halo blur is static; only compositor-friendly
opacity, scale, and translation respond to sound. These changes remove the
largest avoidable per-frame React, DOM-style, and dynamic-filter costs without
slowing the live audio signal.

## UX, responsive behavior, and motion

The main interaction path is intentional: explicit permission, room-tone
calibration before keeper material, live prompt guidance, immediate review, and
durable-file/export access. Motion is bounded to slow halo drift, interpolated
filament response, and short text/review transitions. `prefers-reduced-motion`
removes halo and UI animation.

Known product limitations:

1. The opening ritual is English while most of the studio UI is French.
   Localization ownership should be decided before changing it.
2. Browser diagnostic metrics must not be represented as certified loudness,
   noise, or reverb measurement.
3. Exports are alignment-ready, not acoustically aligned.
4. File System Access is not yet the preferred first-run storage path.

## Remaining roadmap

1. Run a device matrix on Chrome desktop, Safari desktop, Chrome Android, and
   target interfaces: latency, worklet fallback rate, XRuns, frame pacing,
   memory, and WAV verification.
2. Extract the remaining capture/session controller responsibilities from
   `App.tsx`; rendering is now isolated, while orchestration is the next seam.
3. Add workspace restore/import, schema transforms, corpus tombstones, and
   File System Access first-run preference.
4. Import MFA/WhisperX/TextGrid alignment with provenance and require it for
   premium dataset acceptance.

No further rendering complexity is justified without hardware profiling or a
user study. WebGL, per-frame React updates, speculative noise reduction, and
raw-spectrum graphics would add cost without demonstrated product benefit.

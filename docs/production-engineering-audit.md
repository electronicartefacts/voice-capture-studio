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
interactive context requesting 48 kHz, and writes mono 24-bit WAV. If the
browser cannot honour the target rate, it resamples once on stop with a
windowed-sinc low-pass filter so downsampling does not fold ultrasonic content
into the voice band.

`createPcmRecorder` now prefers `AudioWorkletNode`. The audio thread batches
four 128-frame render quanta into 1024 samples, transfers each block to the
main thread, and flushes a partial block before shutdown. The old
`ScriptProcessorNode` is retained only as a compatibility fallback when a
browser or webview cannot load the dynamic worklet module.

`PcmSampleBuffer` grows geometrically with `Float32Array` and is bounded by the
configured capture duration, with a 120-second safety maximum by default.
Stop-time analysis reports peak dBFS, a gated mono K-weighted LUFS estimate,
frame-percentile noise floor, derived SNR, clipping, tail/reverb score,
plosive density, and mouth-noise score. Plosive and mouth-noise heuristics are
frame-based, using low/high-band energy and onset thresholds instead of
counting individual large samples. A capture that reaches its memory bound is
marked truncated and rejected by the quality gates. These remain browser-side
quality aids, not calibrated studio measurements.

Speech recognition is optional reading guidance only. Prompt-derived phoneme
timing is explicitly marked for acoustic forced alignment downstream.

## Parameter map

| Parameter              |                Value | Responsibility                                        |
| ---------------------- | -------------------: | ----------------------------------------------------- |
| Display samples        |                  260 | filament density and Bézier cost                      |
| Worklet batch          |          1024 frames | 21.3 ms maximum at 48 kHz                             |
| Stop flush guard       |               500 ms | prevents browser shutdown hangs                       |
| Capture target         | mono, 48 kHz, 24-bit | archive-compatible WAV                                |
| Ambient FFT            |                 2048 | field resolution                                      |
| Analyser smoothing     |                 0.42 | spectral stability                                    |
| Field update maximum   |                20 Hz | avoids style churn                                    |
| Fresh-signal window    |               260 ms | prevents stale live trace                             |
| React audio UI         |      12.5 Hz maximum | keeps the shell off audio cadence                     |
| Karaoke style writes   |        30 Hz maximum | bounds character DOM updates                          |
| Input sensitivity      |   0.5-3; default 1.6 | visual/meter gain only                                |
| Room tone              |              3000 ms | short stable calibration                              |
| Reading guide          |                90 ms | voice-activity fallback cadence                       |
| Review bars            |                   92 | review waveform density                               |
| Constrained-tier enter |             < 36 fps | sustained frame-pace strain onset                     |
| Constrained-tier exit  |             > 50 fps | required recovery before restoring full idle fidelity |

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

## 2026-07-10 adaptive quality engine

`getAmbientRenderingBudget` already exposed a three-tier budget type
(`full`/`constrained`/`paused`), and `VoiceWaveformSurface` and the ambient
level loop in `App.tsx` already read the `constrained` tier to lower idle
frame rate and acoustic-field read cadence. Nothing ever produced
`constrained`: the policy only ever chose between `full` and `paused` from
page visibility and scroll state. The device-adaptive half of the budget was
wired end to end but structurally unreachable.

`src/app/system/framePaceMonitor.ts` closes that gap by measuring the actual
interval between delivered `requestAnimationFrame` callbacks, exponentially
smoothed, with asymmetric hysteresis (enter under ~36 fps sustained, exit only
above ~50 fps sustained) so the tier does not flap on a single slow frame.
Static capability hints were deliberately rejected in favour of this: `Device
Memory` and the Battery API are Chromium-only and the latter is being removed
from cross-origin contexts industry-wide, and `hardwareConcurrency` does not
predict WebKit single-core performance or thermal throttling. A measured frame
interval is the one signal every engine delivers, and it is true at the moment
it is read rather than at page load.

`useAmbientRenderingBudget` runs this monitor in its own `requestAnimationFrame`
loop (stopped on `visibilitychange` so it never counts a backgrounded tab's
throttled callbacks as strain) and folds the result into
`getAmbientRenderingBudget` as `isDeviceConstrained`. The invariant ordering is
explicit in the policy function: capture in progress always returns `full`
regardless of scroll or measured strain; only once capture ends can scroll
suppression or sustained device strain lower decorative fidelity. The
degradation this unlocks — idle waveform frame rate and acoustic-field read
cadence, both already implemented — never reaches the take being recorded.

## 2026-07-10 perceptual audit

With rendering cost considered settled, this pass audited the experience for
perceptual truth rather than frame budget: does every reactive surface
represent something real, and does every reading arrive the way a measuring
instrument would show it?

**Review playback was animating a fiction.** `ListeningReviewSurface` already
decodes the finished take once, per 92 time buckets, computing both a peak
(for the static waveform bar heights) and an RMS value that was discarded.
The halo and filament energy driving live playback instead came from
`Math.sin(progress * wordCount)` combined with a second sine at a fixed
2.2 multiplier — a canned pulse with no relationship to what was audibly
playing. A loud take and a near-silent take produced the same on-screen
motion. `ReviewWaveformBar` now keeps `rmsPercent`, and playback energy is a
smoothed (0.35 EMA) read of the bucket under the playhead. The instrument now
answers to the actual recording during review exactly as it does to the live
microphone during capture; the mission's core claim — the browser is
connected to something real — no longer breaks the moment a user replays
their own take.

**The coverage ring taught nothing about arrival.** `--coverage` drove a
conic-gradient with no transition, so a completed prompt updated the corpus
ring instantly rather than sweeping to its new reading. `--coverage` is now
declared through `@property` (`syntax: "<percentage>"`) so the custom
property itself is interpolable, and the ring transitions over 700 ms. A
gauge that jumps reads as a UI update; a gauge that sweeps reads as a needle
finding a new measurement. `prefers-reduced-motion` already forces all
transition durations to 1 ms globally, so this degrades for free.

**Rejected: audio or haptic confirmation cues.** A chime on start/stop, or
`navigator.vibrate` on state changes, is the standard "make it feel alive"
move for a consumer app, and was deliberately not added here. This product's
subject is the room itself: a start/stop tone would bleed into the very
silence a room-tone calibration is measuring, and a vibration pulse on a
handheld device doubles as physical excitation of the device's own
microphone. Silence and stillness are correct for an instrument whose sensor
and body share one enclosure with the target.

## 2026-07-10 microphone awakening

Two moments in the opening ritual were flattened into instant state
switches: `studioAwake` going false→true, and the underlying browser
permission decision it depends on. Both now have a distinct, honest motion
signature instead of sharing the app's generic transition tokens.

`ritual-button.is-requesting` (an actual CSS class now, not just a disabled
attribute) grows a looping ring while the native permission dialog is open.
Its duration is deliberately indeterminate — a determinate progress bar would
promise an end time the user's own decision doesn't have. `prefers-reduced-
motion` already forces every animation to a single 1 ms frame globally, so
this degrades for free.

`.ambient-backdrop.is-awake .voice-halo` layers a second, one-shot
`halo-ignite` animation alongside the permanent `halo-drift` orbit: the halo
comes into blur from a sharp point rather than simply fading up at its
resting blur radius. It deliberately does not use a `both`/`forwards` fill
mode — after 1.4 s it falls back to the halo's ordinary audio-reactive
`opacity`/`filter` declarations rather than freezing on the keyframe's last
value, so the ignition never fights the live signal it hands off to.
Verified end to end with a real (fake-device) browser run: `is-idle` →
click → `is-requesting` → `main.is-awake` with `halo-drift, halo-ignite`
both present on the computed style, backdrop settling to full opacity.

## 2026-07-10 temporal rhythm audit

A full pass over screen state timing, not cost: every `setScreen()` call site
was traced end to end. One mechanism governs every screen appearance and
disappearance — `startViewTransition`, giving a native compositor dissolve —
except when `calibration`/`karaoke` is on either side of the change, where the
switch was unconditionally instant, justified in code as "recording feedback
wins".

That justification holds for _arming_ a capture screen (nothing may delay
recording controls appearing) but not for _leaving_ one. Tracing
`finishRecording`: `recorder.stop()` always completes, and
`stopFreeWordDetection`/`persistFinishedSession` always run, strictly before
the `setScreen` call that leaves `karaoke`/`calibration`. The microphone is
already closed by the time the screen changes — there is no live audio left
to protect, so "fin de prise" was cutting instantly at exactly the moment the
mission's own state vocabulary calls out: the instrument stops and archives
its result.

`setScreen` now gates the transition skip on `isArmingCapture` (`nextScreen`
only) instead of either side of the change. Entering `calibration`/`karaoke`
stays instant — measured at 3.3 s to reach karaoke, i.e. exactly the 3 s room
tone plus an instant switch, no regression. Leaving them now dissolves like
every other screen: a spy on `document.startViewTransition` confirmed it
fires on `karaoke → done` (previously silent) and stays silent through
`permission → calibration → karaoke` (unchanged).

Rejected this pass, for a worse gain/complexity ratio than a one-line
conditional: a live-ticking dBFS readout during room-tone calibration (touches
three places for one state), a progressive left-to-right reveal of the
review waveform (needs new per-segment animation machinery), a visible
activity cue during "Finalisation…" (real gap, but a missing liveliness, not
a broken continuity), and a general ambient "breathing" on the idle `Prêt`
state (too diffuse to land as one scoped change).

## 2026-07-10 homepage front panel redesign

The home screen previously read as a configuration form: a badge, a kicker,
a headline, a status paragraph, three stat chips, a section header, four
description cards for the capture modes, a corpus editor, two side-by-side
buttons, a hint, a coverage ring, a voice/language manager, and up to three
conditional panels — all visible in the first viewport on desktop, since
`.home-card` was a two-column grid placing the "hero" and the full
configuration console side by side. It explained the product before letting
it exist, in direct tension with `docs/design/PHENOMENOLOGY.md` §1.

Applying the "five-second test" (would a first-time viewer, given five
seconds and no click, understand they're facing a listening instrument
rather than settings screen?), `.home-card` becomes a single column at every
breakpoint. The first viewport now contains only what a physical instrument's
front panel would show:

- **Removed from the front panel entirely**: the mode badge's descriptive
  text, the kicker/status paragraph pairing, the three-chip status strip, the
  section header text, and every mode card's two-line description. None of
  it is deleted from the product — see "moved" below.
- **Moved below the fold** (still on the same scroll, in `.home-workbench`,
  not gated behind an interaction): the operational status message, the
  status strip, the corpus/backing-track editors, the folder-export button,
  the coverage console, the voice/speaker manager, and the diagnostics/
  workspace-backup/capture-profile panels — unchanged in behavior, only
  relocated.
- **Merged**: the four capture-mode cards collapse into `.mode-dial`, a
  compact icon-only control (`CaptureModeSelector`, restyled, same props and
  handler) reused directly from a camera mode wheel, with the selected
  mode's name folded into one small caption (`.instrument-mode-label`)
  instead of repeated per card. The `is-active` class this component shared
  with an unrelated "paroles complètes" checkbox was split into its own
  `.session-option` class first — the two had started to need incompatible
  layouts.
- **Became the one hero object**: `.launch-button.is-hero` — larger, centered
  alone in `.instrument-trigger`, the only object the eye has to land on.
  Its label logic (disabled reasons, mode-aware copy) is untouched; only its
  visual weight and position changed.
- **Stayed visible on open**: the filament and halo (invariant, untouched),
  the mode dial, the hero button, and one short line — the mode's existing
  `headline` copy, already short and evocative, reused as-is rather than
  written new.

Verified behaviorally, not just visually: a scripted mode switch
(`Doublage` → corpus editor appears, button reads "Ajouter un texte";
`Capture libre` → button reads "Lancer avec téléchargement") confirmed the
console still reacts correctly to the dial with no logic changes. Full
`npm run validate` and a targeted run of `capture-flow.spec.ts` and
`mobile-scroll.spec.ts` passed unchanged.

## 2026-07-10 front panel composition pass

With the front-panel architecture settled (previous section), this pass
audited only its composition — hierarchy, mass, void, alignment, center of
gravity — across six device categories (iPhone SE, iPhone Pro Max, a mid
Android phone, iPad portrait, a 13" MacBook, a 27" display), measuring actual
DOM rects rather than judging by eye.

**Finding, quantified.** `.instrument-face`'s height was `min-height: min(74vh,
640px)`. The 640px ceiling was invisible on phones (74vh already undercuts it)
but actively fought the composition on anything taller: measured against true
viewport center, the control cluster's centroid sat 154px above center on the
iPad viewport and 263px above center on the 27" display, with the leftover
space dumped below as an oversized, unbalanced gap — on the 27" display, over
half the workbench console was already visible in the first viewport, which
is exactly the "explains itself before existing" failure mode the front panel
redesign was meant to close. Removing the ceiling in favor of a floor
(`max(74vh, 460px)`, the floor only ever engaging below any viewport in the
support matrix) dropped the worst center-of-gravity offset from 263px to 50px
and cut the 27" display's leftover peek from 663px to 237px, with zero effect
on the phones and the MacBook, which were never affected by the ceiling.

**Finding, quantified.** The dial, its mode-name caption, the hero button,
and the closing line all sat on one uniform 26px grid gap. Measured, this
meant the mode dial was exactly as far from its own label as the label was
from the button, and the button was exactly as far from the dial above it as
the caption line was from the button — no spatial signal that the dial and
button are one control complex versus the line being a separate, quieter
coda. Retuned to a tiered rhythm — 10px dial-to-label, 18px label-to-button,
34px button-to-line — so the dial reads as mounted to the button rather than
floating independently, while the closing line gets a clear pause before it.
(A `margin-top` on `.instrument-line` initially lost a specificity fight
against the pre-existing `.home-card h1 { margin: 0 }` reset and silently did
nothing; moving it into the already-more-specific
`.instrument-face .instrument-line` rule — the same rule already carrying
the line's font-size override — fixed it. Re-measured after the fix to
confirm the exact 10/18/34 rhythm actually lands on all six viewports, not
just in the stylesheet.)

**Not changed, deliberately.** The curve's own vertical position, the halo,
the dial's and button's internal logic, and the fluid `clamp()`/`vw`-based
sizing already in place for the headline and card gaps were left alone —
each already scales continuously across the six categories without a
per-device override, which is itself the evidence that no bespoke tweak per
screen size was warranted. The hero button's fixed intrinsic width (339px at
every breakpoint, since `.is-hero` is content-sized rather than stretched)
was checked and kept: a physical trigger does not resize with its mounting
plate, and it stayed the strongest fixation point in every capture.

Verified with fresh DOM measurements after each change (not just visual
re-inspection), a scripted mode switch confirming `CaptureModeSelector` still
drives the console correctly, full `npm run validate`, and a targeted run of
`capture-flow.spec.ts` and `mobile-scroll.spec.ts`.

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

## 2026-07-10 mode-specific audio policy

Quality gates are now evaluated with the capture mode that produced the take.
Training keeps the strict dataset thresholds for speech activity, SNR, and
room tone. Dubbing allows more natural pauses and a lower SNR floor, while
mastering allows a wider performance envelope because a monitored return may
change the usable voice dynamics. The selected mode is persisted in
`take.captureContext.captureMode`, so exported quality decisions remain
auditable rather than looking like universal thresholds.

This is intentionally a policy layer, not a DSP layer: the microphone signal
stays raw and the same measured metrics are retained. Future work can add
streaming VAD, chunked long-form capture, and playback-leakage analysis
without changing the capture contract.

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

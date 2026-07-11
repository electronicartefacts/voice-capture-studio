# Phenomenology

Status: living constitution. This document is versioned like code and reviewed
like code. When a pull request changes what the studio looks like, sounds
like, or feels like to operate, it is judged against this document first and
against implementation quality second.

## 0. What this is, and what it isn't

This is not API documentation, not a CSS guide, not a React guide, not a
component guide. Those live in `docs/production-engineering-audit.md`
(how the system is built) and `docs/architecture-doctrine.md` (how the domain
is organized). This document does not explain how the code works. It
explains how the instrument must behave, and it outranks the other two
whenever they conflict on behavior: an implementation choice can be replaced,
a behavioral principle has to be argued out of this file first.

Read this if you are a developer deciding how a feature should transition, or
a designer deciding whether a proposed motion belongs in the product. Neither
audience needs to read code to use it.

## 1. The premise

Voice Capture Studio is not presented to the user as software. It is
presented as an acoustic measurement instrument — closer in register to a
Tektronix oscilloscope, a mastering console, or a Leica than to a productivity
app. The browser is the chassis. The screen is a glass pane over the
instrument's internals, not a UI surface. The microphone is the sensor.

Every rule below exists to serve one outcome: the user should never feel that
they are operating an interface. They should feel that they are observing a
physical process happening in front of them, in real time, faithfully.

## 2. Invariants

Invariants are never traded away for performance, aesthetics, or convenience.
If a change requires sacrificing one of these, the change is wrong, not the
invariant.

1. **The filament (the main curve) always represents a real signal.** It is
   never paused, slowed, or replaced by an approximation while a signal is
   available to show. See `src/app/rendering/liveAudioSignal.ts` and
   `VoiceWaveformSurface.tsx`'s freshness window (260 ms) — past that window
   the surface must fall back to a clearly idle carrier, never a stale live
   frame presented as current.
2. **The halo's energy is always derived from a measured signal.** During
   capture that signal is the live analyser (`measureAcousticField`); during
   playback it is the decoded take's own amplitude
   (`ReviewWaveformBar.rmsPercent`, `src/app/shell/screens/DoneScreen.tsx`).
   It is never a function of elapsed time, word count, or any value that does
   not come from the audio itself.
3. **Capture has absolute priority over every other concern.** While a take
   is being recorded, no rendering budget, scroll state, or measured device
   strain may degrade what represents that take. See
   `getAmbientRenderingBudget` (`src/app/system/renderingBudget.ts`):
   `isCapturing` short-circuits to `"full"` before scroll or strain are even
   consulted.
4. **No animation simulates a measurement.** A number, a level, a ring, a
   waveform bar — if it looks like a reading, it must be backed by one. This
   invariant has already been violated and fixed once (the review-playback
   energy pulse, §8) — the fix, not the bug, is the standard.
5. **Perceived continuity outranks visual impressiveness.** A proposal that
   is more spectacular but less credible is rejected outright, not toned
   down. See §7 and the constraint under which the last several sessions of
   work operated.
6. **Silence is data, not the absence of the instrument working.** A
   measured silence (room tone, a pause mid-take) must remain visibly and
   texturally "on" — see §5 and the open debt in §10 (room-tone dBFS is not
   yet live-ticking, the invariant is aspirational there today).
7. **The instrument never contaminates what it measures.** No audio chime or
   haptic confirmation is added for capture start/stop, because a chime
   would bleed into the very room-tone silence being calibrated, and a
   vibration pulse would physically excite a handheld device's own
   microphone. Rejected explicitly, not merely undiscussed.
8. **No perceptual phenomenon exists without a real, identifiable cause.**
   Every animation must be traceable to an event: a sample arriving, a state
   changing, a user action. "Because it was idle" is not a cause.
9. **Reduced motion removes the animation of a state change, never the
   information in it.** `prefers-reduced-motion` collapses every duration
   toward zero (already global, see `styles.css`); it must never be used as
   an excuse to skip a state's meaning — only its choreography.

## 3. Physical laws

These are the grammar every transition must obey. They are deliberately
mechanical, not poetic — each is checkable in a diff.

1. **Nothing appears; something emerges.** A mount without an entrance
   declaration is a bug, not a lightweight component. (§10 has a live
   inventory of what still lacks one.)
2. **Nothing disappears; something dissipates.** An unmount with no exit
   treatment is only acceptable when the exiting element genuinely cannot
   afford the cost of a transition (a capture screen arming — see law 8, and
   `setScreen` in `App.tsx`). Everything else dissolves.
3. **Nothing jumps; something travels or sweeps.** A value that changes
   state (a percentage, a gauge, a position) interpolates through the space
   between its old and new value. A value that is a discrete fact (a word
   count, a file name) may simply replace itself — see §6 for where the
   line sits.
4. **Nothing changes abruptly; something evolves.** Step changes in opacity,
   scale, or position need a transition unless the element is explicitly a
   low-priority/decorative layer under real device strain (§2.3, the
   `constrained` rendering tier).
5. **Arrival and departure share a grammar, not a duration.** If a state
   change earns choreography on the way in, its reverse earns choreography
   on the way out — not identical timing, but not silence either. This law
   was violated for the entire "leave a capture screen" case until the
   `isArmingCapture` fix in `setScreen`; it is the direct precedent for
   evaluating any new screen or panel.
6. **A one-shot phenomenon must hand back control cleanly.** An animation
   that plays once over a live, reactive property (`halo-ignite` over
   `opacity`/`filter`, `.ambient-backdrop.is-awake .voice-halo`) must not use
   a `forwards`/`both` fill mode that freezes the property after the
   animation ends. When it ends, the real, live-reactive value must resume
   exactly where the animation left off, with no visible seam.
7. **An indeterminate wait gets an indeterminate signal.** Never render a
   determinate progress affordance (a bar with an implied end) for a
   duration the instrument does not control — see `ritual-listening`, which
   loops without implying a fixed length while the user decides on the
   native permission dialog.
8. **Latency-critical causes may skip choreography; everything downstream of
   them may not.** The only standing exception to laws 1–5 is arming a
   capture surface (recording controls must appear with zero added delay).
   That exception is scoped to entry only, never to what follows once the
   surface is live, and never to leaving it.

Laws deliberately not included: a literal "nothing blinks" rule was
considered and rejected as redundant — the recording dot's pulse
(`pulse-record`) is not decorative blinking, it is a bounded-inertia cue with
a real referent (recording is active), which law 4 already covers correctly.

## 4. The perceptual state machine

This is the canonical list of perceptual states. It is the same vocabulary
`Screen`, `RitualStatus`, `isFinalizing`, and `AmbientRenderingBudget` use in
code — this section is the reference those types are named after, not a
parallel invention.

Each state: **intention · energy · speed · what lives · what holds still ·
entry · exit · why**.

### Dormant

Before the ritual is answered. `studioAwake === false`, `ritualStatus ===
"idle"`.

- Intention: an instrument that is off, not absent.
- Energy: near zero, but not exactly zero.
- Speed: static, no user-facing motion.
- Lives: the four halos already orbit (`halo-drift`, 14 s) at `opacity: 0` —
  a real process running unseen, not a paused one.
- Holds still: everything visible.
- Entry: page load.
- Exit: a click on the ritual button.
- Why: an instrument that is "off" should still be true the instant it
  turns on — nothing should have to spin up from nothing.

### Sensor handshake

`ritualStatus === "requesting"`. The native permission dialog is open.

- Intention: signal that a decision is pending, and it is not ours.
- Energy: low, looping, indefinite.
- Speed: slow (1.6 s ring cycle).
- Lives: `ritual-button.is-requesting::before` (the listening ring).
- Holds still: everything else — this state must not compete with the
  browser's own permission chrome.
- Entry: `awakenStudio()` calling `getUserMedia`.
- Exit: permission resolved (granted → Ignition; denied → declined).
- Why: law 7 — an indeterminate wait needs an indeterminate signal.

### Ignition

The instant `studioAwake` flips true. One-shot, not a steady state.

- Intention: the sensor coming online, once, irreversibly.
- Energy: a brief spike, then settling.
- Speed: 1.4 s, non-repeating.
- Lives: `halo-ignite` (blur 6px → 96px, opacity 0 → live value).
- Holds still: the filament canvas, which fades in over its own 1000 ms
  independently.
- Entry: `is-awake` class applied.
- Exit: animation completes and hands off to the live `--audio-level`
  reactive opacity/filter (law 6 — no frozen fill mode).
- Why: this is the one moment in the whole app that only happens once per
  session; it is the closest thing the instrument has to a power-on light.

### Home / Ready

`screen === "home"`, studio awake, no capture in flight.

- Intention: a calm console, not a landing page.
- Energy: low ambient.
- Speed: static once settled.
- Lives: the halo continues to respond to ambient mic level; the coverage
  ring sweeps (`@property --coverage`, 700 ms) whenever progress changes.
- Holds still: layout, cards, text.
- Entry: dissolve via `startViewTransition` from wherever the user came
  from.
- Exit: dissolve toward `permission` (or `technical`).
- Why: this is a waiting state with real content (coverage, diagnostics),
  not a blank canvas — see §5 on silence vs. absence.

### Threshold (pre-capture briefing)

`screen === "permission"`. The prompt direction / room-note screen shown
before arming capture.

- Intention: the last calm moment before recording starts.
- Energy: low.
- Speed: static.
- Lives: the halo, ambient level.
- Holds still: the prompt card.
- Entry: dissolve in.
- Exit: **instant** toward `calibration` (law 8 exception — arming capture).
- Why: everything after this point is latency-critical; this is the last
  screen allowed to spend a transition budget before recording controls
  must appear.

### Calibration (room tone)

`screen === "calibration"`.

- Intention: measure the room without judging it.
- Energy: very low, slow breathing tied to real ambient level.
- Speed: near-static; the only motion is the `room-tone-core` orb scaling
  with `--audio-level`.
- Lives: the orb, the live percentage readout.
- Holds still: everything else — no decorative motion competes with a
  measurement in progress.
- Entry: instant (law 8 exception).
- Exit: instant toward `karaoke` (still inside the capture exception).
- Why: this screen's entire purpose is a real, if informal, acoustic
  measurement; see §10 for the one place this state still falls short of
  its own invariant (the dBFS reading is not yet live).

### Capture (recording)

`screen === "karaoke"`, `isFinalizing === false`.

- Intention: total fidelity, zero interpretation.
- Energy: matches the voice, sample for sample.
- Speed: display cadence (up to 60 fps, with a 30 fps constrained floor), never throttled
  regardless of scroll or measured device strain (invariant 3).
- Lives: the filament, the meter bar, the halo, the karaoke text's
  amplitude-driven wave.
- Holds still: layout chrome, the stop button's position.
- Entry: instant from calibration.
- Exit: instant (recorder stop happens synchronously with the click; the
  screen itself does not change yet — see Finalization).
- Why: this is the state every other invariant in this document exists to
  protect.

### Finalization ("fin de prise")

`screen === "karaoke"` still, `isFinalizing === true`. The recorder has
already stopped; encoding and persistence are running.

- Intention: a tension, not a void — real work is happening after the
  performance ends.
- Energy: low but not idle.
- Speed: bounded by real async work (encode, save), typically under a
  second.
- Lives: the recording dot keeps its pulse (a legitimate "system busy" cue,
  not a claim about live audio — see §6 on where non-representational
  activity indicators are allowed).
- Holds still: the filament (no more live signal to show), the stop button
  (disabled, not hidden).
- Entry: `isFinalizing` set true, synchronous with the click.
- Exit: dissolve toward `done` once `persistFinishedSession` resolves —
  this is the transition the `isArmingCapture` fix restored (§3, law 5).
- Why: named directly in this project's own governing vocabulary as the
  moment the instrument stops and archives its result; it must not read as
  a crash or a freeze.

### Archive reveal ("construction de l'empreinte")

The first paint of `done`, before the waveform has finished decoding.

- Intention: an artifact settling into its final shape.
- Energy: low.
- Speed: the dissolve from Finalization, then whatever real time the
  `decodeAudioData` call takes.
- Lives: placeholder waveform bars (an honest "not yet measured" shape, not
  a fake final one) until `decodedBars` resolves.
- Holds still: everything else.
- Entry: the `karaoke → done` dissolve.
- Exit: replaced in place once real bars are decoded — no re-transition,
  the placeholder is superseded, not removed and re-emerged.
- Why: see §10 — a progressive left-to-right reveal of the real bars was
  considered and deferred as too costly for this pass, but the state itself
  (placeholder vs. real) already exists and must not be conflated.

### Review / Listening

`screen === "done"`, playback active or scrubbing.

- Intention: the instrument reproduces exactly what it captured.
- Energy: follows the decoded take's real amplitude
  (`ReviewWaveformBar.rmsPercent`) — see invariant 2's fix history.
- Speed: sample-accurate to playback position, smoothed (0.35 EMA) only to
  remove bucket-boundary stepping, never to invent a shape.
- Lives: the halo, the filament, the scrub position.
- Holds still: the static waveform bars (they are the take's fingerprint,
  not a live signal).
- Entry: dissolve.
- Exit: dissolve toward `home` (already correct — the one screen pair that
  needed no fix).
- Why: this is where the "no simulated measurement" invariant is most
  exposed to the user's own ears — any mismatch between what is heard and
  what is shown is immediately, viscerally caught.

### Diagnostics

`screen === "technical"`.

- Intention: a clinical register — this is the instrument's service panel.
- Energy: moderate ambient reactivity (`getLiveWaveGain("technical") ===
0.85`), deliberately higher than Home's, because this screen's entire
  content is about signal presence.
- Speed: static layout.
- Lives: the halo, the filament, at closer-to-capture energy.
- Holds still: the diagnostic list.
- Entry / exit: dissolve.
- Why: distinguishing this state's energy from Home's is what keeps it
  from reading as "another settings page."

### Return to rest

`done → home`, or any dissolve back to a resting screen.

- Intention: redescent, not reset.
- Energy: fading to Home's ambient baseline.
- Speed: the `startViewTransition` default crossfade.
- Why: already compliant; the benchmark every other exit is measured
  against.

The rendering budget (`full` / `constrained` / `paused`,
`src/app/system/renderingBudget.ts`) is not a perceptual state — it is a
hidden regulator that only ever touches secondary/decorative fidelity
(ambient idle frame rate, acoustic-field read cadence), and invariant 3
guarantees it can never reach the states above where capture is in progress.
It should never appear in this list as a state a user perceives; if a future
change makes it perceptible, that is itself a bug against invariant 3.

## 5. Temporal laws

**A wait is not a void.** Every state in §4 that involves waiting
(handshake, calibration, finalization) has a real signal proving the
instrument is still working — a ring, a breathing orb, a pulsing dot. A
screen with nothing moving during real work is indistinguishable from a
frozen tab, which is the one impression this product may never give.

**A silence is not an absence.** Room tone at true silence still has a real,
non-zero reading; the orb must still show some real, if faint, reaction to
it, not settle to a flat, unmoving zero. (See §10: this law is only partly
implemented today — the numeric dBFS reading is not yet live.)

**A transition is not an animation.** An animation is decorative motion
attached to something that already changed. A transition _is_ the state
change — the dissolve between `karaoke` and `done` does not decorate the
handoff, it constitutes it. This distinction is why `startViewTransition`
(native, state-coupled) is preferred over a CSS entrance keyframe layered on
top of an instant swap: the former cannot exist without the state change
happening; the latter can be added or removed without the state machine
noticing, which is a sign it was never really representing the transition.

## 6. Truth laws

Voice Capture Studio is an instrument; its display must never claim a
precision or a reality it does not have.

**Interpolation is acceptable** between two real, measured endpoints. The
filament's temporal interpolation between live samples, the coverage ring's
sweep between two real percentages, the 0.35 EMA smoothing of decoded
playback loudness — all interpolate between facts, they invent nothing.

**Smoothing is acceptable** to remove sensor or presentation noise, never to
change what is reported as fact. The ambient RMS's 30% smoothing, the frame
pace monitor's EMA — all shape _how_ a real quantity is displayed from frame
to frame, but the number shown as a fact (peak dBFS, LUFS, SNR in the review
screen) is always the raw measured value, never the smoothed display curve
mistaken for data.

**The line into deception** is crossed the moment an animated value has no
real endpoint driving it. The canonical, now-fixed example: the review
screen's halo/filament energy used to be `Math.sin(progress × word count)` —
a value with no relationship to the audio actually playing. It looked alive
and was lying. The fix (§2, invariant 2) replaced it with the take's own
decoded amplitude. Any future proposal that reintroduces a canned curve in
place of a real read is the same bug wearing a different file name.

**A non-representational activity indicator is not deception**, provided it
never claims to represent a measured signal. The recording dot's pulse
during finalization is legitimate exactly because it never claims to be
audio level — it is a system-busy cue, the visual equivalent of a spinner. It
would become deceptive only if it started reacting to `--audio-level` while
no live signal exists.

**A discrete fact does not need to sweep.** A word count, a file name, a
saved-location string may simply replace itself instantly. Forcing every
number through an interpolation, including ones that were never a continuous
measurement, is over-application of law 3 in §3 and produces exactly the
kind of decorative motion §7's anti-patterns forbid.

## 7. Perceptual laws

The principles that make the instrument credible, independent of any single
feature:

- **Signal priority.** Whatever represents the actual voice always wins the
  frame budget, the z-order, and the designer's attention first.
- **Economy of movement.** The fewer things move at once, the more
  believable the one thing that does. A screen with five simultaneous
  motions reads as an interface animating; a screen with one reads as a
  phenomenon happening.
- **Continuity.** Consecutive frames, and consecutive states, must feel like
  the same organism, not a handoff between components (this is the
  "breathing" the whole product is judged against — see §3, laws 1–5).
- **Stability.** Layout and chrome do not move to accommodate motion
  elsewhere; only the elements whose job is to react, react.
- **Legibility.** A user must always be able to say, without thinking, "the
  instrument is doing X right now." If a state cannot be named at a glance,
  it needs a clearer signal, not a more elaborate one.
- **Causality.** Every visible change traces to a cause a user could name:
  a sound, a click, a measurement completing. If the cause can't be named,
  the effect shouldn't exist (§2, invariant 8).
- **Anticipation.** A state that is about to change should telegraph it
  faintly before the change lands — the listening ring while permission is
  pending, the ignition's brief focus-pull before the halo settles. The
  instrument should never simply cut to its next state without a hint the
  cut was coming, except where law 8 (§3) explicitly permits it for
  latency.

## 8. Anti-patterns — never do this

- **Invent a movement with no real event behind it.** (Fixed instance: the
  review-playback sine-wave energy, §6.)
- **Add an animation because it is aesthetically pleasing, not because a
  state changed.** If you can delete the triggering event and the animation
  still fires, delete the animation instead.
- **Cut a continuous phenomenon off abruptly** when a transition budget is
  affordable. (Fixed instance: `karaoke → done` used to be an instant
  unmount; see §3, law 5.)
- **Replace a real measurement with a plausible-looking approximation.**
  Ever, for any reason, including performance.
- **Prioritize the effect over comprehension.** If a proposal is more
  impressive but leaves the user less sure what just happened, reject it.
- **Freeze a live-reactive CSS property with a `forwards`/`both` fill mode**
  on a one-shot animation. It silently and permanently overrides the real
  signal after the animation ends. (Concrete gotcha from implementing
  `halo-ignite`; the kind of bug that looks correct in review and wrong five
  seconds after the page loads.)
- **Add a determinate progress affordance for a duration you don't
  control.** A progress bar implies a knowable end; a native permission
  dialog's duration is the user's, not the instrument's.
- **Add sound or haptic confirmation cues.** Explicitly rejected: they
  contaminate the very acoustic signal, or the very device, being measured.
- **Let a measured device-strain signal touch anything while capture is in
  progress.** The `constrained` rendering tier exists purely for idle
  screens; if it ever reaches a capturing state, that is invariant 3
  breaking, not a tuning parameter to adjust.
- **Treat an ongoing measurement's quiet output as "nothing is happening"
  and stop rendering feedback for it.** Silence during calibration is data;
  it must keep looking measured, not paused.
- **Fabricate false precision by animating a counter that was never a
  continuous quantity.** Not every number needs to sweep; some numbers are
  just facts (§6).

## 9. Using this document

A pull request that adds, removes, or changes a screen, transition, or
reactive visual should be able to answer, in its own description or in
review:

1. Which state(s) in §4 does this touch, and does the change match that
   state's documented energy/speed/behavior?
2. Which invariant(s) in §2 could this regress, and how does the change
   avoid regressing them?
3. Does every new or changed animation obey the physical laws in §3 —
   specifically, does it emerge/dissipate/travel/evolve, and does it have a
   real, nameable cause?
4. If it displays a number or a level, is it interpolating or smoothing
   between real values (§6, acceptable), or animating toward a value that
   isn't real yet (§6, not acceptable)?
5. Does it introduce, or fix, anything on the anti-pattern list in §8?

If a reviewer cannot answer these from the PR description, the PR is not
ready for review on its merits — regardless of how correct its code is.

## 10. Known perceptual debt

Real, identified gaps against this constitution, left unfixed because their
cost outweighs the size of a single focused change. Each is a legitimate
future task, not an oversight to be silently tolerated.

1. **Calibration's dBFS reading is not live.** `RoomToneCalibrationScreen`
   shows a live instantaneous percentage, but the noise-floor dBFS value
   (`roomToneNoiseFloorDbfs`) only appears after calibration completes.
   Invariant 6 ("silence is data") is only partly satisfied today — the orb
   breathes with real signal, but the precise number the user eventually
   sees does not resolve live in front of them. Fixing this touches the
   capture-profile computation, the calibration screen, and the number
   formatting in at least three places — real work, not a one-line change.
2. **The review waveform does not "etch in."** `DoneScreen`'s decoded
   waveform bars replace the placeholder in one batch once
   `extractReviewWaveformBars` resolves, rather than revealing
   progressively left to right. A stamped-imprint reveal would strengthen
   invariant 4 and the "empreinte, not file" framing, but needs new
   per-segment timing machinery, which is more than a single scoped change.
3. **Native `<details>` disclosures have no open/close transition.**
   "Nouvelle voix", "Profil audio" and similar panels snap open and shut
   (law 4 in §3, violated). Cross-browser CSS support for animating
   `<details>` height is still uneven enough that a reliable fix is a
   dedicated piece of work, not a cheap patch.
4. **Home's "Prêt" state has no ambient breathing beyond the halo.** The
   coverage ring and status pills are otherwise fully static once settled.
   A subtler idle-state breathing was considered and rejected as too
   diffuse to land as one scoped change (§7, economy of movement cuts both
   ways: adding motion everywhere is its own anti-pattern).

Fixed in this pass, as a direct consequence of writing this document: two
conditionally-mounted panels (`.system-health`, `.workspace-backup`) had no
entrance treatment at all — a direct, cheap violation of law 1 (§3). Both
now reuse the existing `materialize` keyframe already established for
`.simple-header`/`.site-footer`.

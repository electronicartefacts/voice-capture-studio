# Native browser experience audit

Date: 2026-07-10. Scope: the static GitHub Pages build; no backend, cookies,
or server-side share target are required.

## Result

The application uses each browser's native surfaces instead of imitating them:
the microphone permission prompt, File System Access picker where supported,
download fallback elsewhere, browser PWA install surface, native media output,
and Wake Lock when available. Unsupported capabilities are not rendered as
broken promises: folder storage falls back to IndexedDB/downloads and Wake Lock
is reported as a limited runtime capability.

## Platform matrix

| Platform / browser       | Native behavior                                                                                        | Result and fallback                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS / iPadOS Safari      | `viewport-fit=cover`, safe-area insets, Dynamic Viewport and VisualViewport, standalone display signal | Full-edge PWA layout now tracks browser chrome and keyboard; headers, onboarding and footer clear notch, Dynamic Island and Home Indicator. Safari has no File System Access/Wake Lock guarantee, so local storage and download exports remain primary. |
| macOS Safari             | native microphone prompt, downloads, keyboard and high-DPI canvas                                      | No fake permission UI or file picker. Canvas DPR is capped for predictable Retina performance.                                                                                                                                                          |
| Chrome Android / desktop | VisualViewport, Wake Lock, File System Access, install UI                                              | Visible viewport prevents keyboard overlap; screen stays awake during recording; direct folder export is offered only when supported.                                                                                                                   |
| Edge / Windows           | Chromium platform APIs, native download/file picker, PWA window controls overlay                       | The manifest requests `window-controls-overlay` first, then standalone/minimal UI fallback.                                                                                                                                                             |
| Firefox / Linux          | microphone prompt, IndexedDB, downloads, keyboard navigation                                           | Uses standards-based recording/storage/export path; unsupported folder and Wake Lock capabilities never block a recording.                                                                                                                              |
| ChromeOS                 | installable standalone app, keyboard/pointer, File System Access when exposed                          | Same progressive folder and PWA path as Chromium, with native picker retained.                                                                                                                                                                          |

## Implemented improvements

- Dynamic viewport handling progresses through `100vh`, `100svh`, and `100dvh`, then uses `VisualViewport` as the real visible-height signal. Updates are animation-frame coalesced and unchanged geometry is ignored, avoiding layout churn while Safari moves its browser chrome.
- `viewport-fit=cover` and safe-area padding protect interactive content from display cutouts and the bottom gesture area; landscape onboarding compresses without forcing a portrait-only recording flow.
- Mobile controls use touch manipulation behavior and 16px minimum text inputs to prevent accidental double-tap delay and iOS form zoom. Native elastic scrolling is deliberately preserved.
- The manifest has a stable ID, standalone/window-controls display fallback, maskable icon declaration, meaningful categories and a start shortcut. The service worker cache revision was advanced so installed clients fetch the new shell.
- Existing strengths retained: reduced-motion styles, light/dark system colors, focus-visible rings, keyboard-accessible waveform seeking, Pointer Events, page visibility handling, filesystem capability gating, IndexedDB/download fallbacks and Wake Lock reacquisition after foregrounding.

## Browser API assessment

| API                                                                              | Recording value                                         | Decision                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| MediaDevices, AudioContext, MediaRecorder/Web Audio                              | Essential capture and monitoring                        | In use with diagnostics and capability-aware errors.                                                   |
| VisualViewport                                                                   | Keyboard, URL-bar and split-screen geometry             | Added.                                                                                                 |
| Wake Lock + Page Visibility                                                      | Prevent interruption during a take                      | In use; reacquired on foregrounding.                                                                   |
| File System Access                                                               | Native folder workflow on Chromium                      | In use, hidden behind capability gate.                                                                 |
| StorageManager                                                                   | Useful but not guaranteed persistent storage            | Current IndexedDB/download fallback remains correct; do not prompt or promise persistence.             |
| Web Share                                                                        | Useful only for user-authored export sharing            | Not added: recording workflow is local dataset capture and an unsolicited share action would be noise. |
| Screen Orientation / Fullscreen                                                  | Can disrupt recording or need gestures                  | Not forced; the responsive landscape layout respects user/device choice.                               |
| Clipboard / Notifications / Idle Detection / Network Information / Device Memory | No essential capture benefit and/or privacy/prompt cost | Intentionally omitted.                                                                                 |

## Verification

- Unit coverage verifies viewport fallback and iOS standalone detection.
- Browser coverage verifies the live platform shell contains the measured viewport
  value and touch-safe onboarding control. Existing mobile scroll, PWA/offline,
  keyboard waveform and capture flows remain part of the full test suite.
- Cross-engine behavior is based on feature detection and standard CSS/API
  fallbacks; Safari, Firefox and Edge do not receive Chromium-only controls.

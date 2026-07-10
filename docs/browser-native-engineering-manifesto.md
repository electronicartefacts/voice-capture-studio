# Browser-Native Engineering Manifesto

Voice Capture Studio is a browser-native voice laboratory. The browser is the runtime, and the
core product must remain a static, open-source application that can run from GitHub Pages, local
static hosting, and offline-capable browser storage where platform capabilities allow.

## Non-negotiable boundaries

1. No backend, account, cloud service, desktop runtime, or proprietary service is required for
   core capture, analysis, storage, or export.
2. Voice data, projects, transcripts, datasets, and exports stay on the user's device by default.
   Any future integration that leaves the device is opt-in, clearly disclosed, and additive.
3. Every capability is detected at runtime. A missing optional API limits only the dependent
   enhancement; it never disables recording, local persistence, or export without a real browser
   constraint.
4. Native Web APIs are preferred before a dependency: MediaDevices, Web Audio and AudioWorklet,
   IndexedDB, File System Access, Workers, Streams, Compression Streams, Canvas/WebGL/WebGPU,
   Wake Lock, Permissions, StorageManager, and accessibility media queries.
5. The static GitHub Pages build is a release gate, not a secondary distribution target.

## Engineering decision gate

Before accepting a feature, verify that it:

- works entirely in a modern browser and remains deployable as static files;
- processes sensitive voice data locally by default;
- uses progressive enhancement and preserves a useful fallback in Chrome, Edge, Safari, and
  Firefox across desktop and mobile platforms;
- exposes its capability state in the interface rather than assuming support;
- improves the recording workflow, quality assessment, or user ownership of the resulting data.

If an idea needs a server for its essential path, it is not part of the core architecture. Redesign
it as an optional integration or keep it outside this repository.

## Runtime contract

At startup and on refresh, the studio inspects the secure context, microphone permission and audio
inputs, Web Audio, local storage, IndexedDB, folder export, downloads, Wake Lock, optional speech
APIs, Workers, accelerated rendering, and the user's reduced-motion preference. The interface
uses this capability report to select the best available workflow while retaining compatibility
paths.

The `Studio Ready` report is advisory: device enumeration may be withheld until a browser grants
permission, so a deferred device count is not treated as a recording failure. The actual
`getUserMedia` result remains authoritative for the selected microphone.

## Research roadmap

Continuously evaluate browser advances against this contract, especially: AudioWorklet and
low-latency capture improvements; local model execution and WebGPU; audio codec and streams
support; File System Access interoperability; offline/PWA storage durability; Web Speech
availability; and accessible touch, pointer, and motion-aware studio controls. Record findings in
the relevant technical audit before making them a product dependency.

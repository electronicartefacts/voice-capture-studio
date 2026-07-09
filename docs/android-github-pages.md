# Android + GitHub Pages

Voice Capture Studio is a static Vite app and can be hosted on GitHub Pages at:

```text
https://electronicartefacts.github.io/voice-capture-studio/
```

## Android Browser Support

Recommended browser: Chrome for Android.

Supported on Android:

1. Microphone capture through `navigator.mediaDevices.getUserMedia`.
2. PCM capture through Web Audio.
3. WAV PCM mono 48 kHz / 24-bit export.
4. Local workspace and recordings through IndexedDB/localStorage.
5. Download buttons for audio and metadata.
6. PWA install via browser menu.

Expected Android limitation:

1. `showDirectoryPicker` is usually unavailable.
2. The app falls back to browser storage plus explicit downloads.
3. Users should move downloaded WAV/JSON files from Downloads, Drive, or their file manager.

## GitHub Pages Setup

The workflow lives in `.github/workflows/pages.yml`.

Repository settings:

1. Go to Settings -> Pages.
2. Set Source to GitHub Actions.
3. Push to `main`.
4. The workflow builds `dist/` and deploys it.

Local verification:

```bash
npm ci
npm run validate
npm run preview
```

For microphone access on a phone, use the deployed HTTPS GitHub Pages URL. Browser microphone APIs
will not work from plain HTTP except on localhost.

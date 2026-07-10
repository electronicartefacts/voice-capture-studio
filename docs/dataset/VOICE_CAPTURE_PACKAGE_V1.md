# Voice Capture Package v1

`voice.capture.package.v1` is the Forge handoff contract for Voice Capture Studio.
It exports an explicit, self-validating package rooted at `voice-capture-package/`.

## Required package shape

```text
voice-capture-package/
  manifest.json
  samples.jsonl
  checksums.sha256
  README.md
  audio/<audio_id>.wav
  speakers/<speaker_id>.json
  sessions/<session_id>.json
  corpora/<corpus_id>/<corpus_version>.json
  text/<utterance_id>.json
  alignment/<take_id>.json
  quality/<take_id>.json
  reviews/<take_id>.json
  rights/consents.jsonl
  rights/licenses.jsonl
  rights/text-provenance.jsonl
  reports/package-readiness.json
  reports/quality-summary.json
  reports/coverage-summary.json
  reports/forge-compatibility.json
```

The exporter writes only raw immutable capture audio. There is no processed audio
folder until the application has a real, traceable processing pipeline.

## Scope rules

Every package is built from an explicit scope:

- dataset id and project id
- speaker ids
- languages and locales
- corpus id/version refs
- session ids
- accepted take statuses

The UI currently exports the selected speaker, selected language, selected
corpus, and keeper takes from matching captured sessions. Multi-session,
multi-speaker, and multi-language packages are supported by the lower-level
contract when the caller provides the matching explicit scope and every sample
has full provenance.

## Integrity rules

`manifest.json` lists every payload artifact except `manifest.json` and
`checksums.sha256`. Each artifact records path, type, media type, byte size,
SHA-256, logical owner, requirement status, schema version, and creation time.

`checksums.sha256` covers `manifest.json` and every payload artifact. It excludes
itself to avoid a circular checksum.

Package validation fails on:

- unsafe paths, absolute paths, `..`, backslashes, control characters, or long
  path segments
- duplicate package paths
- missing manifest or checksum files
- missing artifact paths
- artifact size or hash mismatches
- missing sample references
- malformed `samples.jsonl`

## Audio rules

Each sample audio object is validated from the final Blob, not from metadata
alone. The accepted audio shape is:

- RIFF/WAVE
- PCM integer
- mono
- 48 kHz
- 24-bit little-endian
- complete data chunk alignment

Missing audio or non-canonical WAV aborts package creation. The v1 exporter does
not silently omit audio.

## Room tone

Current legacy calibration stores aggregate room-tone measurements, not the raw
room-tone audio. The v1 package records that fact explicitly in session context
and package warnings. It does not fabricate a `room-tones/*.wav` artifact.

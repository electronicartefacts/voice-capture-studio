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
  text/<take_id>.json
  alignment/<take_id>.json
  quality/<take_id>.json
  observations/<take_id>.json
  evidence/<take_id>.json
  reviews/<take_id>.json
  rights/consents.jsonl
  rights/licenses.jsonl
  rights/text-provenance.jsonl
  reports/package-readiness.json
  reports/quality-summary.json
  reports/coverage-summary.json
  reports/duplication-audit.json
  reports/forge-compatibility.json
```

The exporter writes only raw immutable capture audio. There is no processed audio
folder until the application has a real, traceable processing pipeline.

New takes add an observation graph without changing the v1 package root. The
observation file keeps corpus declarations, PCM measurements, energy-derived
VAD, optional browser ASR hypotheses, G2P output, preparatory alignment, and
per-word/per-phoneme fusion decisions as separate evidence. Historical takes
without this additive file remain exportable.

Every observation carries a status (`measured`, `observed`, `estimated`,
`declared`, `unavailable`, or `human_review`), a source, a confidence when the
producer exposes one, and a reason. In particular, G2P never claims to observe
audio and preparatory boundaries are always marked estimated.

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

## Duplication and leakage rules

`reports/duplication-audit.json` groups repeated samples independently by exact
audio SHA-256, normalized text hash, and corpus provenance. Repeated text or
provenance is preserved because multiple genuine performances are useful, but
their existing group ids must remain together during downstream split
assignment. Exact duplicate audio is stored once and blocks Forge ingestion
until deduplicated; it must never silently inflate a dataset or cross splits.

The downloadable ZIP is reopened after serialization and validated again from its stored entries.
Download is refused when the final archive contains an unmanifested file, a missing or duplicate
checksum, an artifact hash/size mismatch, a broken sample reference, an unresolved rights reference,
or audio bytes that disagree with the sample's SHA-256, byte size, WAV shape, or duration.

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

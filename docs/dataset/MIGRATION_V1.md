# Migration To Package v1

Existing workspaces can contain takes created before immutable media and capture
context fields were introduced. The v1 exporter keeps them importable while
making gaps explicit.

## Legacy handling

- Existing take ids are preserved as logical ids.
- Package file names use stable safe tokens, so legacy ids with punctuation do
  not become unsafe paths.
- Missing `take.captureContext` becomes `null` in `take_contexts`.
- Missing media provenance is reported as a package warning.
- Missing consent and license records become `unknown` rights rows.
- Legacy room-tone calibration is exported as aggregate context only.

## Non-negotiable failures

The exporter still fails when a selected take has no readable audio Blob, has a
non-canonical WAV container, has an audio SHA-256 mismatch against stored media
identity, or cannot be connected to a supplied corpus snapshot.

## New capture behavior

New takes receive UUID-based `take_id` values and store immutable media identity
plus capture context at finalization. The browser storage layer refuses to
replace an existing recording entry with the same file name.

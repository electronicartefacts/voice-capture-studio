# Forge Handoff

Forge should treat `voice.capture.package.v1` as the ingestion boundary for
Voice Capture Studio exports.

## Ingestion order

1. Read `manifest.json`.
2. Verify `checksums.sha256`, including `manifest.json`.
3. Verify every manifest artifact path, byte size, and SHA-256.
4. Stream `samples.jsonl`.
5. Resolve sample references to audio, text, quality, alignment, session,
   speaker, corpus, and rights artifacts.
6. Read `reports/forge-compatibility.json`.

## Readiness meaning

`manifest.readiness.forge_ingestion_ready` means the package has resolved rights
and passed local integrity gates. It does not mean the samples are automatically
training accepted.

`manifest.readiness.training_ready` is stricter and currently remains false
unless all samples are explicitly `training_accepted`.

`downstream_required` lists work that Forge or another downstream system must do,
such as external forced alignment or human review.

## Local paths and PII

Package files use package-relative paths only. The exporter rejects path escape
attempts and does not include local absolute filesystem paths. Speaker artifacts
are pseudonymized; display names are not exported in v1 speaker records.

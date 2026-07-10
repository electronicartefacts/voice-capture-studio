# Rights And Provenance

The v1 package never invents consent.

## Rights states

Consent and license records use explicit statuses:

- `pending`
- `granted`
- `denied`
- `revoked`
- `expired`
- `unknown`

Legacy workspaces do not contain durable rights records, so their package rows
default to `unknown`. Forge ingestion readiness is blocked until all required
consents and licenses are explicit `granted`.

## Provenance records

Every sample carries:

- speaker id
- session id
- corpus id/version provenance
- prompt/utterance id
- text source hash
- normalized text hash
- audio path, SHA-256, and byte size
- quality artifact path
- alignment status and artifact path when available
- capture context reference
- consent and license references

Missing legacy fields are represented as `null`, `unknown`, or explicit warning
records. Consumers must not infer missing consent, device data, room-tone audio,
or human validation from absent fields.

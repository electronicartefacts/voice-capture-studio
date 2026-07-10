# Workspace Structure

The workspace is local user data and must never be committed. It is the source of truth for sessions, takes, and progress.

Recommended future on-disk layout:

```text
Voice Capture Studio Workspace/
  workspace.json
  sessions/
    session_2026-07-08T21-30-00Z.json
  takes/
    session.2026-07-08T21-30-00Z.webm
  session.2026-07-08T21-30-00Z/
    session.json
    takes/
      take.2026-07-08T21-30-08Z/
        transcript.txt
        timing.json
        intent.json
        quality.json
        observation.json
        evidence.json
  exports/
    voice.capture_session/
      manifest.json
```

`workspace.json` should keep durable references and progress:

```json
{
  "schemaVersion": 1,
  "workspaceId": "workspace.local.main",
  "createdAt": "2026-07-08T21:30:00.000Z",
  "updatedAt": "2026-07-08T21:35:00.000Z",
  "speakers": [
    {
      "speakerId": "speaker.primary",
      "displayName": "Primary Voice",
      "languages": ["fr", "en"]
    }
  ],
  "corpusProgress": [
    {
      "corpusId": "corpus.canonical",
      "corpusVersionSeen": "0.1.0",
      "speakerId": "speaker.primary",
      "language": "fr",
      "completedScenarios": ["scenario.fr.daily-presence.v1"],
      "completedPrompts": ["prompt.fr.daily-presence.001"]
    }
  ],
  "sessions": ["session.2026-07-08T21-30-00Z"],
  "capturedSessions": [
    {
      "id": "session.2026-07-08T21:30:00.000Z",
      "plannedPromptIds": ["prompt.fr.directed-assistant.001"],
      "takes": [
        {
          "id": "take.2026-07-08T21:30:08.000Z",
          "promptId": "prompt.fr.directed-assistant.001",
          "fileName": "session.2026-07-08T21-30-00.000Z.webm",
          "quality": {
            "schemaVersion": "voice.quality.v2",
            "verdict": "pass"
          }
        }
      ]
    }
  ],
  "settings": {
    "preferredSessionMinutes": 5,
    "storageMode": "file-system-access",
    "captureProfile": {
      "microphoneName": "SM7B",
      "audioInterface": "Apollo Solo",
      "mouthToMicDistanceCm": 15,
      "roomDescription": "Dry treated office",
      "roomToneCaptured": true
    }
  }
}
```

Workspace rules:

1. Store prompt identifiers, not prompt text snapshots.
2. Store corpus version seen for compatibility diagnosis.
3. Store recordings as local files referenced by session metadata.
4. Keep migrations explicit whenever `schemaVersion` changes.
5. Store complete session metadata locally so a take can be reviewed without reopening the corpus.
6. Keep capture profile data with the workspace and copy it into Forge session metadata.

## Restorable archive

The technical page exports `voice-capture-studio.*.workspace.zip` as the
portable recovery unit:

```text
manifest.json
audio/<sha256>.wav
audio/<sha256>.wav
...
```

The manifest stores the complete workspace plus a mapping from every referenced
recording file name to its content-addressed WAV. Export aborts if any referenced
audio is missing, malformed, or inconsistent with its stored media identity.

Import is intentionally strict:

1. ZIP paths, sizes, entry count and CRC32 values are checked before use.
2. The archive format and workspace schema must be supported.
3. Every workspace audio reference must have exactly one manifest mapping.
4. Every WAV must be canonical mono 48 kHz / 24-bit PCM and match its SHA-256.
5. Existing browser recordings are reused only when their hash matches; a name
   collision with different bytes cancels the restore.
6. New WAVs are added in one IndexedDB transaction before the restored workspace
   is saved, so progress can never point at a partially imported batch.

The smaller JSON backup remains an emergency metadata-only download for
memory-only browser sessions. The ZIP archive is the complete cross-profile
backup because it includes the audio itself.

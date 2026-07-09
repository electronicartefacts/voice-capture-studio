# Export Structure

The primary export target is a Forge-compatible `voice.capture_session` folder. Voice Capture
Studio keeps the current Forge archive shape, but every take is enriched enough for premium voice
training and review.

Required folder shape:

```text
session.json
speaker.json
corpus.json
manifest.json
takes/<take_id>/audio.wav
takes/<take_id>/transcript.txt
takes/<take_id>/timing.json
takes/<take_id>/phonemes.json
takes/<take_id>/intent.json
takes/<take_id>/quality.json
reports/report.audio_quality.json
reports/report.transcript_alignment.json
reports/report.phonetic_coverage.json
reports/report.intent_balance.json
reports/report.prosody_distribution.json
reports/report.dataset_readiness.json
```

`intent.json` uses `voice.intent.v2` and stores:

1. Primary and secondary intent.
2. Use case.
3. Valence, arousal, dominance, and labels.
4. Delivery: pace, energy, articulation, projection, smile, breathiness, pause style.
5. Direction notes and explicit avoid-list.
6. Prosody target.

`timing.json` uses `voice.timing.v2` and now embeds a `voice.phoneme_alignment.v1` estimate. Each
word contains token metadata, estimated start/end time, confidence, syllable count, and phoneme
intervals. `phonemes.json` repeats this map in a pipeline-friendly shape so downstream forced
alignment tools do not need to parse the full take timing object.

`quality.json` uses `voice.quality.v2` and stores:

1. Technical metrics: sample rate, bit depth, channels, peak dBFS, LUFS, noise floor, SNR,
   clipping, reverb, plosives, mouth noise.
2. Performance metrics: transcript match, alignment confidence, phoneme inventory count,
   word/phoneme link rate, intent match, prosody variation, human naturalness review, keeper flag.
3. Quality gates for clipping, noise, duration, audio persistence, transcript, intent, and prosody balance.
4. Verdict: `pass`, `review`, or `reject`.

The browser implementation now writes WAV PCM mono 48 kHz / 24-bit when the Web Audio API is
available. It computes local technical metrics for `quality.json`: peak dBFS, integrated LUFS
estimate, noise floor, SNR, clipping, reverb estimate, plosive score, and mouth-noise score.

`manifest.json` is generated after files are written and includes SHA-256 checksums for every
artifact written by the browser export path.

Forge pipeline stages:

```text
voice_capture_archive
  -> validate_audio_quality
  -> normalize_metadata
  -> forced_alignment
  -> phonetic_coverage_report
  -> prosody_analysis
  -> intent_balance_report
  -> dataset_score
  -> voice_archive
```

Export rules:

1. Exports are derived from the workspace and recorded takes, not separate sources of truth.
2. Audio should be WAV PCM mono, 48 kHz, 24-bit where the runtime allows it.
3. Destructive noise reduction, MP3, and AAC are not valid for premium exports.
4. Room tone, microphone metadata, interface, mouth-to-mic distance, room notes, consent, and
   provenance must be present before a final Forge archive is accepted.
5. A smaller clean dataset is preferred over a large incoherent dataset.
6. Every artifact must have a checksum in `manifest.json`.
7. Browser-generated reports are first-pass dataset diagnostics. Browser phoneme timing is
   text-derived and marked `forcedAlignmentRequired`; Forge should still run acoustic forced
   alignment and phoneme-level coverage for final acceptance.

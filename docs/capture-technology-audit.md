# Capture Technology Audit

Last reviewed: 2026-07-09

## Current Position

Voice Capture Studio is strongest as a local-first capture and dataset packaging tool. The browser
can reliably own microphone capture, WAV encoding, room-tone calibration, technical metrics,
prompt-led reading, workspace history, checksums, and dataset packaging. It cannot, by itself,
guarantee acoustic word/phoneme boundaries with research-grade precision across browsers.

This pass moves the app to a better intermediate contract:

1. Every new take stores transcript tokens.
2. Every word in `timing.json` is linked to estimated phoneme intervals.
3. Every take stores alignment confidence, phone inventory count, and word/phoneme link rate.
4. Dataset exports include `phonemes/<take_id>.json` and `manifests/training_manifest.jsonl`.
5. Reports explicitly separate browser-estimated alignment from required acoustic forced alignment.

## Browser Ceiling

The Web Speech API can provide transcripts and confidence estimates, but MDN marks the relevant
recognition interfaces as limited availability. Browser implementations are inconsistent, and the
API does not provide a dependable phoneme-level alignment contract.

Sources:

- MDN SpeechRecognition limited availability:
  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- MDN SpeechRecognitionAlternative confidence:
  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionAlternative/confidence

Practical decision:

- Use Web Speech only as a live guide and optional transcript mismatch signal.
- Never treat Web Speech as the final dataset oracle.
- Store prompt-derived alignment with explicit `forcedAlignmentRequired: true`.

## Forced Alignment Ceiling

For production-grade word and phone boundaries, the dataset needs an acoustic forced-alignment
stage that compares WAV audio to transcript text. Montreal Forced Aligner outputs word and phone
tiers, and OpenAI transcription can provide word-level timestamps through `timestamp_granularities`
for word-level passes. WhisperX remains a useful external option when ASR plus phoneme alignment is
needed.

Sources:

- Montreal Forced Aligner corpus structure and TextGrid phone tiers:
  https://montreal-forced-aligner.readthedocs.io/en/latest/user_guide/corpus_structure.html
- OpenAI Speech to Text timestamps:
  https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI transcription API `timestamp_granularities`:
  https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create/

Practical decision:

- Browser export is now alignment-ready, not alignment-final.
- `phonemes/*.json` gives downstream tools a deterministic word/phone map to validate or replace.
- `reports/report.transcript_alignment.json` lists takes requiring forced alignment.

## Dataset Readiness Tiers

For real-time rendering:

- Current app is suitable for live reading guidance, amplitude-aware progression, and estimated
  phoneme preview.
- It is not suitable for frame-accurate lip-sync or model-grade mouth shapes without a post-pass.

For stock/archive:

- Current app is suitable when WAV persistence, checksums, room tone, transcript, intent, quality,
  timing, and phoneme estimates are all present.
- Archive acceptance should still require a successful forced-alignment report.

For fine-tuning:

- Current app now exports a JSONL manifest and per-take phoneme maps.
- Training ingestion should filter to keeper takes, then replace or confirm estimated browser
  timings with acoustic alignment before final model training.

## Next Technical Push

1. Add an optional offline alignment import path for TextGrid/JSON so MFA or WhisperX results can
   replace browser estimates.
2. Add a pronunciation dictionary layer per language so local grapheme-to-phoneme estimates can be
   overridden for names, numbers, acronyms, and domain terms.
3. Store confidence provenance per alignment source: prompt estimate, Web Speech transcript,
   external ASR words, external phone aligner.
4. Add dataset acceptance gates that require external alignment for `Premium Candidate`.
5. Add corpus authoring tools that show missing phone inventory before recording begins.

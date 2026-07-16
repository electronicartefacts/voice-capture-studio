# Capture Technology Audit

Last reviewed: 2026-07-16

## Current Position

Voice Capture Studio is strongest as a local-first capture and dataset packaging tool. The browser
can reliably own microphone capture, WAV encoding, room-tone calibration, technical metrics,
prompt-led reading, workspace history, checksums, and dataset packaging. It cannot, by itself,
guarantee acoustic word/phoneme boundaries with research-grade precision across browsers.

The observation-pipeline pass moves the app to a better intermediate contract:

1. Every new take stores transcript tokens.
2. Every word in `timing.json` is linked to estimated phoneme intervals constrained to the
   speech-active PCM timeline, excluding measured leading and trailing room silence.
3. Every take stores alignment confidence, phone inventory count, and word/phoneme link rate.
4. Dataset exports include `phonemes/<take_id>.json` and `manifests/training_manifest.jsonl`.
5. Reports explicitly separate browser-estimated alignment from required acoustic forced alignment.
6. Every new take carries independent corpus, signal, VAD, ASR, alignment, evidence, and confidence records.
7. SpeechRecognition is optional evidence and no longer governs keeper acceptance.

## Observation Pipeline

`src/domains/observations/` is a pure, replaceable pipeline. It receives the
final PCM-derived metrics and immutable corpus prompt only after capture has
stopped, so it cannot compete with the real-time audio callback. It emits:

- `voice.corpus_observation.v1`: declared text, normalization, tokens,
  sentences, punctuation, variants, locale, intent, emotion, style, and energy;
- `voice.signal_observation.v1`: measured acoustic/prosodic metrics plus an
  explicitly estimated energy VAD, bounded energy envelope, speech segments,
  silences, pauses, and temporal summary;
- `voice.browser_asr_observation.v1`: availability, engine/runtime, final and
  intermediate hypotheses, timestamps, browser confidence, and provenance;
- `voice.estimated_alignment_observation.v1`: preparatory word/phone boundaries
  labeled `estimated`, with explicit replacement targets for MFA, WhisperX,
  Gentle, or another future adapter;
- fused take/word/phoneme decisions whose reason and evidence references remain inspectable.

The pipeline does not manufacture unsupported jitter, shimmer, respiration, or
emotion observations. Those capabilities stay explicit limitations until a
validated signal method or replaceable model adapter exists.

The optional local Whisper/Silero post-pass is now adaptive. A quantized Tiny
model scouts every requested take. A scene classifier combines declared vocal
performance, SNR, reverb, active-voice ratio, VAD, and first-pass coherence. It
stops immediately on a clean, well-supported result, preserves confirmed
non-speech instead of asking a second model to invent words, and escalates sung,
noisy, reverberant, or incoherent takes to a quantized Base beam hypothesis.
Prompt-led takes are arbitrated by prompt match and acoustic alignment; free
captures are arbitrated by vocal support, density, repetition, and model
strength. The selected hypothesis and every rejected alternative remain in the
persisted strategy provenance.

The post-pass loads tokenizer, feature extractor, quantized model, VAD model,
and an explicitly pinned ONNX WASM pair from this origin. It disables an
incompatible N-bit graph rewrite for the bundled q8 decoder. This avoids both
remote fallback and runtime-dependent WASM filename selection while leaving the
real-time recorder untouched.

### Imported music and lexical segmentation

The media-import path starts with an original-signal Tiny scout and independent
Silero evidence. Cheap signal analysis then classifies the scene as clean,
constrained, musical, or uncertain and selects a one-to-four-hypothesis budget.
Clear material on a compatible device can stop after one pass. A verified path
adds Base on the original. Short complex mixes can add a centered vocal focus
and a deterministic spectral mid/side residual. Speech VAD and sustained-singing
activity are fused to mask instrumental-only intervals during inference without
changing duration or timestamps.

The result is a temporal fuzzy consensus, not blind trust in the most processed
signal: close lexical variants are reconciled, omissions confirmed by two
independent passes can be recovered, and isolated proposals are rejected when
three or more hypotheses exist. The exported word clips always come from the
untouched decoded source. This follows current automatic-lyrics findings that
separated vocals help most when separation also informs vocal activity and
segment boundaries, while retaining the original prevents enhancement artifacts
from becoming the only evidence.

Imports are preflighted before full decoding and are limited to 200 MB and ten
minutes. This bounds the largest avoidable tab-memory failures on mobile while
keeping a complete song practical. The v6 manifest records the detected scene,
planned hypothesis budget, actual depth, every model/signal/provider/decoder,
activity-mask coverage, selected signal, consensus recovery/rejection counts,
and whether isolation was skipped for length or device budget. These fields
describe evidence, not certainty.

Research and runtime references:

- source separation and vocal-activity segmentation for lyrics transcription:
  https://arxiv.org/abs/2506.15514
- non-speech-induced Whisper hallucinations:
  https://arxiv.org/abs/2501.11378
- ONNX Runtime Web execution-provider guidance:
  https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html

The shared inference worker serializes requests so two panels cannot run the
same ONNX sessions concurrently. Both post-capture analysis and lexical import
expose cancellation; cancellation terminates the worker, rejects pending work,
and lets the next request rebuild a clean runtime. ZIP creation observes the
same signal instead of silently falling back after the user has stopped a job.

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
- Store prompt-derived alignment constrained by measured PCM speech activity, with explicit
  `forcedAlignmentRequired: true`.

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

### Multi-aligner consensus import

The acoustic-alignment importer also accepts a consensus bundle:

```json
{
  "takeId": "take.2026-07-13T10:00:00.000Z",
  "alignments": [
    {
      "aligner": "MFA",
      "language": "fr",
      "durationMs": 1200,
      "confidence": 0.94,
      "words": [],
      "phonemes": []
    },
    {
      "aligner": "WhisperX",
      "language": "fr",
      "durationMs": 1200,
      "confidence": 0.89,
      "words": [],
      "phonemes": []
    }
  ]
}
```

Each nested value uses the existing `voice.forced_alignment.v1` import shape and must contain real
word and phoneme intervals. The studio compares both acoustic alignments with its local G2P/VAD
estimate, gives acoustic evidence five times the base weight of the estimate, and selects word
boundaries with a weighted median. The strongest acoustic source remains the phoneme source because
phone inventories cannot be averaged safely across aligners.

The exported alignment retains every consensus source, weight, confidence, median boundary
disagreement, and review status. Acoustic disagreement up to 40 ms is `strong`, up to 120 ms is
`acceptable`, and larger disagreement is `review`; a review consensus cannot pass the phoneme
alignment quality gate automatically.

When the take already contains a complete local Whisper word pass, importing a single external
alignment also creates a three-way consensus automatically: G2P/VAD is weak estimated evidence,
local Whisper is medium-weight acoustic evidence, and the external aligner is the authoritative
acoustic/phonetic source. The studio only enables this shortcut when every expected word is matched;
otherwise it preserves the external alignment without manufacturing missing local intervals.

`takeId` is optional for backward compatibility; when present, it routes the import to that exact
stored take. The importer rejects unknown take ids, overlapping or unordered word intervals, and any
alignment whose normalized word sequence differs from the targeted take transcript. This prevents a
valid-looking alignment file from being silently attached to the wrong recording.

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

## Real-time Reading and Endpointing

The live guide is a hybrid, progressive-capability path rather than one ASR
result directly moving one UI cursor:

- browser recognition requests three alternatives and selects the sequence
  most coherent with the immutable prompt, not merely the engine's first item;
- contextual `SpeechRecognitionPhrase` biasing supplies the prompt, useful
  word pairs, and distinctive long words when the browser implements it;
- an available on-device language pack enables `processLocally`; otherwise the
  older browser-managed path remains available without blocking capture;
- recognition sessions are restarted and stitched after spontaneous `end`
  events, with overlap removal and unique evidence indexes;
- dynamic-programming sequence alignment tolerates inserted, missing,
  repeated, partial, and revised words without shifting the remaining prompt;
- a PCM endpoint detector uses calibrated noise, attack/release hysteresis, and
  an acoustic tail. Reaching the last word alone can no longer stop a take;
- automatic stop requires a credible final-text alignment plus measured
  silence. The ASR-free fallback uses a longer tail and plausible duration.

Web Speech remains optional guidance. The PCM recorder, manual Stop action,
post-capture Whisper/Silero analysis, and dataset evidence contracts do not
depend on it.

## Next Technical Push

1. Add an optional offline alignment import path for TextGrid/JSON so MFA or WhisperX results can
   replace browser estimates.
2. Add a pronunciation dictionary layer per language so local grapheme-to-phoneme estimates can be
   overridden for names, numbers, acronyms, and domain terms.
3. Store confidence provenance per alignment source: prompt estimate, Web Speech transcript,
   external ASR words, external phone aligner.
4. Add dataset acceptance gates that require external alignment for `Premium Candidate`.
5. Add corpus authoring tools that show missing phone inventory before recording begins.

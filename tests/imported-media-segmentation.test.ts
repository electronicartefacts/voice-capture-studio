import assert from "node:assert/strict";
import test from "node:test";
import {
  createWordAudioSegments,
  shouldPreferLexicalAssessment,
} from "../src/app/analysis/importedMediaSegmentation";
import {
  createStereoVocalFocusSignal,
  createVocalFocusSignal,
} from "../src/app/analysis/vocalFocus";
import { assessLexicalSegmentation } from "../src/app/analysis/lexicalSegmentationQuality";
import {
  assertImportedMediaWithinLimits,
  LEXICAL_SEGMENTATION_MAX_DURATION_MS,
  LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES,
} from "../src/app/analysis/lexicalSegmentationPolicy";

test("word segmentation keeps detected timing and creates stable unique paths", () => {
  const segments = createWordAudioSegments([
    {
      word: "Écoute,",
      startMs: 120,
      endMs: 510,
      source: "whisper_attention_timestamp",
    },
    {
      word: "écoute !",
      startMs: 520,
      endMs: 980,
      source: "whisper_attention_timestamp",
    },
    {
      word: "voix/locale",
      startMs: 1000,
      endMs: 1600,
      source: "whisper_attention_timestamp",
    },
  ]);

  assert.deepEqual(segments, [
    {
      index: 0,
      word: "Écoute,",
      startMs: 120,
      endMs: 510,
      durationMs: 390,
      clipStartMs: 60,
      clipEndMs: 570,
      acousticSupport: 1,
      evidence: "speech_vad",
      audioPath: "audio/mots/0001_ecoute.wav",
    },
    {
      index: 1,
      word: "écoute !",
      startMs: 520,
      endMs: 980,
      durationMs: 460,
      clipStartMs: 460,
      clipEndMs: 1040,
      acousticSupport: 1,
      evidence: "speech_vad",
      audioPath: "audio/mots/0002_ecoute.wav",
    },
    {
      index: 2,
      word: "voix/locale",
      startMs: 1000,
      endMs: 1600,
      durationMs: 600,
      clipStartMs: 940,
      clipEndMs: 1660,
      acousticSupport: 1,
      evidence: "speech_vad",
      audioPath: "audio/mots/0003_voix-locale.wav",
    },
  ]);
});

test("media preflight rejects imports that can exhaust a mobile tab", () => {
  assert.doesNotThrow(() =>
    assertImportedMediaWithinLimits({
      durationMs: LEXICAL_SEGMENTATION_MAX_DURATION_MS,
      sizeBytes: LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES,
    }),
  );
  assert.throws(
    () =>
      assertImportedMediaWithinLimits({
        sizeBytes: LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES + 1,
      }),
    /200 Mo/,
  );
  assert.throws(
    () =>
      assertImportedMediaWithinLimits({
        durationMs: LEXICAL_SEGMENTATION_MAX_DURATION_MS + 1,
        sizeBytes: 1,
      }),
    /10 minutes/,
  );
});

test("vocal focus sanitizes samples and removes sustained low-frequency offset", () => {
  const samples = new Float32Array(16_000).fill(0.4);
  samples[10] = Number.NaN;
  const focused = createVocalFocusSignal(samples);
  const tailPeak = focused
    .subarray(8_000)
    .reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);

  assert.equal(focused.length, samples.length);
  assert.equal(focused.every(Number.isFinite), true);
  assert.ok(tailPeak < 0.001);
});

test("stereo vocal focus attenuates side-only accompaniment", () => {
  const left = new Float32Array(16_000);
  const right = new Float32Array(16_000);

  for (let index = 0; index < left.length; index += 1) {
    const voice = Math.sin((index / 16_000) * Math.PI * 2 * 220) * 0.2;
    const wideInstrument =
      Math.sin((index / 16_000) * Math.PI * 2 * 440) * 0.35;
    left[index] = voice + wideInstrument;
    right[index] = voice - wideInstrument;
  }

  const focused = createStereoVocalFocusSignal(left, right);

  assert.equal(focused.stereoCenterUsed, true);
  assert.equal(focused.signal.every(Number.isFinite), true);
  assert.ok(Math.max(...focused.signal) > 0.1);
});

test("adaptive retry is selected only when acoustic evidence improves", () => {
  const source = "whisper_attention_timestamp" as const;
  const timing = [{ word: "refrain", startMs: 100, endMs: 800, source }];
  const unsupported = assessLexicalSegmentation({
    timings: timing,
    speechSegments: [],
  });
  const supported = assessLexicalSegmentation({
    timings: timing,
    speechSegments: [{ startMs: 80, endMs: 820 }],
  });

  assert.equal(shouldPreferLexicalAssessment(supported, unsupported), true);
  assert.equal(shouldPreferLexicalAssessment(unsupported, supported), false);
});

test("a richer base-model lyric hypothesis can replace a weak music pass", () => {
  const source = "whisper_attention_timestamp" as const;
  const tiny = assessLexicalSegmentation({
    timings: [{ word: "nuit", startMs: 100, endMs: 600, source }],
    speechSegments: [],
  });
  const base = assessLexicalSegmentation({
    timings: [
      { word: "dans", startMs: 100, endMs: 350, source },
      { word: "la", startMs: 360, endMs: 540, source },
      { word: "nuit", startMs: 550, endMs: 900, source },
    ],
    speechSegments: [],
  });

  assert.equal(shouldPreferLexicalAssessment(base, tiny), true);
  assert.equal(shouldPreferLexicalAssessment(tiny, base), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createVocalFocusSignal,
  createWordAudioSegments,
  shouldPreferLexicalAssessment,
} from "../src/app/analysis/importedMediaSegmentation";
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

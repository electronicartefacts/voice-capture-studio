import assert from "node:assert/strict";
import test from "node:test";

import {
  getAnalysisDurationMs,
  isLocalAnalysisAbort,
  runCapturedVocalEnsemble,
} from "../src/app/analysis/localTakeAnalysis";
import type { LocalTakeAnalysis } from "../src/app/analysis/types";

test("local analysis keeps its duration before transferring audio to the worker", () => {
  const audio = new Float32Array(16_000 * 3);
  const durationMs = getAnalysisDurationMs(audio);

  structuredClone(audio.buffer, { transfer: [audio.buffer] });

  assert.equal(audio.length, 0);
  assert.equal(durationMs, 3_000);
});

test("local analysis distinguishes intentional cancellation from failure", () => {
  assert.equal(
    isLocalAnalysisAbort(new DOMException("cancelled", "AbortError")),
    true,
  );
  assert.equal(isLocalAnalysisAbort(new Error("worker failed")), false);
});

test("captured vocal ensemble compares focused and spectral evidence in a noisy scene", async () => {
  const progress: string[] = [];
  const focused = createAnalysis("bonjour", 1, "acceptable");
  const spectral = createAnalysis("bonjour monde", 2, "strong");
  const candidates = [focused, spectral];
  const result = await runCapturedVocalEnsemble({
    signals: {
      mono: new Float32Array(16_000),
      vocalFocus: new Float32Array(16_000),
      stereoCenterUsed: false,
      spectralInput: { left: new Float32Array(16_000), right: null },
    },
    original: createAnalysis("bruit", 0, "insufficient"),
    context: { performanceKind: "spoken", snrDb: 8 },
    onProgress: (update) => progress.push(update.stage),
    analyze: async () => candidates.shift() ?? spectral,
    separate: async () => new Float32Array(16_000),
  });

  assert.equal(result.transcript, "bonjour monde");
  assert.equal(result.strategy?.depth, "deep");
  assert.equal(result.strategy?.hypotheses.length, 3);
  assert.deepEqual(progress, [
    "enhancing-vocals",
    "separating-vocals",
    "validating-result",
  ]);
});

test("captured vocal ensemble keeps a clean scout without extra processing", async () => {
  const original = createAnalysis("bonjour monde", 2, "strong");
  const result = await runCapturedVocalEnsemble({
    signals: {
      mono: new Float32Array(16_000),
      vocalFocus: new Float32Array(16_000),
      stereoCenterUsed: false,
      spectralInput: null,
    },
    original,
    context: {
      performanceKind: "spoken",
      snrDb: 30,
      reverbScore: 0.1,
      activeSpeechRatio: 0.5,
    },
    onProgress: () => assert.fail("clean evidence must not escalate"),
    analyze: async () => assert.fail("clean evidence must not be reanalyzed"),
    separate: async () => assert.fail("clean evidence must not be separated"),
  });
  assert.equal(result, original);
});

function createAnalysis(
  transcript: string,
  matchedWordCount: number,
  status: LocalTakeAnalysis["alignmentComparison"]["status"],
): LocalTakeAnalysis {
  const words = transcript === "bruit" ? [] : transcript.split(" ");
  return {
    transcript,
    matchedWordCount,
    expectedWordCount: 2,
    speechSegments: words.length === 0 ? [] : [{ startMs: 100, endMs: 900 }],
    segmentSummary: {
      leadingSilenceMs: 100,
      trailingSilenceMs: 100,
      speechDurationMs: words.length === 0 ? 0 : 800,
      totalDurationMs: 1_000,
    },
    whisperWords: words.map((word, index) => ({
      word,
      startMs: 100 + index * 350,
      endMs: 400 + index * 350,
      source: "whisper_attention_timestamp",
    })),
    alignmentComparison: {
      schemaVersion: "voice.local_alignment_comparison.v1",
      status,
      reviewRequired: status === "review" || status === "insufficient",
      matchedWordCount,
      expectedWordCount: 2,
      whisperWordCount: words.length,
      matchRate: matchedWordCount / 2,
      medianBoundaryDeltaMs: words.length === 0 ? null : 40,
      maximumBoundaryDeltaMs: words.length === 0 ? null : 60,
      words: [],
    },
    executionProvider: "wasm",
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SEGMENTATION_OPTIONS,
  segmentSpeechProbabilities,
  summarizeSpeechSegments,
} from "../src/app/analysis/speechSegments";

const FRAME_MS = 32;

function frames(pattern: string): number[] {
  // "s" = confident speech frame, "." = silence frame.
  return Array.from(pattern, (symbol) => (symbol === "s" ? 0.9 : 0.05));
}

test("silence-only probabilities produce no speech segments", () => {
  const segments = segmentSpeechProbabilities(frames(".".repeat(40)), FRAME_MS);

  assert.deepEqual(segments, []);
});

test("a single utterance becomes one padded segment", () => {
  // 10 silence frames, 20 speech frames, 20 silence frames.
  const segments = segmentSpeechProbabilities(
    frames(".".repeat(10) + "s".repeat(20) + ".".repeat(20)),
    FRAME_MS,
  );

  assert.equal(segments.length, 1);
  assert.equal(
    segments[0].startMs,
    10 * FRAME_MS - DEFAULT_SEGMENTATION_OPTIONS.paddingMs,
  );
  assert.equal(
    segments[0].endMs,
    30 * FRAME_MS + DEFAULT_SEGMENTATION_OPTIONS.paddingMs,
  );
});

test("short silences inside an utterance do not split the segment", () => {
  // A 4-frame dip (128 ms) is below the 300 ms minimum silence.
  const segments = segmentSpeechProbabilities(
    frames("s".repeat(10) + ".".repeat(4) + "s".repeat(10) + ".".repeat(20)),
    FRAME_MS,
  );

  assert.equal(segments.length, 1);
});

test("long silences split speech into separate segments", () => {
  // A 12-frame gap (384 ms) exceeds the 300 ms minimum silence.
  const segments = segmentSpeechProbabilities(
    frames("s".repeat(10) + ".".repeat(12) + "s".repeat(10) + ".".repeat(12)),
    FRAME_MS,
  );

  assert.equal(segments.length, 2);
  assert.ok(segments[0].endMs < segments[1].startMs);
});

test("isolated blips shorter than the speech minimum are dropped", () => {
  // 3 frames of speech (96 ms) is below the 200 ms speech minimum.
  const segments = segmentSpeechProbabilities(
    frames(".".repeat(10) + "sss" + ".".repeat(20)),
    FRAME_MS,
  );

  assert.deepEqual(segments, []);
});

test("speech running to the end of the take closes at the total duration", () => {
  const segments = segmentSpeechProbabilities(
    frames(".".repeat(10) + "s".repeat(20)),
    FRAME_MS,
  );

  assert.equal(segments.length, 1);
  assert.equal(segments[0].endMs, 30 * FRAME_MS);
});

test("segment summary measures edge silences and speech duration", () => {
  const summary = summarizeSpeechSegments(
    [
      { startMs: 500, endMs: 1500 },
      { startMs: 2000, endMs: 3000 },
    ],
    4000,
  );

  assert.equal(summary.leadingSilenceMs, 500);
  assert.equal(summary.trailingSilenceMs, 1000);
  assert.equal(summary.speechDurationMs, 2000);
  assert.equal(summary.totalDurationMs, 4000);
});

test("segment summary of an empty take reports full-length silences", () => {
  const summary = summarizeSpeechSegments([], 3000);

  assert.equal(summary.leadingSilenceMs, 3000);
  assert.equal(summary.trailingSilenceMs, 3000);
  assert.equal(summary.speechDurationMs, 0);
});

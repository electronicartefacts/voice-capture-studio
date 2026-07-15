import assert from "node:assert/strict";
import test from "node:test";
import { assessVocalPerformance } from "../src/app/recording/vocalPerformance";

test("mastering declares sung intent without relying on browser ASR", () => {
  const assessment = assessVocalPerformance({
    captureMode: "mastering",
    metrics: {
      pitchRangeSemitones: null,
      pitchVariationSemitones: null,
      voicedFrameRatio: 0,
    },
  });

  assert.equal(assessment.kind, "sung");
  assert.equal(assessment.source, "mode_intent");
  assert.equal(assessment.confidence, 1);
});

test("song-like pitch evidence adapts every capture mode", () => {
  for (const captureMode of ["free", "training", "dubbing"] as const) {
    const assessment = assessVocalPerformance({
      captureMode,
      metrics: {
        pitchRangeSemitones: 11,
        pitchVariationSemitones: 3.4,
        voicedFrameRatio: 0.64,
      },
    });

    assert.equal(assessment.kind, "sung");
    assert.equal(assessment.source, "audio_signal");
  }
});

test("ordinary pitch evidence remains spoken and weak evidence stays open", () => {
  assert.equal(
    assessVocalPerformance({
      captureMode: "training",
      metrics: {
        pitchRangeSemitones: 4,
        pitchVariationSemitones: 1.2,
        voicedFrameRatio: 0.7,
      },
    }).kind,
    "spoken",
  );
  assert.equal(
    assessVocalPerformance({
      captureMode: "free",
      metrics: {
        pitchRangeSemitones: null,
        pitchVariationSemitones: null,
        voicedFrameRatio: 0.05,
      },
    }).kind,
    "undetermined",
  );
});

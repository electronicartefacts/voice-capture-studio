import assert from "node:assert/strict";
import test from "node:test";

import {
  readRuntimePerformanceProfile,
  recordRuntimePerformanceObservation,
  selectCapturedAnalysisBudget,
  updateRuntimePerformanceProfile,
  type RuntimePerformanceProfile,
} from "../src/app/analysis/runtimePerformanceProfile";

const emptyProfile: RuntimePerformanceProfile = {
  schemaVersion: "voice.processing_performance.v1",
  transcriptionRealtimeFactor: null,
  separationRealtimeFactor: null,
  transcriptionObservations: 0,
  separationObservations: 0,
};

test("captured analysis defaults to quality-first then bounds work from measured speed", () => {
  const unmeasured = selectCapturedAnalysisBudget({
    scene: "constrained_voice",
    durationMs: 45_000,
    profile: emptyProfile,
  });
  const constrained = selectCapturedAnalysisBudget({
    scene: "constrained_voice",
    durationMs: 45_000,
    observedTranscriptionRealtimeFactor: 1.2,
    profile: emptyProfile,
  });
  const clean = selectCapturedAnalysisBudget({
    scene: "clean_voice",
    durationMs: 45_000,
    observedTranscriptionRealtimeFactor: 0.1,
    profile: emptyProfile,
  });

  assert.equal(unmeasured.maximumHypotheses, 3);
  assert.equal(unmeasured.allowSpectralSeparation, true);
  assert.equal(constrained.runtimeClass, "constrained");
  assert.equal(constrained.maximumHypotheses, 2);
  assert.equal(constrained.allowVocalFocus, true);
  assert.equal(constrained.allowSpectralSeparation, false);
  assert.equal(clean.maximumHypotheses, 1);
});

test("runtime profile uses a stable moving average per local browser", () => {
  const first = updateRuntimePerformanceProfile(emptyProfile, {
    kind: "transcription",
    elapsedMs: 5_000,
    sourceDurationMs: 10_000,
  });
  const second = updateRuntimePerformanceProfile(first, {
    kind: "transcription",
    elapsedMs: 10_000,
    sourceDurationMs: 10_000,
  });
  const separated = updateRuntimePerformanceProfile(second, {
    kind: "separation",
    elapsedMs: 2_000,
    sourceDurationMs: 10_000,
  });

  assert.equal(first.transcriptionRealtimeFactor, 0.5);
  assert.equal(second.transcriptionRealtimeFactor, 0.675);
  assert.equal(second.transcriptionObservations, 2);
  assert.equal(separated.separationRealtimeFactor, 0.2);
  assert.equal(separated.separationObservations, 1);
});

test("runtime observations persist locally and are normalized when read back", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  let storedValue: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => storedValue,
      setItem: (_key: string, value: string) => {
        storedValue = value;
      },
    },
  });

  try {
    const written = recordRuntimePerformanceObservation({
      kind: "transcription",
      elapsedMs: 2_500,
      sourceDurationMs: 10_000,
    });
    const restored = readRuntimePerformanceProfile();

    assert.equal(written.transcriptionRealtimeFactor, 0.25);
    assert.equal(restored.transcriptionRealtimeFactor, 0.25);
    assert.equal(restored.transcriptionObservations, 1);
    assert.match(storedValue ?? "", /voice\.processing_performance\.v1/);
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    }
  }
});

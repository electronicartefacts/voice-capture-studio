import assert from "node:assert/strict";
import test from "node:test";
import {
  AMBIENT_MEASUREMENT_CONSTRAINTS,
  createAmbientNoiseProfile,
  createVoiceCaptureConstraints,
  microphoneProcessingSummary,
} from "../src/app/recording/microphoneCapturePolicy";

test("ambient measurement stays raw while capture requests voice processing", () => {
  assert.equal(AMBIENT_MEASUREMENT_CONSTRAINTS.noiseSuppression, false);
  assert.equal(AMBIENT_MEASUREMENT_CONSTRAINTS.echoCancellation, false);

  const capture = createVoiceCaptureConstraints() as MediaTrackConstraints & {
    readonly voiceIsolation?: ConstrainBoolean;
  };
  assert.deepEqual(capture.noiseSuppression, { ideal: true });
  assert.deepEqual(capture.echoCancellation, { ideal: true });
  assert.deepEqual(capture.voiceIsolation, { ideal: true });
  assert.equal(capture.autoGainControl, false);
});

test("ambient preflight summarizes a bounded raw noise observation", () => {
  assert.deepEqual(createAmbientNoiseProfile([0.01, 0.01], 2_634.4), {
    schemaVersion: "voice.ambient_preflight.v1",
    observedDurationMs: 2_634,
    sampleWindows: 2,
    rmsDbfs: -40,
    peakDbfs: -40,
  });
  assert.equal(createAmbientNoiseProfile([], 1000), null);
});

test("capture provenance reports supported and unavailable processors explicitly", () => {
  assert.deepEqual(
    microphoneProcessingSummary({
      echoCancellation: true,
      noiseSuppression: false,
    } as MediaTrackSettings),
    {
      echoCancellation: true,
      noiseSuppression: false,
      voiceIsolation: null,
    },
  );
});

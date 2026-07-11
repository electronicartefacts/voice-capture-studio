import assert from "node:assert/strict";
import test from "node:test";
import { applyInputGain, planInputGain } from "../src/app/audio/inputGain";
import {
  analyzePcmSamples,
  encodeWav24,
  type PcmRecordingMetrics,
} from "../src/app/audio/pcmAudio";
import { validatePcmWavBlob } from "../src/app/audio/wavValidation";

test("automatic gain raises clean quiet speech to a useful level", () => {
  const plan = planInputGain({
    manualFactor: 1,
    metrics: createMetrics({
      estimatedTruePeakDbfs: -18,
      integratedLufs: -30,
      noiseFloorDbfs: -60,
      peakDbfs: -18,
    }),
    mode: "auto",
  });

  assert.ok(Math.abs(plan.gainDb - 10) < 0.000001);
  assert.equal(plan.limitedBy, "target");
});

test("automatic gain protects transients before chasing loudness", () => {
  const plan = planInputGain({
    manualFactor: 1,
    metrics: createMetrics({
      estimatedTruePeakDbfs: -5,
      integratedLufs: -31,
      noiseFloorDbfs: -58,
      peakDbfs: -6,
    }),
    mode: "auto",
  });

  assert.ok(Math.abs(plan.gainDb - 2) < 0.000001);
  assert.equal(plan.limitedBy, "true_peak");
});

test("automatic gain refuses to turn a noisy room into louder noise", () => {
  const plan = planInputGain({
    manualFactor: 1,
    metrics: createMetrics({
      estimatedTruePeakDbfs: -15,
      integratedLufs: -32,
      noiseFloorDbfs: -44,
      peakDbfs: -16,
    }),
    mode: "auto",
  });

  assert.ok(Math.abs(plan.gainDb - 2) < 0.000001);
  assert.equal(plan.limitedBy, "noise_floor");
});

test("automatic gain leaves silence and already clipped sources untouched", () => {
  const silent = planInputGain({
    manualFactor: 3,
    metrics: createMetrics({
      activeSpeechRatio: 0,
      estimatedTruePeakDbfs: -96,
      integratedLufs: -96,
      noiseFloorDbfs: -96,
      peakDbfs: -96,
    }),
    mode: "auto",
  });
  const clipped = planInputGain({
    manualFactor: 3,
    metrics: createMetrics({ clippingDetected: true }),
    mode: "auto",
  });

  assert.equal(silent.factor, 1);
  assert.equal(silent.limitedBy, "insufficient_signal");
  assert.equal(clipped.factor, 1);
  assert.equal(clipped.limitedBy, "clipping");
});

test("manual gain remains constant but cannot cross the true-peak ceiling", () => {
  const safe = planInputGain({
    manualFactor: 2,
    metrics: createMetrics({ estimatedTruePeakDbfs: -12 }),
    mode: "manual",
  });
  const capped = planInputGain({
    manualFactor: 3,
    metrics: createMetrics({ estimatedTruePeakDbfs: -4 }),
    mode: "manual",
  });

  assert.ok(Math.abs(safe.factor - 2) < 0.000001);
  assert.equal(safe.limitedBy, "manual");
  assert.ok(Math.abs(capped.gainDb - 1) < 0.000001);
  assert.equal(capped.limitedBy, "true_peak");
});

test("constant gain preserves every sample relation and produces canonical 24-bit WAV", async () => {
  const source = new Float32Array(48_000);

  for (let index = 0; index < source.length; index += 1) {
    source[index] =
      0.04 * Math.sin((2 * Math.PI * 170 * index) / 48_000) +
      0.01 * Math.sin((2 * Math.PI * 311 * index) / 48_000);
  }

  const sourceMetrics = analyzePcmSamples(source);
  const plan = planInputGain({
    manualFactor: 1,
    metrics: sourceMetrics,
    mode: "auto",
  });
  const output = applyInputGain(source, plan.factor);
  const outputMetrics = analyzePcmSamples(output);

  for (let index = 0; index < source.length; index += 997) {
    assert.ok(
      Math.abs(output[index] - source[index] * plan.factor) < 0.0000001,
    );
  }
  assert.equal(outputMetrics.clippingDetected, false);
  assert.ok(outputMetrics.estimatedTruePeakDbfs <= -2.9);
  assert.ok(Math.abs(outputMetrics.snrDb - sourceMetrics.snrDb) <= 0.2);
  await validatePcmWavBlob(encodeWav24(output));
});

function createMetrics(
  patch: Partial<PcmRecordingMetrics> = {},
): PcmRecordingMetrics {
  return {
    schemaVersion: "voice.audio_metrics.v1",
    durationMs: 2_000,
    sampleRateHz: 48_000,
    bitDepth: 24,
    channels: 1,
    sampleCount: 96_000,
    peakDbfs: -12,
    estimatedTruePeakDbfs: -11,
    rmsDbfs: -24,
    integratedLufs: -24,
    noiseFloorDbfs: -60,
    snrDb: 36,
    crestFactorDb: 12,
    dcOffset: 0,
    clippingDetected: false,
    clippingSampleCount: 0,
    clippingRate: 0,
    activeSpeechRatio: 0.7,
    silenceRatio: 0.1,
    voicedFrameRatio: 0.8,
    meanPitchHz: 170,
    pitchRangeSemitones: 4,
    pitchVariationSemitones: 1.5,
    energyVariationDb: 3,
    reverbScore: 0.1,
    plosiveScore: 0.02,
    mouthNoiseScore: 0.02,
    ...patch,
  };
}

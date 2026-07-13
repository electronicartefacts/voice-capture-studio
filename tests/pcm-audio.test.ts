import assert from "node:assert/strict";
import test from "node:test";
import {
  PCM_TARGET_SAMPLE_RATE,
  PcmSampleBuffer,
  analyzePcmSamples,
  encodeWav24,
  resampleBandLimited,
  resampleLinear,
} from "../src/app/audio/pcmAudio";
import { computeReviewPlaybackGain } from "../src/app/audio/reviewPlaybackGain";

test("review playback lifts quiet takes without exceeding peak headroom", () => {
  assert.ok(
    Math.abs(
      computeReviewPlaybackGain({
        integratedLufs: -30,
        estimatedTruePeakDbfs: -12,
      }) -
        10 ** (16 / 20),
    ) < 0.000001,
  );
  assert.equal(
    computeReviewPlaybackGain({
      integratedLufs: -32,
      estimatedTruePeakDbfs: -20,
    }),
    10 ** (18 / 20),
  );
  assert.equal(
    computeReviewPlaybackGain({
      integratedLufs: -16,
      estimatedTruePeakDbfs: -2,
    }),
    10 ** (2 / 20),
  );
});

test("PCM sample buffer copies chunks and enforces the configured sample limit", () => {
  const buffer = new PcmSampleBuffer({ maxSamples: 3 });
  const firstChunk = new Float32Array([1, 2]);

  buffer.append(firstChunk);
  firstChunk[0] = 9;
  buffer.append(new Float32Array([3, 4]));

  assert.equal(buffer.sampleCount, 3);
  assert.equal(buffer.limitReached, true);
  assert.deepEqual(Array.from(buffer.consume()), [1, 2, 3]);
  assert.equal(buffer.sampleCount, 0);
  assert.equal(buffer.limitReached, false);
});

test("WAV encoder preserves mono 48 kHz 24-bit PCM container compatibility", async () => {
  const wav = encodeWav24(new Float32Array([-1, 0, 1]), PCM_TARGET_SAMPLE_RATE);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  const view = new DataView(bytes.buffer);

  assert.equal(wav.type, "audio/wav");
  assert.equal(readAscii(bytes, 0, 4), "RIFF");
  assert.equal(readAscii(bytes, 8, 4), "WAVE");
  assert.equal(readAscii(bytes, 12, 4), "fmt ");
  assert.equal(readAscii(bytes, 36, 4), "data");
  assert.equal(view.getUint32(4, true), 46);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(32, true), 3);
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 9);
  assert.deepEqual(
    Array.from(bytes.slice(44)),
    [0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0xff, 0xff, 0x7f, 0x00],
  );
});

test("PCM analysis sanitizes non-finite samples instead of leaking NaN metrics", () => {
  const metrics = analyzePcmSamples(
    new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, -Infinity]),
  );

  assert.equal(metrics.durationMs, 0);
  assert.equal(metrics.sampleRateHz, PCM_TARGET_SAMPLE_RATE);
  assert.equal(metrics.bitDepth, 24);
  assert.equal(metrics.channels, 1);
  assert.equal(metrics.peakDbfs, -96);
  assert.equal(metrics.integratedLufs, -96);
  assert.equal(metrics.noiseFloorDbfs, -96);
  assert.equal(metrics.snrDb, 0);
  assert.equal(metrics.clippingDetected, false);
  assert.equal(metrics.sampleCount, 3);
  assert.equal(metrics.clippingSampleCount, 0);
  assert.equal(metrics.activeSpeechRatio, 0);
  assert.equal(metrics.silenceRatio, 1);
});

test("PCM analysis preserves detailed, finite signal provenance metrics", () => {
  const metrics = analyzePcmSamples(
    new Float32Array([0, 0.2, -0.2, 0.4, -0.4, 0]),
    48_000,
  );

  assert.equal(metrics.schemaVersion, "voice.audio_metrics.v1");
  assert.equal(metrics.sampleCount, 6);
  assert.ok(metrics.estimatedTruePeakDbfs >= metrics.peakDbfs);
  assert.ok(Number.isFinite(metrics.rmsDbfs));
  assert.ok(Number.isFinite(metrics.crestFactorDb));
  assert.ok(Number.isFinite(metrics.dcOffset));
  assert.equal(metrics.clippingRate, 0);
  assert.equal(metrics.voicedFrameRatio, 0);
  assert.equal(metrics.meanPitchHz, null);
  assert.equal(metrics.pitchRangeSemitones, null);
  assert.equal(metrics.pitchVariationSemitones, null);
  assert.equal(metrics.energyVariationDb, 0);
});

test("PCM analysis extracts measured pitch and energy variation for prosody", () => {
  const samples = new Float32Array(48_000);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.2 * Math.sin((2 * Math.PI * 150 * index) / 48_000);
  }

  const metrics = analyzePcmSamples(samples, 48_000);

  assert.ok(metrics.meanPitchHz !== null);
  assert.ok(Math.abs(metrics.meanPitchHz - 150) < 5);
  assert.equal(metrics.voicedFrameRatio, 1);
  assert.ok((metrics.pitchVariationSemitones ?? 0) < 0.2);
  assert.ok(metrics.energyVariationDb < 0.5);
  assert.ok((metrics.energyEnvelope?.length ?? 0) > 0);
  assert.ok((metrics.speechSegments?.length ?? 0) > 0);
  assert.equal(metrics.speechSegments?.[0].source, "energy_threshold");
});

test("PCM analysis keeps bounded energy envelopes and temporal speech segments", () => {
  const samples = new Float32Array(48_000);

  for (let index = 12_000; index < 36_000; index += 1) {
    samples[index] = 0.2 * Math.sin((2 * Math.PI * 180 * index) / 48_000);
  }

  const metrics = analyzePcmSamples(samples, 48_000);

  assert.ok((metrics.energyEnvelope?.length ?? 0) < 20);
  assert.equal(metrics.speechSegments?.length, 1);
  assert.ok((metrics.speechSegments?.[0].startMs ?? 0) >= 200);
  assert.ok((metrics.speechSegments?.[0].endMs ?? 1000) <= 800);
});

test("PCM VAD adapts to a continuous noise floor", () => {
  const samples = new Float32Array(48_000);
  const noiseAmplitude = 10 ** (-42 / 20);
  const voiceAmplitude = 10 ** (-22 / 20);

  for (let index = 0; index < samples.length; index += 1) {
    const noise =
      noiseAmplitude * Math.sin((2 * Math.PI * 90 * index) / 48_000);
    const voice =
      index >= 16_000 && index < 32_000
        ? voiceAmplitude * Math.sin((2 * Math.PI * 180 * index) / 48_000)
        : 0;
    samples[index] = noise + voice;
  }

  const metrics = analyzePcmSamples(samples, 48_000);

  assert.ok((metrics.speechActivityThresholdDbfs ?? -96) > -45);
  assert.ok(metrics.activeSpeechRatio > 0.25);
  assert.ok(metrics.activeSpeechRatio < 0.5);
  assert.equal(metrics.speechSegments?.length, 1);
});

test("PCM analysis uses a finite gated K-weighted loudness estimate", () => {
  const samples = new Float32Array(48_000);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.25 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
  }

  const metrics = analyzePcmSamples(samples, 48_000);

  assert.ok(Number.isFinite(metrics.integratedLufs));
  assert.ok(metrics.integratedLufs > -17);
  assert.ok(metrics.integratedLufs < -14);
});

test("linear resampling keeps endpoints stable", () => {
  const resampled = resampleLinear(new Float32Array([0, 1]), 2, 4);

  assert.equal(resampled.length, 4);
  assert.equal(resampled[0], 0);
  assert.ok(Math.abs(resampled[1] - 1 / 3) < 0.000001);
  assert.ok(Math.abs(resampled[2] - 2 / 3) < 0.000001);
  assert.equal(resampled[3], 1);
});

test("band-limited resampling suppresses ultrasonic content before downsampling", () => {
  const source = new Float32Array(44_100);

  for (let index = 0; index < source.length; index += 1) {
    source[index] = 0.8 * Math.sin((2 * Math.PI * 18_000 * index) / 44_100);
  }

  const resampled = resampleBandLimited(source, 44_100, 16_000);
  let sumSquares = 0;

  for (const sample of resampled) {
    sumSquares += sample * sample;
  }

  assert.equal(resampled.length, 16_000);
  assert.ok(Math.sqrt(sumSquares / resampled.length) < 0.01);
});

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

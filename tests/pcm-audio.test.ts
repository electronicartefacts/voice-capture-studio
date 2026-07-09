import assert from "node:assert/strict";
import test from "node:test";
import {
  PCM_TARGET_SAMPLE_RATE,
  PcmSampleBuffer,
  analyzePcmSamples,
  encodeWav24,
  resampleLinear,
} from "../src/app/audio/pcmAudio";

test("PCM sample buffer copies chunks and enforces the configured sample limit", () => {
  const buffer = new PcmSampleBuffer({ maxSamples: 3 });
  const firstChunk = new Float32Array([1, 2]);

  buffer.append(firstChunk);
  firstChunk[0] = 9;
  buffer.append(new Float32Array([3, 4]));

  assert.equal(buffer.sampleCount, 3);
  assert.deepEqual(Array.from(buffer.consume()), [1, 2, 3]);
  assert.equal(buffer.sampleCount, 0);
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
  assert.equal(view.getUint32(4, true), 45);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(32, true), 3);
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 9);
  assert.deepEqual(
    Array.from(bytes.slice(44)),
    [0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0xff, 0xff, 0x7f],
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
});

test("linear resampling keeps endpoints stable", () => {
  const resampled = resampleLinear(new Float32Array([0, 1]), 2, 4);

  assert.equal(resampled.length, 4);
  assert.equal(resampled[0], 0);
  assert.ok(Math.abs(resampled[1] - 1 / 3) < 0.000001);
  assert.ok(Math.abs(resampled[2] - 2 / 3) < 0.000001);
  assert.equal(resampled[3], 1);
});

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

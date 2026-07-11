import assert from "node:assert/strict";
import test from "node:test";
import { createRealtimeSpeechActivityDetector } from "../src/app/recording/realtimeSpeechActivity";

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 1_024;
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

test("live endpoint detection ignores calibrated room noise and opens on speech", () => {
  const detector = createRealtimeSpeechActivityDetector({
    noiseFloorDbfs: -48,
  });
  let now = 0;

  for (let frame = 0; frame < 20; frame += 1) {
    now += FRAME_MS;
    detector.process(sineFrame(-50), SAMPLE_RATE, now);
  }

  assert.equal(detector.snapshot(now).hasDetectedSpeech, false);

  for (let frame = 0; frame < 4; frame += 1) {
    now += FRAME_MS;
    detector.process(sineFrame(-24), SAMPLE_RATE, now);
  }

  const speech = detector.snapshot(now);

  assert.equal(speech.active, true);
  assert.equal(speech.hasDetectedSpeech, true);
  assert.ok(speech.startThresholdDbfs >= -42);
  assert.ok(speech.startThresholdDbfs <= -35);
});

test("live endpoint detection keeps quiet gaps inside a phrase and measures the tail", () => {
  const detector = createRealtimeSpeechActivityDetector({
    noiseFloorDbfs: -62,
  });
  let now = 0;

  for (let frame = 0; frame < 5; frame += 1) {
    now += FRAME_MS;
    detector.process(sineFrame(-25), SAMPLE_RATE, now);
  }

  const lastSpeechAtMs = detector.snapshot(now).lastSpeechAtMs;

  for (let frame = 0; frame < 8; frame += 1) {
    now += FRAME_MS;
    detector.process(sineFrame(-78), SAMPLE_RATE, now);
  }

  assert.equal(detector.snapshot(now).active, true);

  for (let frame = 0; frame < 8; frame += 1) {
    now += FRAME_MS;
    detector.process(sineFrame(-78), SAMPLE_RATE, now);
  }

  const tail = detector.snapshot(now);

  assert.equal(tail.active, false);
  assert.equal(tail.lastSpeechAtMs, lastSpeechAtMs);
  assert.ok(tail.trailingSilenceMs >= 300);
});

test("live endpoint detection adapts downward without chasing loud transients", () => {
  const detector = createRealtimeSpeechActivityDetector();
  let now = 0;

  for (let frame = 0; frame < 80; frame += 1) {
    now += FRAME_MS;
    detector.process(sineFrame(-72), SAMPLE_RATE, now);
  }

  const quietFloor = detector.snapshot(now).noiseFloorDbfs;

  now += FRAME_MS;
  detector.process(sineFrame(-18), SAMPLE_RATE, now);

  assert.ok(quietFloor < -66);
  assert.ok(detector.snapshot(now).noiseFloorDbfs < -66);
});

function sineFrame(dbfs: number): Float32Array {
  const amplitude = 10 ** (dbfs / 20) * Math.SQRT2;

  return Float32Array.from(
    { length: FRAME_SAMPLES },
    (_, index) => amplitude * Math.sin((index / SAMPLE_RATE) * Math.PI * 440),
  );
}

import assert from "node:assert/strict";
import test from "node:test";
import { measureAcousticField } from "../src/app/rendering/acousticField";

test("acoustic field isolates broad bass, presence, and air bands", () => {
  const fftSize = 2048;
  const sampleRate = 48_000;
  const spectrum = new Uint8Array(fftSize / 2);
  const binFor = (hertz: number) => Math.round(hertz / (sampleRate / fftSize));

  spectrum[binFor(100)] = 240;
  spectrum[binFor(1_000)] = 180;
  spectrum[binFor(6_000)] = 100;

  const features = measureAcousticField(spectrum, sampleRate, fftSize);

  assert.ok(features.bass > features.presence);
  assert.ok(features.presence > features.air);
  assert.ok(features.ambience > 0);
  assert.ok(features.ambience <= 1);
});

test("acoustic field returns a stable silent value for unusable input", () => {
  assert.deepEqual(measureAcousticField(new Uint8Array(), 48_000, 2048), {
    ambience: 0,
    bass: 0,
    presence: 0,
    air: 0,
  });
  assert.deepEqual(measureAcousticField(new Uint8Array(8), 0, 2048), {
    ambience: 0,
    bass: 0,
    presence: 0,
    air: 0,
  });
});

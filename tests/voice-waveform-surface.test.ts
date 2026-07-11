import assert from "node:assert/strict";
import test from "node:test";
import { getWaveformDisplayGain } from "../src/app/rendering/liveAudioSignal";
import { getWaveformSamplePosition } from "../src/app/rendering/waveformGeometry";

test("compact waveform samples span the complete visual surface", () => {
  const compactSampleCount = 160;

  assert.equal(getWaveformSamplePosition(0, compactSampleCount), 0);
  assert.equal(
    getWaveformSamplePosition(compactSampleCount - 1, compactSampleCount),
    1,
  );
});

test("compact surfaces amplify quiet speech without changing desktop gain", () => {
  assert.equal(getWaveformDisplayGain(0.55, 0.1, false), 0.55);
  assert.ok(getWaveformDisplayGain(0.55, 0.1, true) > 1.2);
});

test("compact waveform boost eases as the voice gets louder", () => {
  const quietGain = getWaveformDisplayGain(1, 0.08, true);
  const loudGain = getWaveformDisplayGain(1, 0.9, true);

  assert.ok(quietGain > loudGain);
  assert.ok(loudGain >= 1.7);
});

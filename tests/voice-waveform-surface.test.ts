import assert from "node:assert/strict";
import test from "node:test";
import { getWaveformSamplePosition } from "../src/app/rendering/waveformGeometry";

test("compact waveform samples span the complete visual surface", () => {
  const compactSampleCount = 160;

  assert.equal(getWaveformSamplePosition(0, compactSampleCount), 0);
  assert.equal(
    getWaveformSamplePosition(compactSampleCount - 1, compactSampleCount),
    1,
  );
});
